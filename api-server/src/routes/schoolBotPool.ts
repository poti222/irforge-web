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
import { db, schoolBotTokenPoolTable, schoolsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireSuperAdmin } from "./auth";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import { tgApi } from "../lib/telegram";

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
