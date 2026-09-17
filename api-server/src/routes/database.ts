/**
 * routes/database.ts — the "Database" menu (parity group G1).
 *
 * Read/add/edit/delete rows in the *actual* Google Sheets the bot uses, through
 * the shared tenant-sheet layer (`lib/tenantSheets.ts`). Targets:
 *   - `bot:<botId>`  → that bot's own assigned spreadsheet (owner or super-admin)
 *   - `registry`     → the platform registry sheet (super-admin only)
 *   - `data`         → the web mirror DATA sheet (super-admin only)
 *
 * Permissions mirror the bot: a tenant owner may edit their own bot's sheet; the
 * platform-level registry/data sheets are super-admin only.
 */
import { Router } from "express";
import { db, botsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { logger } from "../lib/logger";
import {
  listTabs,
  addTab,
  readTabRows,
  upsertRow,
  deleteRow,
  rowExists,
} from "../lib/tenantSheets.js";
import { registrySheetId } from "../lib/sheetsSync.js";

const router = Router();

async function getRole(userId: string): Promise<string> {
  const [u] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.role ?? "user";
}

type ResolvedTarget = { spreadsheetId: string; label: string; kind: string };

/**
 * Resolve a `:target` param to a spreadsheet id, enforcing permissions.
 * Throws an object `{ status, error }` the caller turns into an HTTP response.
 */
async function resolveTarget(userId: string, target: string): Promise<ResolvedTarget> {
  const role = await getRole(userId);
  const isSuper = role === "super_admin";

  if (target === "registry" || target === "data") {
    if (!isSuper) throw { status: 403, error: "دسترسی سوپرادمین لازم است." };
    const id = target === "registry" ? registrySheetId() : process.env.SHEETS_DATA_ID ?? null;
    if (!id) throw { status: 404, error: `شیت «${target}» روی سرور تنظیم نشده است.` };
    return { spreadsheetId: id, label: target === "registry" ? "رجیستری" : "داده‌ها (Data)", kind: target };
  }

  if (target.startsWith("bot:")) {
    const botId = target.slice(4);
    const where = isSuper
      ? eq(botsTable.id, botId)
      : and(eq(botsTable.id, botId), eq(botsTable.userId, userId));
    const [bot] = await db.select().from(botsTable).where(where).limit(1);
    if (!bot) throw { status: 404, error: "این بات پیدا نشد یا مال شما نیست." };
    if (!bot.sheetId) throw { status: 409, error: "این بات هنوز شیت اختصاصی ندارد." };
    return { spreadsheetId: bot.sheetId, label: bot.name, kind: "bot" };
  }

  throw { status: 400, error: "هدف نامعتبر است." };
}

function fail(res: any, err: any, fallback: string) {
  if (err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.error });
    return;
  }
  logger.error({ err }, fallback);
  res.status(500).json({ error: fallback });
}

// ─── GET /api/database/targets — spreadsheets the caller may edit ────────────
router.get("/database/targets", requireAuth, async (req: any, res) => {
  try {
    const role = await getRole(req.userId);
    const isSuper = role === "super_admin";
    const bots = await db
      .select({ id: botsTable.id, name: botsTable.name, sheetId: botsTable.sheetId })
      .from(botsTable)
      .where(isSuper ? undefined : eq(botsTable.userId, req.userId));

    type BotRow = { id: string; name: string; sheetId: string | null };
    const targets = (bots as BotRow[])
      .filter((b: BotRow) => Boolean(b.sheetId))
      .map((b: BotRow) => ({ target: `bot:${b.id}`, label: b.name, kind: "bot", sheetId: b.sheetId as string }));

    if (isSuper) {
      const registryId = registrySheetId();
      if (registryId)
        targets.unshift({ target: "registry", label: "رجیستری (توکن بات‌ها)", kind: "registry", sheetId: registryId });
      if (process.env.SHEETS_DATA_ID)
        targets.unshift({ target: "data", label: "داده‌های سایت (Data)", kind: "data", sheetId: process.env.SHEETS_DATA_ID });
    }
    res.json({ targets, isSuperAdmin: isSuper });
  } catch (err) {
    fail(res, err, "Failed to list database targets");
  }
});

// ─── GET /api/database/:target/tabs — worksheet titles ───────────────────────
router.get("/database/:target/tabs", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId, label, kind } = await resolveTarget(req.userId, req.params.target);
    const tabs = await listTabs(spreadsheetId);
    res.json({ spreadsheetId, label, kind, tabs });
  } catch (err) {
    fail(res, err, "Failed to list tabs");
  }
});

// ─── POST /api/database/:target/tabs — create a tab ──────────────────────────
router.post("/database/:target/tabs", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveTarget(req.userId, req.params.target);
    const name = String(req.body?.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "نام تب لازم است." }); return; }
    await addTab(spreadsheetId, name);
    res.json({ success: true, name });
  } catch (err) {
    fail(res, err, "Failed to create tab");
  }
});

// ─── GET /api/database/:target/tabs/:tab/rows — rows of a tab ─────────────────
router.get("/database/:target/tabs/:tab/rows", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveTarget(req.userId, req.params.target);
    const rows = await readTabRows(spreadsheetId, req.params.tab);
    res.json({ tab: req.params.tab, rows, count: rows.length });
  } catch (err) {
    fail(res, err, "Failed to read rows");
  }
});

// ─── POST /api/database/:target/tabs/:tab/rows — create a row ─────────────────
router.post("/database/:target/tabs/:tab/rows", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveTarget(req.userId, req.params.target);
    const key = String(req.body?.key ?? "").trim();
    if (!key) { res.status(400).json({ error: "کلید (key) لازم است." }); return; }
    if (await rowExists(spreadsheetId, req.params.tab, key)) {
      res.status(409).json({ error: "این کلید از قبل وجود دارد." });
      return;
    }
    await upsertRow(spreadsheetId, req.params.tab, key, req.body?.value ?? "");
    res.json({ success: true, key });
  } catch (err) {
    fail(res, err, "Failed to create row");
  }
});

// ─── PUT /api/database/:target/tabs/:tab/rows/:key — upsert a row ─────────────
router.put("/database/:target/tabs/:tab/rows/:key", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveTarget(req.userId, req.params.target);
    const result = await upsertRow(spreadsheetId, req.params.tab, req.params.key, req.body?.value ?? "");
    res.json({ success: true, key: req.params.key, ...result });
  } catch (err) {
    fail(res, err, "Failed to save row");
  }
});

// ─── DELETE /api/database/:target/tabs/:tab/rows/:key — delete a row ──────────
router.delete("/database/:target/tabs/:tab/rows/:key", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveTarget(req.userId, req.params.target);
    const ok = await deleteRow(spreadsheetId, req.params.tab, req.params.key);
    if (!ok) { res.status(404).json({ error: "ردیف پیدا نشد." }); return; }
    res.json({ success: true });
  } catch (err) {
    fail(res, err, "Failed to delete row");
  }
});

export default router;
