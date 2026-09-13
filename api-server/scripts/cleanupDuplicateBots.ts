/**
 * scripts/cleanupDuplicateBots.ts
 * IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT — بخش D.
 * ─────────────────────────────────────────────────────────────────────────────
 * پاک‌سازیِ یک‌بارِ ردیف‌هایِ تکراریِ `bots` که قبل از قفلِ
 * `withTokenCreationLock()` (کامیتِ f4658ad) ساخته شده‌اند. آن کامیت مسیرِ
 * *تولیدِ* دوپلیکیتِ تازه را بست (race در `reconcileBotsFromRegistry` که هر
 * بارِ باز شدنِ داشبورد اجرا می‌شد) و `dedupeBotsByToken()` را روی
 * `GET /bots` گذاشت تا کاربرِ عادی دیگر دوپلیکیت نبیند — ولی خودِ ردیف‌هایِ
 * قدیمیِ تکراری در Postgres هنوز آنجایند (`GET /admin/bots` عمداً raw
 * می‌ماند تا سوپرادمین بتواند همین‌ها را ببیند و پاک کند — طبقِ همان تصمیمِ
 * ثبت‌شده در PROGRESS.md). این اسکریپت همان کار را، یک‌بار، برایِ همه‌شان با
 * هم انجام می‌دهد.
 *
 * **این «ادغامِ رجیستری» نیست** — تحقیقِ این فاز نشان داد فرضِ اولیه (dual-
 * write بینِ Postgres registry_tenants و شیتِ tenants) غلط بود: هیچ مسیرِ
 * خواندنی هر دو را با هم ترکیب نمی‌کند. ریشه‌ی واقعی، دو (یا چند) ردیفِ
 * INSERTشده در همان یک جدولِ Postgres `bots` برایِ یک توکن است — همان چیزی
 * که `dedupeBotsByToken()` (در routes/bots.ts) از قبل تشخیص می‌دهد، فقط در
 * زمانِ نمایش، نه در خودِ داده.
 *
 * **قوانینِ ادغام:**
 *   - کلید: `decryptToken(bots.token)` — نه `id`، چون هیچ دو backend ای اینجا
 *     درگیر نیست، ولی همین توکنِ رمزگشایی‌شده تنها چیزِ واقعاً یکتاست.
 *   - برنده‌ی ردیف (کدام id زنده می‌ماند): همان تصمیمِ `dedupeBotsByToken`—
 *     ردیفی که `sheetId` دارد (چون واقعاً در حالِ اجراست)، وگرنه قدیمی‌ترین.
 *   - فیلدهای پکیج/تریال روی برنده merge می‌شوند، نه صرفاً نگه‌داشته: هر
 *     ردیفی که `tier`/`isTrial` واقعی دارد بر ردیفِ بدونش برتری دارد؛ اگر
 *     چند ردیف مقدارِ واقعی دارند، جدیدترین `updatedAt` برنده است — دقیقاً
 *     قاعده‌ای که کاربر برایِ expiry_date خواسته.
 *   - `status`: **حدس زده نمی‌شود.** اگر ردیف‌هایِ یک گروه status متفاوت
 *     دارند، کلِ آن گروه به‌جایِ ادغامِ خودکار در گزارشِ «نیاز به بازبینی»
 *     می‌رود و هیچ ردیفی از آن گروه لمس نمی‌شود.
 *   - **گاردِ ایمنیِ اضافه (فراتر از خواسته‌ی صریحِ کاربر، ولی لازم):** اگر
 *     بیش از یک ردیفِ یک گروه `sheetId` دارد (یعنی دو دفعه، در دو race
 *     جدا، دو شیتِ واقعیِ متفاوت به همین توکن اختصاص یافته)، آن گروه هم
 *     می‌رود به «نیاز به بازبینی» — چون تصمیمِ خودکار اینجا یعنی از دست‌رفتنِ
 *     دائمیِ دیتایِ یک شیتِ واقعی (`purgeBotFully`ی معمولیِ همین فایل با
 *     `resetSpreadsheet` شیت را کامل خالی می‌کند). این اسکریپت عمداً یک
 *     purge سبک‌تر و مخصوصِ خودش دارد که اصلاً وارد این مسیر نمی‌شود — نگاه
 *     کن به `deleteLoserRow` پایین.
 *   - **چیزی که عمداً صدا زده نمی‌شود:** `syncTenantDelete(token)` — چون
 *     توکن بینِ برنده و بازنده‌هایِ یک گروه *مشترک* است؛ پاک‌کردنِ رجیستری با
 *     همان توکن، ردیفِ رجیستریِ خودِ برنده را هم پاک می‌کرد. فقط
 *     `syncBotDelete(loserId)` صدا زده می‌شود (آینه‌ی SHEETS_DATA_ID، کلیدش
 *     id داخلی است نه توکن — کاملاً بی‌خطر).
 *
 * SAFE BY DEFAULT: dry-run — فقط گزارش می‌دهد، چیزی نمی‌نویسد. `--apply`
 * برای اجرایِ واقعی.
 *
 * Usage:
 *   DATABASE_URL=<production DB> node --import tsx/esm scripts/cleanupDuplicateBots.ts            # dry run
 *   DATABASE_URL=<production DB> node --import tsx/esm scripts/cleanupDuplicateBots.ts --apply     # واقعی
 *
 * ⚠️ این sandbox به DATABASE_URLِ تولید دسترسی/اتصالِ شبکه ندارد — این
 * اسکریپت اینجا نوشته و تست شده (با دیتایِ فیک، نگاه کن
 * test/cleanupDuplicateBots.test.mjs) ولی هرگز علیهِ دیتایِ واقعی اجرا
 * نشده. dry-runِ واقعی باید در محیطی با دسترسی به DB اجرا شود.
 */
import { db, botsTable, commandsTable, installedPluginsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptToken } from "../src/lib/tokenCrypto.js";
import { syncBotDelete } from "../src/lib/sheetsSync.js";

type BotRow = typeof botsTable.$inferSelect;

export type MergeableGroup = {
  needsReview: false;
  token: string;
  rows: BotRow[];
  keeperId: string;
  loserIds: string[];
  mergedFields: {
    tier: string | null;
    tierExpiresAt: Date | null;
    isTrial: boolean;
    trialExpiresAt: Date | null;
  };
};

export type ReviewGroup = {
  needsReview: true;
  token: string;
  rows: BotRow[];
  reviewReason: "status_conflict" | "multiple_sheets";
};

export type DuplicateGroup = MergeableGroup | ReviewGroup;

/** Groups bots by decrypted token; a row whose token won't decrypt is never
 * grouped (kept out entirely — same "corrupt/legacy row, never silently
 * touched" rule dedupeBotsByToken already follows). Only groups with more
 * than one row are returned — a lone bot for a token is not a duplicate. */
export function groupDuplicateBots(bots: BotRow[]): { token: string; rows: BotRow[] }[] {
  const byToken = new Map<string, BotRow[]>();
  for (const bot of bots) {
    let token: string;
    try {
      token = decryptToken(bot.token);
    } catch {
      continue;
    }
    const list = byToken.get(token);
    if (list) list.push(bot);
    else byToken.set(token, [bot]);
  }
  return [...byToken.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([token, rows]) => ({ token, rows }));
}

/** Decides, for one token's group of duplicate rows, whether it can be
 * merged automatically or must be held for manual review. Never guesses on
 * a status conflict or on more than one row genuinely holding a sheet. */
export function classifyDuplicateGroup(token: string, rows: BotRow[]): DuplicateGroup {
  const withSheet = rows.filter((r) => r.sheetId);
  if (withSheet.length > 1) {
    return { needsReview: true, token, rows, reviewReason: "multiple_sheets" };
  }

  const statuses = new Set(rows.map((r) => r.status));
  if (statuses.size > 1) {
    return { needsReview: true, token, rows, reviewReason: "status_conflict" };
  }

  const keeper = withSheet[0] ?? rows.reduce((oldest, r) => (r.createdAt < oldest.createdAt ? r : oldest));
  const loserIds = rows.filter((r) => r.id !== keeper.id).map((r) => r.id);

  const tierCandidates = rows.filter((r) => r.tier != null);
  const bestTierRow = tierCandidates.length
    ? tierCandidates.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    : null;

  const trialCandidates = rows.filter((r) => r.isTrial);
  const bestTrialRow = trialCandidates.length
    ? trialCandidates.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    : null;

  return {
    needsReview: false,
    token,
    rows,
    keeperId: keeper.id,
    loserIds,
    mergedFields: {
      tier: bestTierRow?.tier ?? null,
      tierExpiresAt: bestTierRow?.tierExpiresAt ?? null,
      isTrial: Boolean(bestTrialRow),
      trialExpiresAt: bestTrialRow?.trialExpiresAt ?? null,
    },
  };
}

function maskToken(token: string): string {
  return token.length > 6 ? `…${token.slice(-6)}` : token;
}

/** Deletes exactly one duplicate LOSER row. Deliberately narrower than
 * routes/bots.ts's purgeBotFully: never touches Google Sheets/sheet_pool
 * (a loser here is only ever chosen when it has no sheetId — classify
 * above sends any group with 2+ real sheets to manual review instead) and
 * never calls syncTenantDelete (the token is shared with the surviving
 * keeper row, so deleting the registry entry by token would take the
 * keeper's own tenant registration down with it). */
async function deleteLoserRow(row: BotRow): Promise<void> {
  if (row.sheetId) {
    throw new Error(`refusing to delete bot ${row.id}: it has a sheetId (${row.sheetId}) — classifyDuplicateGroup should have sent this group to manual review`);
  }
  await db.delete(commandsTable).where(eq(commandsTable.botId, row.id));
  await db.delete(installedPluginsTable).where(eq(installedPluginsTable.botId, row.id));
  await db.delete(botsTable).where(eq(botsTable.id, row.id));
  syncBotDelete(row.id);
}

async function main() {
  const apply = process.argv.includes("--apply");

  const bots = await db.select().from(botsTable);
  const groups = groupDuplicateBots(bots).map((g) => classifyDuplicateGroup(g.token, g.rows));

  const mergeable = groups.filter((g): g is MergeableGroup => !g.needsReview);
  const review = groups.filter((g): g is ReviewGroup => g.needsReview);
  const rowsInGroups = groups.reduce((n, g) => n + g.rows.length, 0);
  const rowsToDelete = mergeable.reduce((n, g) => n + g.loserIds.length, 0);

  console.log(`Loaded ${bots.length} bot rows total.`);
  console.log(`${groups.length} duplicate-token group(s) found, ${rowsInGroups} row(s) involved.`);
  console.log(`  ${mergeable.length} group(s) safe to auto-merge — ${rowsToDelete} row(s) would be deleted, ${mergeable.length} survivor(s) remain.`);
  console.log(`  ${review.length} group(s) need MANUAL review — not touched by this script.`);
  console.log(apply ? "MODE: --apply (will actually write)" : "MODE: dry run (pass --apply to write for real)");
  console.log("");

  if (review.length > 0) {
    console.log("── نیاز به بازبینیِ دستی ──────────────────────────────────────");
    for (const g of review) {
      console.log(`[${g.reviewReason}] token=${maskToken(g.token)}`);
      for (const r of g.rows) {
        console.log(
          `    id=${r.id}  name=${JSON.stringify(r.name)}  status=${r.status}  sheetId=${r.sheetId ?? "—"}  ` +
            `tier=${r.tier ?? "—"}  isTrial=${r.isTrial}  createdAt=${r.createdAt.toISOString()}`,
        );
      }
    }
    console.log("");
  }

  if (mergeable.length > 0) {
    console.log("── ادغامِ خودکار ──────────────────────────────────────────────");
    for (const g of mergeable) {
      console.log(
        `[merge] token=${maskToken(g.token)}  keeper=${g.keeperId}  delete=[${g.loserIds.join(", ") || "—"}]  ` +
          `-> tier=${g.mergedFields.tier ?? "—"} tierExpiresAt=${g.mergedFields.tierExpiresAt?.toISOString() ?? "—"} ` +
          `isTrial=${g.mergedFields.isTrial} trialExpiresAt=${g.mergedFields.trialExpiresAt?.toISOString() ?? "—"}`,
      );
      if (apply) {
        await db.update(botsTable).set(g.mergedFields).where(eq(botsTable.id, g.keeperId));
        for (const loserId of g.loserIds) {
          const loser = g.rows.find((r) => r.id === loserId)!;
          await deleteLoserRow(loser);
        }
      }
    }
    console.log("");
  }

  console.log(
    apply
      ? `Done — ${mergeable.length} group(s) merged, ${rowsToDelete} duplicate row(s) deleted. ${review.length} group(s) still need manual review.`
      : "Dry run only — nothing was written. Review the plan above, then re-run with --apply.",
  );
}

// اجرا فقط وقتی این فایل مستقیم اجرا شده، نه وقتی تستِ توابعِ خالصِ بالا
// (`groupDuplicateBots`/`classifyDuplicateGroup`) آن را import می‌کند —
// وگرنه هر بار اجرایِ تست یک db.select واقعی می‌زد.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
