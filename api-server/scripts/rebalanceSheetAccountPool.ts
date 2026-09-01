/**
 * scripts/rebalanceSheetAccountPool.ts
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint — item 1,
 * migration path.
 *
 * Growing the account pool from size 1 (today, one shared Google service
 * account for the whole platform) to size N changes accountIndexForSheet's
 * answer for almost every existing spreadsheet (the classic modulo-hashing
 * problem) -- so every currently-assigned tenant sheet needs its NEW
 * account added as an Editor before that tenant's reads/writes actually
 * start using it (irforge-web's sheets.ts and irforge-app's
 * sheets_client.py both recompute the index live from the CURRENT pool
 * size on every call -- there is no persisted "this sheet's index is
 * frozen at N" state to fall back on, so an unshared sheet would start
 * failing with the exact "caller does not have permission" error this
 * whole checkpoint investigated, the moment the pool env var changes).
 *
 * This script is the concrete fix for that: it reads every real sheet ID
 * this platform knows about (bots.sheetId + sheet_pool.sheetId), computes
 * which NEW pool account each one will resolve to once
 * GOOGLE_CREDENTIALS_JSON_POOL is set, and grants that account Editor
 * access using the OLD single account's Drive credentials (which already
 * has edit access to every one of these sheets today, since it's the sole
 * account that ever created or was shared on them).
 *
 * SAFE BY DEFAULT: dry-run only, prints a plan, changes nothing. Pass
 * --apply to actually call the Drive API and share files. This moves
 * access to live customer data -- read the printed plan before adding
 * --apply, and consider running it once for a handful of sheets first.
 *
 * Usage:
 *   GOOGLE_CREDENTIALS_JSON=<today's single account, unchanged>          \
 *   GOOGLE_CREDENTIALS_JSON_POOL=<the new N-account pool you're moving to> \
 *   DATABASE_URL=<production DB, read-only access is enough>            \
 *     node --import tsx/esm scripts/rebalanceSheetAccountPool.ts           # dry run
 *     node --import tsx/esm scripts/rebalanceSheetAccountPool.ts --apply   # for real
 *
 * Run this BEFORE deploying the GOOGLE_CREDENTIALS_JSON_POOL env var change
 * -- accounts need Editor access in place before the code starts reading
 * with a different identity, not after.
 */
import { google } from "googleapis";
import { db, botsTable, sheetPoolTable } from "@workspace/db";
import { accountIndexForSheet } from "../src/lib/sheets.js";

interface Credentials {
  client_email: string;
  private_key: string;
}

function parseCredentials(raw: string): Credentials {
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("credentials JSON is missing client_email or private_key");
  }
  return { client_email: parsed.client_email, key: parsed.private_key.replace(/\\n/g, "\n") } as unknown as Credentials;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const oldCredsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const poolJson = process.env.GOOGLE_CREDENTIALS_JSON_POOL;
  if (!oldCredsJson) throw new Error("GOOGLE_CREDENTIALS_JSON must be set (today's single account -- used to grant access).");
  if (!poolJson) throw new Error("GOOGLE_CREDENTIALS_JSON_POOL must be set (the pool you're rebalancing onto).");

  const oldCreds = parseCredentials(oldCredsJson);
  const pool: { client_email: string; private_key: string }[] = JSON.parse(poolJson);
  if (!Array.isArray(pool) || pool.length === 0) throw new Error("GOOGLE_CREDENTIALS_JSON_POOL must be a non-empty array.");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: oldCreds.client_email, private_key: (oldCreds as unknown as { key: string }).key },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const botRows = await db.select({ sheetId: botsTable.sheetId, id: botsTable.id }).from(botsTable);
  const poolRows = await db.select({ sheetId: sheetPoolTable.sheetId, id: sheetPoolTable.id }).from(sheetPoolTable);

  const sheets = new Map<string, string>(); // sheetId -> a human label for the plan
  for (const b of botRows) if (b.sheetId) sheets.set(b.sheetId, `bot ${b.id}`);
  for (const p of poolRows) if (p.sheetId && !sheets.has(p.sheetId)) sheets.set(p.sheetId, `sheet_pool ${p.id} (unassigned)`);

  console.log(`Found ${sheets.size} distinct sheet IDs. Target pool size: ${pool.length}.`);
  console.log(apply ? "MODE: --apply (will actually share files)" : "MODE: dry run (pass --apply to actually share files)");
  console.log("");

  let toShare = 0;
  let alreadyOnDefault = 0;
  let failed = 0;

  for (const [sheetId, label] of sheets) {
    const targetIndex = accountIndexForSheet(sheetId, pool.length);
    if (targetIndex === 0) {
      // Index 0 is, by construction, always the account that was
      // GOOGLE_CREDENTIALS_JSON before -- already has access, nothing to do.
      alreadyOnDefault++;
      continue;
    }
    const targetEmail = pool[targetIndex].client_email;
    console.log(`${sheetId}  (${label})  ->  account[${targetIndex}] ${targetEmail}`);
    toShare++;
    if (apply) {
      try {
        await drive.permissions.create({
          fileId: sheetId,
          requestBody: { type: "user", role: "writer", emailAddress: targetEmail },
          sendNotificationEmail: false,
        });
      } catch (err) {
        failed++;
        console.error(`  FAILED to share ${sheetId} with ${targetEmail}:`, (err as Error).message);
      }
    }
  }

  console.log("");
  console.log(
    `${sheets.size} total, ${alreadyOnDefault} already on the default account (index 0), ` +
      `${toShare} need${toShare === 1 ? "s" : ""} a new account` +
      (apply ? `, ${failed} failed` : " (dry run -- nothing shared yet)")
  );
  if (!apply && toShare > 0) {
    console.log("Re-run with --apply once you've reviewed this plan.");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
