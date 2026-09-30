/**
 * routes/schoolBotPool.ts — بخش "/schools" فاز ۷ (بخش A): مدیریتِ استخرِ
 * توکنِ باتِ مدرسه توسطِ سوپرادمین.
 * ─────────────────────────────────────────────────────────────────────────
 * دقیقاً همان الگویِ `/api/sheet-pool` در routes/bots.ts: سوپرادمین توکن‌هایِ
 * آماده (از BotFather) اضافه می‌کند، هرکدام "available" شروع می‌شوند و با
 * خریدِ باتِ یک مدرسه (routes/schoolBots.ts) "assigned" می‌شوند. این پنل
 * سطحِ **پلتفرم** است (سوپرادمینِ سایت)، نه پنلِ مدیرِ مدرسه.
 *
 * توکن هرگز متنِ خام برنمی‌گردد — نه در GET، نه در پاسخِ POST — فقط
 * fingerprint (۸ کاراکترِ آخر) برایِ تشخیصِ چشمی، دقیقاً همان محدودیتی که
 * bots.ts برای توکنِ بات‌هایِ عادی هم رعایت می‌کند.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolBotTokenPoolTable, schoolsTable, schoolBotsTable, schoolBotSubscribersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireSuperAdmin } from "./auth";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import { tgApi, fetchBotIdentity, telegramWebhookSecret } from "../lib/telegram";

const router = Router();

function tokenFingerprint(plainToken: string): string {
  return plainToken.slice(-8);
}

// POST /api/school-bot-pool — افزودنِ یک توکنِ تازه به استخر.
router.post("/school-bot-pool", requireSuperAdmin, async (req: any, res) => {
  try {
    const token = String(req.body?.botToken ?? "").trim();
    if (!token) {
      res.status(400).json({ error: "botToken is required" });
      return;
    }
    // چکِ اعتبار پیش از ذخیره — یک توکنِ باطل که بی‌صدا در استخر بنشیند، فقط
    // وقتی خریدِ اولین مدرسه به آن برسد کشف می‌شود، خیلی دیر.
    const me = await tgApi<{ username?: string }>(token, "getMe");
    if (!me.ok) {
      res.status(400).json({ error: "Telegram rejected this token (getMe failed) — double-check it's valid." });
      return;
    }
    const [entry] = await db.insert(schoolBotTokenPoolTable).values({
      id: crypto.randomUUID(),
      botToken: encryptToken(token),
      status: "available",
      addedByUserId: req.userId,
    }).returning();
    res.status(201).json({
      id: entry.id,
      status: entry.status,
      fingerprint: tokenFingerprint(token),
      telegramUsername: me.result?.username ?? null,
      createdAt: entry.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Add school bot pool token error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/school-bot-pool — فهرستِ کامل (بدونِ متنِ خامِ توکن).
router.get("/school-bot-pool", requireSuperAdmin, async (req: any, res) => {
  try {
    const entries = await db.select().from(schoolBotTokenPoolTable);
    const schoolIds = [...new Set(entries.map((e) => e.assignedSchoolId).filter((id): id is string => !!id))];
    const schools = schoolIds.length > 0
      ? await db.select({ id: schoolsTable.id, name: schoolsTable.name }).from(schoolsTable).where(inArray(schoolsTable.id, schoolIds))
      : [];
    const schoolsById = new Map(schools.map((s) => [s.id, s.name]));
    res.json(entries.map((e) => {
      let fingerprint: string | null = null;
      try {
        fingerprint = tokenFingerprint(decryptToken(e.botToken));
      } catch {
        fingerprint = null;
      }
      return {
        id: e.id,
        status: e.status,
        fingerprint,
        assignedSchoolId: e.assignedSchoolId,
        assignedSchoolName: e.assignedSchoolId ? (schoolsById.get(e.assignedSchoolId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      };
    }));
  } catch (err) {
    logger.error({ err }, "List school bot pool error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/school-bot-pool/:id/release — فازِ ۹ (بندِ ۴، از گزارشِ فازِ ۷): آزادسازیِ
// دستیِ یک توکنِ گیرکرده/نامعتبر — صرف‌نظر از وضعیتِ فعلی، status را "available"
// می‌کند. اگر واقعاً یک مدرسه (school_bots.bot_token_pool_id) به همین ردیف وصل
// باشد، آن باتِ مدرسه هم حذف می‌شود (به‌همراهِ مشترکینش) تا مدرسه بی‌صدا به
// توکنی اشاره نکند که استخر دیگر آزاد می‌داند — مدرسه باید دوباره بات بخرد
// (ساده‌ترینِ راهِ امن؛ swapِ خودکار کارِ endpointِ replace پایین‌تر است).
router.post("/school-bot-pool/:id/release", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;
    const [entry] = await db.select().from(schoolBotTokenPoolTable).where(eq(schoolBotTokenPoolTable.id, id)).limit(1);
    if (!entry) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [linkedBot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.botTokenPoolId, id)).limit(1);
    if (linkedBot) {
      await db.delete(schoolBotSubscribersTable).where(eq(schoolBotSubscribersTable.schoolBotId, linkedBot.id));
      await db.delete(schoolBotsTable).where(eq(schoolBotsTable.id, linkedBot.id));
    }
    const [updated] = await db.update(schoolBotTokenPoolTable)
      .set({ status: "available", assignedSchoolId: null })
      .where(eq(schoolBotTokenPoolTable.id, id))
      .returning();
    res.json({
      id: updated.id,
      status: updated.status,
      assignedSchoolId: updated.assignedSchoolId,
      releasedSchoolBotId: linkedBot?.id ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Release school bot pool token error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/school-bot-pool/:id/replace — فازِ ۹ (بندِ ۴): جایگزینیِ توکنِ خرابِ
// یک ردیف با توکنِ تازه، **بدونِ** از دست‌رفتنِ هویت/تاریخچه‌یِ باتِ مدرسه —
// چون school_bots فقط به id همین ردیفِ استخر (bot_token_pool_id) ارجاع
// می‌دهد نه به خودِ توکن، جایگزینی فقط ستونِ botToken را عوض می‌کند؛ اگر ردیف
// به یک مدرسه assign شده، username/webhook هم با توکنِ تازه دوباره ثبت می‌شود
// (secret_token از خودِ توکن مشتق می‌شود، پس با تغییرِ توکن باید setWebhook
// دوباره صدا زده شود).
router.post("/school-bot-pool/:id/replace", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;
    const token = String(req.body?.botToken ?? "").trim();
    if (!token) {
      res.status(400).json({ error: "botToken is required" });
      return;
    }
    const [entry] = await db.select().from(schoolBotTokenPoolTable).where(eq(schoolBotTokenPoolTable.id, id)).limit(1);
    if (!entry) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const me = await tgApi<{ id?: number; username?: string }>(token, "getMe");
    if (!me.ok) {
      res.status(400).json({ error: "Telegram rejected this token (getMe failed) — double-check it's valid." });
      return;
    }
    const [updated] = await db.update(schoolBotTokenPoolTable)
      .set({ botToken: encryptToken(token) })
      .where(eq(schoolBotTokenPoolTable.id, id))
      .returning();

    const [linkedBot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.botTokenPoolId, id)).limit(1);
    if (linkedBot) {
      const identity = await fetchBotIdentity(token);
      await db.update(schoolBotsTable)
        .set({
          telegramUsername: identity.username ?? linkedBot.telegramUsername,
          telegramBotId: me.result?.id?.toString() ?? linkedBot.telegramBotId,
        })
        .where(eq(schoolBotsTable.id, linkedBot.id));

      const siteUrl = process.env.PUBLIC_SITE_URL?.trim();
      if (siteUrl) {
        try {
          const url = `${siteUrl.replace(/\/+$/, "")}/api/schools/bot-webhook/${linkedBot.id}`;
          const result = await tgApi(token, "setWebhook", {
            url,
            secret_token: telegramWebhookSecret(token),
            allowed_updates: ["message"],
          });
          if (!result.ok) logger.warn({ url, result, schoolBotId: linkedBot.id }, "school bot pool replace: setWebhook did not return ok");
        } catch (err) {
          logger.warn({ err, schoolBotId: linkedBot.id }, "school bot pool replace: webhook registration failed (non-fatal)");
        }
      }
    }

    res.json({
      id: updated.id,
      status: updated.status,
      fingerprint: tokenFingerprint(token),
      assignedSchoolId: updated.assignedSchoolId,
    });
  } catch (err) {
    logger.error({ err }, "Replace school bot pool token error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/school-bot-pool/:id — فقط اگر "available" باشد (assigned یعنی یک مدرسه واقعاً از آن استفاده می‌کند).
router.delete("/school-bot-pool/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [entry] = await db.select().from(schoolBotTokenPoolTable).where(eq(schoolBotTokenPoolTable.id, req.params.id)).limit(1);
    if (!entry) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (entry.status === "assigned") {
      res.status(409).json({ error: "این توکن به یک مدرسه اختصاص داده شده و قابل حذف نیست." });
      return;
    }
    await db.delete(schoolBotTokenPoolTable).where(eq(schoolBotTokenPoolTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school bot pool token error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
