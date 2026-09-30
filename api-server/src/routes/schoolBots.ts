/**
 * routes/schoolBots.ts — بخش "/schools" فاز ۷ (بخش A + B): خریدِ «بات
 * اطلاع‌رسانی» برایِ یک مدرسه از کیف‌پول، و اتصالِ اعضا به آن بات.
 * ─────────────────────────────────────────────────────────────────────────
 * خرید (POST .../bot/purchase) — همه‌چیز در **یک تراکنش**:
 *   ۱) claimFreeSchoolBotToken: دقیقاً همان الگویِ claimFreeSheet در
 *      routes/bots.ts (FOR UPDATE SKIP LOCKED) — یک ردیفِ "available" را
 *      اتمیک "assigned" می‌کند. اگر استخر خالی باشد، این‌جا null برمی‌گردد و
 *      تراکنش قبل از دست‌زدن به کیف‌پول rollback می‌شود — یعنی هیچ‌وقت پولِ
 *      کاربر بابتِ چیزی که موجود نیست کسر نمی‌شود.
 *   ۲) deductWallet با همان executor (tx) — اگر موجودی کافی نباشد، کل
 *      تراکنش (شاملِ claim بالا) rollback می‌شود؛ توکن به‌خودیِ‌خود دوباره
 *      "available" می‌ماند (چون commit نشد).
 *   ۳) insert در school_bots + product_purchases.
 * بعد از commit (best-effort، شکستش خریدِ ثبت‌شده را rollback نمی‌کند):
 *   - تغییرِ نامِ پروفایلِ بات به نامِ مدرسه (setMyName)
 *   - fetchBotIdentity برایِ گرفتنِ username/id واقعی
 *   - ثبتِ webhookِ همین بات (فازِ ۷ بخشِ B) روی مسیرِ اختصاصیِ خودش.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolBotTokenPoolTable, schoolBotsTable, schoolBotSubscribersTable, schoolBotLinkTokensTable,
  schoolsTable, productsTable, productPurchasesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import { tgApi, fetchBotIdentity, telegramWebhookSecret } from "../lib/telegram";
import { deductWallet, ensureWallet } from "../lib/wallet";

const router = Router();

const SCHOOL_BOT_PRODUCT_ID = "school_bot_addon";

/**
 * اتمیک: یک ردیفِ "available" از استخر می‌گیرد و "assigned" می‌کند —
 * دقیقاً همان الگویِ claimFreeSheet (bots.ts) با FOR UPDATE SKIP LOCKED،
 * پس دو خریدِ هم‌زمان هرگز یک توکن را دوبار نمی‌گیرند.
 */
async function claimFreeSchoolBotToken(tx: any, schoolId: string) {
  const picked = tx
    .select({ id: schoolBotTokenPoolTable.id })
    .from(schoolBotTokenPoolTable)
    .where(eq(schoolBotTokenPoolTable.status, "available"))
    .limit(1)
    .for("update", { skipLocked: true });

  const [claimed] = await tx
    .update(schoolBotTokenPoolTable)
    .set({ status: "assigned", assignedSchoolId: schoolId })
    .where(inArray(schoolBotTokenPoolTable.id, picked))
    .returning();

  return claimed ?? null;
}

function formatBotStatus(bot: typeof schoolBotsTable.$inferSelect | null) {
  if (!bot) return { purchased: false, telegramUsername: null, botId: null };
  return { purchased: true, telegramUsername: bot.telegramUsername, botId: bot.id };
}

// GET /api/schools/:schoolId/bot — وضعیتِ بات (هر عضوِ مدرسه می‌تواند ببیند، چون دکمه‌ی اتصال در پروفایلِ همه است).
router.get("/schools/:schoolId/bot", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, req.params.schoolId)).limit(1);
    res.json(formatBotStatus(bot ?? null));
  } catch (err) {
    logger.error({ err }, "Get school bot status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/bot/purchase — فقط مدیرِ مدرسه.
router.post("/schools/:schoolId/bot/purchase", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const schoolId = req.params.schoolId;

    const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
    if (!school) {
      res.status(404).json({ error: "School not found" });
      return;
    }

    const [existing] = await db.select({ id: schoolBotsTable.id }).from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
    if (existing) {
      res.status(409).json({ error: "این مدرسه قبلاً باتِ اطلاع‌رسانی خریده است.", code: "already_purchased" });
      return;
    }

    const [product] = await db.select().from(productsTable)
      .where(and(eq(productsTable.id, SCHOOL_BOT_PRODUCT_ID), eq(productsTable.isActive, true))).limit(1);
    if (!product) {
      res.status(400).json({ error: "محصولِ بات اطلاع‌رسانی در حالِ حاضر فعال نیست." });
      return;
    }

    await ensureWallet(req.userId);

    let insufficientBalance = false;
    let poolEmpty = false;
    let createdBotId: string | null = null;
    let claimedTokenPlain: string | null = null;

    await db.transaction(async (tx: any) => {
      const claimed = await claimFreeSchoolBotToken(tx, schoolId);
      if (!claimed) {
        poolEmpty = true;
        return; // rollback — کیف‌پول اصلاً لمس نمی‌شود.
      }

      const paid = await deductWallet(req.userId, product.price, `خریدِ بات اطلاع‌رسانیِ مدرسه «${school.name}»`, tx, "spend");
      if (!paid) {
        insufficientBalance = true;
        return; // rollback — claim بالا هم با آن برمی‌گردد (توکن دوباره available می‌ماند).
      }

      const [botRow] = await tx.insert(schoolBotsTable).values({
        id: crypto.randomUUID(),
        schoolId,
        botTokenPoolId: claimed.id,
      }).returning();

      await tx.insert(productPurchasesTable).values({
        id: crypto.randomUUID(),
        userId: req.userId,
        productId: product.id,
        status: "active",
        metadata: { schoolId, schoolBotId: botRow.id },
      });

      createdBotId = botRow.id;
      try {
        claimedTokenPlain = decryptToken(claimed.botToken);
      } catch (err) {
        logger.error({ err, poolId: claimed.id }, "school bot purchase: token decrypt failed after claim");
      }
    });

    if (poolEmpty) {
      res.status(409).json({
        error: "در حالِ حاضر هیچ ظرفیتِ باتی موجود نیست. لطفاً بعداً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",
        code: "pool_empty",
      });
      return;
    }
    if (insufficientBalance) {
      res.status(400).json({ error: "موجودیِ کیف‌پول کافی نیست.", code: "insufficient" });
      return;
    }
    if (!createdBotId) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // ─── بعد از commit: تغییرِ نام + شناسه‌یِ واقعیِ بات + webhook — best-effort ───
    // شکستِ هرکدام خریدِ ثبت‌شده (که همین الان commit شده) را rollback نمی‌کند؛
    // فقط لاگ می‌شود. مدیر می‌تواند بعداً از همین صفحه دوباره وضعیت را ببیند.
    if (claimedTokenPlain) {
      const token: string = claimedTokenPlain;
      try {
        await tgApi(token, "setMyName", { name: school.name });
      } catch (err) {
        logger.warn({ err, botId: createdBotId }, "school bot purchase: setMyName failed (non-fatal)");
      }
      const identity = await fetchBotIdentity(token);
      if (identity.username) {
        await db.update(schoolBotsTable)
          .set({ telegramUsername: identity.username, telegramBotId: (await tgApi<{ id: number }>(token, "getMe")).result?.id?.toString() ?? null })
          .where(eq(schoolBotsTable.id, createdBotId));
      }
      const siteUrl = process.env.PUBLIC_SITE_URL?.trim();
      if (siteUrl) {
        try {
          const url = `${siteUrl.replace(/\/+$/, "")}/api/schools/bot-webhook/${createdBotId}`;
          const result = await tgApi(token, "setWebhook", {
            url,
            secret_token: telegramWebhookSecret(token),
            allowed_updates: ["message"],
          });
          if (!result.ok) logger.warn({ url, result, botId: createdBotId }, "school bot webhook setWebhook did not return ok");
        } catch (err) {
          logger.warn({ err, botId: createdBotId }, "school bot purchase: webhook registration failed (non-fatal)");
        }
      } else {
        logger.info({ botId: createdBotId }, "school bot webhook not registered (PUBLIC_SITE_URL missing) — 'connect via bot' will be unavailable until it's set");
      }
    }

    const [finalBot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.id, createdBotId)).limit(1);
    res.status(201).json(formatBotStatus(finalBot ?? null));
  } catch (err) {
    logger.error({ err }, "Purchase school bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/bot/link-token — هر عضوِ مدرسه: توکنِ لینکِ عمیق `/start <token>` می‌سازد.
router.post("/schools/:schoolId/bot/link-token", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, req.params.schoolId)).limit(1);
    if (!bot || !bot.telegramUsername) {
      res.status(400).json({ error: "این مدرسه هنوز بات اطلاع‌رسانیِ فعال ندارد." });
      return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    await db.insert(schoolBotLinkTokensTable).values({
      token,
      schoolBotId: bot.id,
      userId: req.userId,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // ۳۰ دقیقه — همان بازه‌ی telegramLinkTokensTable
    });
    res.status(201).json({ token, deepLink: `https://t.me/${bot.telegramUsername}?start=${token}` });
  } catch (err) {
    logger.error({ err }, "Create school bot link token error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/bot/subscribed — آیا کاربرِ جاری به باتِ همین مدرسه وصل است؟
router.get("/schools/:schoolId/bot/subscribed", requireAuth, async (req: any, res) => {
  try {
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, req.params.schoolId)).limit(1);
    if (!bot) {
      res.json({ subscribed: false });
      return;
    }
    const [sub] = await db.select({ id: schoolBotSubscribersTable.id }).from(schoolBotSubscribersTable)
      .where(and(eq(schoolBotSubscribersTable.schoolBotId, bot.id), eq(schoolBotSubscribersTable.userId, req.userId)))
      .limit(1);
    res.json({ subscribed: !!sub });
  } catch (err) {
    logger.error({ err }, "Get school bot subscription status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
