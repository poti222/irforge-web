/**
 * routes/superAdminDiagnostics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint — item 2:
 * a spreadsheet showing 28 consistent "the caller does not have permission"
 * errors is a Sheets-access incident, not a quota one (quota errors are
 * transient/retriable; a permission error on every single attempt means the
 * service account was actually removed as an editor, or the file is gone).
 * That tenant's bot section is very likely completely broken and its owner
 * has no way to know why.
 *
 * This session has no credentials for the production database or
 * GOOGLE_CREDENTIALS_JSON, so the live lookup has to run *as* this service,
 * in production, not from the sandbox that wrote it — hence a real,
 * permanent (not one-off/removed-after-use) super-admin-gated endpoint
 * rather than a throwaway script. Read-only: it never writes anything, and
 * never returns the private key or any user password/hash.
 */
import { Router } from "express";
import { db, botsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "./auth.js";
import { diagnoseSheetAccess } from "../lib/sheets.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── GET /api/superadmin/diagnose-sheet/:spreadsheetId ──────────────────────
// Given a spreadsheet ID (e.g. copied out of an error log), resolves which
// bot/customer owns it and live-checks whether the active service account
// can currently open it — with enough detail (HTTP status + Google's own
// error reason) to tell "access revoked" apart from "sheet deleted".

router.get("/superadmin/diagnose-sheet/:spreadsheetId", requireSuperAdmin, async (req, res) => {
  const { spreadsheetId } = req.params;
  try {
    const [bot] = await db
      .select({
        id: botsTable.id,
        name: botsTable.name,
        status: botsTable.status,
        userId: botsTable.userId,
        createdAt: botsTable.createdAt,
      })
      .from(botsTable)
      .where(eq(botsTable.sheetId, spreadsheetId))
      .limit(1);

    let owner: { email: string; phone: string | null; telegramUsername: string | null } | null = null;
    if (bot) {
      const [user] = await db
        .select({ email: usersTable.email, phone: usersTable.phone, telegramUsername: usersTable.telegramUsername })
        .from(usersTable)
        .where(eq(usersTable.id, bot.userId))
        .limit(1);
      owner = user ?? null;
    }

    const access = await diagnoseSheetAccess(spreadsheetId);

    res.json({
      spreadsheetId,
      bot: bot
        ? { id: bot.id, name: bot.name, status: bot.status, createdAt: bot.createdAt }
        : null,
      owner,
      access,
      diagnosis: !bot
        ? "no bot in this platform's database references this spreadsheet ID — either it belongs to a bot that was deleted, or the ID was mistyped"
        : access.ok
          ? "access is fine right now — if errors were logged earlier, they may have been transient or already fixed"
          : access.httpStatus === 404 || access.googleReason === "notFound"
            ? "the spreadsheet itself is gone (deleted or moved out of reach) — re-sharing won't help, the tenant needs a new spreadsheet provisioned and their tabs restored from a backup if one exists"
            : "the spreadsheet still exists but the service account's access was removed — open the sheet as its owner (or ask the owner) and re-add the email in `access.serviceAccountEmail` as an Editor",
    });
  } catch (err) {
    logger.error({ err, spreadsheetId }, "diagnose-sheet failed");
    res.status(500).json({ error: "diagnosis failed", message: (err as Error).message });
  }
});

export default router;
