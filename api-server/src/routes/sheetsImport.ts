/**
 * routes/sheetsImport.ts — IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۲.
 *
 * دکمه‌ی سوپرادمین کنارِ «Cutover Flags» — نه برای سویچ‌کردنِ یک entity
 * سراسری، بلکه برای مهاجرتِ واقعیِ دیتای یک بات مشخص: «تمامی اطلاعاتِ این
 * بات از Google Sheets خوانده شود و توی Postgres بازنویسی شود، بعد همین یک
 * بات روی Postgres فعال شود» — همان چیزی که کاربر خواسته بود، نه یک flip
 * خالیِ پرچمِ سراسری که پشتش هیچ دیتایی نیست.
 *
 * خودِ کپیِ Sheets→Postgres اینجا انجام نمی‌شود (سایت مستقیم به آن ۸۳
 * repository دسترسی ندارد) — فقط یک ردیفِ `pending` در
 * `sheets_import_requests` می‌گذارد؛ workerِ خودِ بات
 * (`services/sheets_import.py`) آن را برمی‌دارد و واقعاً اجرا می‌کند.
 */
import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, botsTable, usersTable } from "@workspace/db";
import { requireSuperAdmin } from "./auth.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import {
  enqueueSheetsImport,
  listTenantImportStatuses,
  listRecentSheetsImportRequests,
} from "../lib/sheetsImport.js";

const router = Router();

// ─── GET /superadmin/sheets-import/bots ────────────────────────────────────
// هر بات + مالکش + وضعیتِ ایمپورتِ تننتش (اگر شیت دارد).

router.get("/superadmin/sheets-import/bots", requireSuperAdmin, async (_req, res) => {
  try {
    const bots = await db
      .select({ id: botsTable.id, name: botsTable.name, username: botsTable.username, sheetId: botsTable.sheetId, userId: botsTable.userId })
      .from(botsTable);

    const sheetIds: (string | null)[] = bots.map((b: { sheetId: string | null }) => b.sheetId);
    const tenantIds: string[] = [...new Set(sheetIds.filter((id: string | null): id is string => Boolean(id)))];
    const statuses = await listTenantImportStatuses(tenantIds);

    const enriched = await Promise.all(
      bots.map(async (bot: { id: string; name: string; username: string | null; sheetId: string | null; userId: string }) => {
        const [owner] = await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, bot.userId))
          .limit(1);
        return {
          id: bot.id,
          name: bot.name,
          username: bot.username,
          sheetId: bot.sheetId ?? null,
          owner: owner ?? null,
          status: bot.sheetId ? statuses.get(bot.sheetId) ?? null : null,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "GET /superadmin/sheets-import/bots failed");
    res.status(500).json({ error: "خواندنِ فهرستِ بات‌ها ممکن نشد." });
  }
});

// ─── GET /superadmin/sheets-import/requests ────────────────────────────────
// «یک تب که خرابی یا تعدادِ بات‌ها/دیتاها را ببینم» — آخرین درخواست‌ها روی
// همه‌ی تننت‌ها، جدید-به-قدیم.

router.get("/superadmin/sheets-import/requests", requireSuperAdmin, async (_req, res) => {
  try {
    const requests = await listRecentSheetsImportRequests(200);
    res.json(requests);
  } catch (err) {
    logger.error({ err }, "GET /superadmin/sheets-import/requests failed");
    res.status(500).json({ error: "خواندنِ فهرستِ درخواست‌ها ممکن نشد." });
  }
});

// ─── POST /superadmin/sheets-import/:botId ─────────────────────────────────
// «توسط من» — یک بات مشخص را صف کن.

router.post("/superadmin/sheets-import/:botId", requireSuperAdmin, async (req: any, res) => {
  const { botId } = req.params;
  try {
    const [bot] = await db
      .select({ id: botsTable.id, sheetId: botsTable.sheetId })
      .from(botsTable)
      .where(eq(botsTable.id, botId))
      .limit(1);
    if (!bot) {
      res.status(404).json({ error: "بات پیدا نشد." });
      return;
    }
    if (!bot.sheetId) {
      res.status(400).json({ error: "این بات هنوز شیتی ندارد — چیزی برای مهاجرت نیست." });
      return;
    }

    const request = await enqueueSheetsImport(bot.sheetId, req.userId);
    await writeAudit({
      actorUserId: req.userId,
      action: "sheets_import_requested",
      metadata: { botId, tenantId: bot.sheetId, requestId: request.id },
    });
    res.json(request);
  } catch (err) {
    logger.error({ err, botId }, "POST /superadmin/sheets-import/:botId failed");
    res.status(500).json({ error: "درخواستِ مهاجرت ثبت نشد." });
  }
});

// ─── POST /superadmin/sheets-import/bulk ───────────────────────────────────
// «هر بات جدیدی که ساخته میشه یا توسط من» — مهاجرتِ دسته‌ایِ چند بات با
// یک کلیک (مثلاً همه‌ی بات‌های موجود، یک‌بار برای همیشه).

router.post("/superadmin/sheets-import/bulk", requireSuperAdmin, async (req: any, res) => {
  const { botIds } = req.body ?? {};
  if (!Array.isArray(botIds) || botIds.length === 0) {
    res.status(400).json({ error: "بدنه باید { botIds: string[] } باشد." });
    return;
  }
  try {
    const bots = await db
      .select({ id: botsTable.id, sheetId: botsTable.sheetId })
      .from(botsTable)
      .where(inArray(botsTable.id, botIds));

    const results: { botId: string; ok: boolean; requestId?: string; error?: string }[] = [];
    for (const bot of bots) {
      if (!bot.sheetId) {
        results.push({ botId: bot.id, ok: false, error: "no_sheet" });
        continue;
      }
      try {
        const request = await enqueueSheetsImport(bot.sheetId, req.userId);
        results.push({ botId: bot.id, ok: true, requestId: request.id });
      } catch (err) {
        logger.error({ err, botId: bot.id }, "bulk sheets-import: enqueue failed for one bot");
        results.push({ botId: bot.id, ok: false, error: "enqueue_failed" });
      }
    }

    await writeAudit({
      actorUserId: req.userId,
      action: "sheets_import_requested",
      metadata: { bulk: true, botIds, queued: results.filter((r) => r.ok).length },
    });
    res.json({ results });
  } catch (err) {
    logger.error({ err }, "POST /superadmin/sheets-import/bulk failed");
    res.status(500).json({ error: "درخواستِ دسته‌ای مهاجرت ثبت نشد." });
  }
});

export default router;
