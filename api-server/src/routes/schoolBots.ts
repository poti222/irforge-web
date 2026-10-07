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
 *   ۲) debitSchoolWallet (کیف‌پولِ مدرسه، نه شخصی) با همان executor (tx) — اگر موجودی کافی نباشد، کل
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
import { eq, and, inArray, sql } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import { resyncSchoolBot } from "../lib/schoolBotProfile";
import { getSchoolBotDiagnostics, siteBaseUrl } from "../lib/schoolBotCore";
import { requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { uploadedImagesTable } from "@workspace/db";
import { sniff } from "../lib/schoolBotPhoto";
import { getConnections, inviteText, adminGuideHtml, stripHtmlGuide } from "../lib/schoolBot/adminInfo";
import { debitSchoolWallet, SchoolWalletInsufficientError } from "../lib/schoolWallet";
import { rialToToman } from "../lib/currency";

const router = Router();

const SCHOOL_BOT_PRODUCT_ID = "school_bot_addon";

/**
 * پرتاب می‌شود تا تراکنش را rollback کند وقتی استخرِ توکن خالی است — دقیقاً
 * همان دلیلِ InsufficientBalanceError پایین (ببینید باگِ توضیح‌داده‌شده کنارِ
 * خودِ `db.transaction` پایین‌تر).
 */
class SchoolBotPoolEmptyError extends Error {}
class SchoolBotAlreadyPurchasedError extends Error {}

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

function formatBotStatus(bot: typeof schoolBotsTable.$inferSelect | null, priceToman: number | null, priceRial: number | null = null) {
  if (!bot) return { purchased: false, telegramUsername: null, botId: null, priceToman, priceRial };
  return { purchased: true, telegramUsername: bot.telegramUsername, botId: bot.id, priceToman, priceRial };
}

// GET /api/schools/:schoolId/bot — وضعیتِ بات (هر عضوِ مدرسه می‌تواند ببیند، چون دکمه‌ی اتصال در پروفایلِ همه است).
// `priceToman` هم همیشه برمی‌گردد (even when already purchased) — کارتِ
// خریدِ فرانت (SchoolBotCard) بدونِ یک فراخوانیِ دومِ جداگانه قیمت را نشان
// می‌دهد؛ کاربرِ مشکلِ گزارش‌شده («جایی اسمش wallet نبود») این بود که نه
// قیمت نه موجودیِ کیف‌پول هیچ‌جا کنارِ دکمه‌ی خرید نشان داده نمی‌شد.
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
    const [product] = await db.select({ price: productsTable.price }).from(productsTable)
      .where(and(eq(productsTable.id, SCHOOL_BOT_PRODUCT_ID), eq(productsTable.isActive, true))).limit(1);
    res.json(formatBotStatus(bot ?? null, product ? rialToToman(product.price) : null, product ? product.price : null));
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

    // خریدِ بات از «کیف‌پولِ مدرسه» کسر می‌شود (lib/schoolWallet.ts)، نه کیف‌پولِ شخصیِ مدیر — این دو عمداً جدا هستند.
    let createdBotId: string | null = null;
    let claimedTokenPlain: string | null = null;

    try {
      await db.transaction(async (tx: any) => {
        // دو خریدِ هم‌زمانِ یک مدرسه پشتِ هم صف می‌شوند تا (با موجودیِ دو برابرِ قیمت) دو بات ساخته نشود.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"school-bot:" + schoolId}))`);
        const [dup] = await tx.select({ id: schoolBotsTable.id }).from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
        if (dup) throw new SchoolBotAlreadyPurchasedError();
        const claimed = await claimFreeSchoolBotToken(tx, schoolId);
        if (!claimed) {
          // باگِ واقعی که اینجا بود: قبلاً این مسیر فقط یک پرچم ست می‌کرد و
          // `return` می‌کرد. drizzle فقط با throw-کردن از داخلِ callback
          // تراکنش را rollback می‌کند (نگاه کن node-postgres/session.js:
          // transaction() همیشه commit می‌کند مگر callback throw کند) — یک
          // return ساده یعنی commit با همان نوشته‌هایی که تا همان‌جا رفته‌اند.
          // اینجا هنوز چیزی نوشته نشده (claim همین‌جا null برگشت)، پس این شاخه
          // عملاً بی‌خطر بود، ولی شاخه‌ی زیر (insufficientBalance) نبود.
          throw new SchoolBotPoolEmptyError();
        }

        const botId = crypto.randomUUID();
        const paid = await debitSchoolWallet({
          schoolId, amountRial: product.price, type: "spend", refId: botId, createdByUserId: req.userId,
          description: `خریدِ بات اطلاع‌رسانیِ مدرسه «${school.name}»`,
        }, tx);
        if (!paid) {
          // موجودیِ کیف‌پولِ مدرسه کافی نیست. باید throw شود (نه return): drizzle فقط با throw تراکنش را rollback می‌کند و
          // return یعنی commitِ claimِ توکنِ استخر — همان باگی که قبلاً توکن‌ها را می‌سوزاند (توضیحِ بالا). با throw توکن
          // دوباره "available" می‌ماند و چیزی کسر/ساخته نمی‌شود.
          throw new SchoolWalletInsufficientError();
        }

        const [botRow] = await tx.insert(schoolBotsTable).values({
          id: botId,
          schoolId,
          botTokenPoolId: claimed.id,
        }).returning();

        await tx.insert(productPurchasesTable).values({
          id: crypto.randomUUID(),
          userId: req.userId,
          productId: product.id,
          status: "active",
          metadata: { schoolId, schoolBotId: botRow.id, paidFrom: "school_wallet" },
        });

        createdBotId = botRow.id;
        try {
          claimedTokenPlain = decryptToken(claimed.botToken);
        } catch (err) {
          logger.error({ err, poolId: claimed.id }, "school bot purchase: token decrypt failed after claim");
        }
      });
    } catch (err) {
      if (err instanceof SchoolBotAlreadyPurchasedError) {
        res.status(409).json({ error: "این مدرسه قبلاً باتِ اطلاع‌رسانی خریده است.", code: "already_purchased" });
        return;
      }
      if (err instanceof SchoolBotPoolEmptyError) {
        res.status(409).json({
          error: "در حالِ حاضر هیچ ظرفیتِ باتی موجود نیست. لطفاً بعداً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",
          code: "pool_empty",
        });
        return;
      }
      if (err instanceof SchoolWalletInsufficientError) {
        res.status(409).json({ error: "موجودیِ کیف‌پولِ مدرسه کافی نیست.", code: "insufficient" });
        return;
      }
      throw err;
    }

    if (!createdBotId) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // ─── بعد از commit: همگام‌سازیِ کاملِ بات (هویت، webhook، نام، عکس، توضیح، دستورها) — best-effort ───
    // شکستش خریدِ ثبت‌شده را rollback نمی‌کند؛ مدیر هر وقت بخواهد با «اتصال بات / بروزرسانی بات» دوباره می‌زند.
    // (منتظر می‌مانیم تا username در پاسخ باشد.)
    try {
      await resyncSchoolBot(schoolId, req);
    } catch (err) {
      logger.warn({ err, botId: createdBotId }, "school bot purchase: resync failed (non-fatal)");
    }

    const [finalBot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.id, createdBotId)).limit(1);
    res.status(201).json(formatBotStatus(finalBot ?? null, rialToToman(product.price), product.price));
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

// ─── اتصال/بروزرسانی بات + عیب‌یابی (مدیر و سوپرادمین) ───────────────────────────────────────
const superGuard = [requireSuperAdmin, requireSuperGate] as const;

async function resyncHandler(req: any, res: any, schoolId: string) {
  try {
    const result = await resyncSchoolBot(schoolId, req);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "School bot resync error");
    res.status(500).json({ error: "Internal server error" });
  }
}
async function diagnosticsHandler(req: any, res: any, schoolId: string) {
  try {
    res.json(await getSchoolBotDiagnostics(schoolId, siteBaseUrl(req)));
  } catch (err) {
    logger.error({ err }, "School bot diagnostics error");
    res.status(500).json({ error: "Internal server error" });
  }
}
router.post("/schools/:schoolId/bot/resync", requireAuth, async (req: any, res) => {
  const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
  if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
  await resyncHandler(req, res, req.params.schoolId);
});
router.get("/schools/:schoolId/bot/diagnostics", requireAuth, async (req: any, res) => {
  const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
  if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
  await diagnosticsHandler(req, res, req.params.schoolId);
});
router.post("/super/schools/:schoolId/bot/resync", ...superGuard, (req: any, res) => resyncHandler(req, res, req.params.schoolId));
router.get("/super/schools/:schoolId/bot/diagnostics", ...superGuard, (req: any, res) => diagnosticsHandler(req, res, req.params.schoolId));

// GET /api/schools/:schoolId/bot/admin-info — مدیر: راهنما، متنِ دعوت (آمادهٔ کپی) و وضعیتِ اتصالِ اعضا (فقط نام‌ها).
router.get("/schools/:schoolId/bot/admin-info", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["admin", "deputy", "deputy_discipline"]);
    if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, req.params.schoolId)).limit(1);
    const [school] = await db.select({ name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, req.params.schoolId)).limit(1);
    const uname = bot?.telegramUsername ?? null;
    res.json({
      botLink: uname ? `https://t.me/${uname}` : null,
      inviteText: inviteText(school?.name ?? "مدرسه", uname),
      guide: stripHtmlGuide(adminGuideHtml(school?.name ?? "مدرسه", uname)),
      connections: await getConnections(req.params.schoolId),
      photo: bot ? { status: bot.photoStatus, syncedUrl: bot.photoSyncedUrl, lastResyncAt: bot.lastResyncAt } : null,
    });
  } catch (err) {
    logger.error({ err }, "School bot admin-info error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/bot/photo { url: "/api/uploads/images/<uuid>" } — مرورگرِ مدیر عکسِ مدرسه را (WebP/GIF) به JPEG
// تبدیل و با /api/uploads/images آپلود کرده؛ این‌جا فقط به عنوانِ عکسِ بات برایِ photoUrlِ *فعلیِ* مدرسه ثبت و اعمال می‌شود.
router.post("/schools/:schoolId/bot/photo", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
    if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
    const m = /^\/api\/uploads\/images\/([0-9a-f-]{36})$/.exec(String(req.body?.url ?? ""));
    if (!m) { res.status(400).json({ error: "Invalid url" }); return; }
    const [img] = await db.select({ data: uploadedImagesTable.data }).from(uploadedImagesTable).where(eq(uploadedImagesTable.id, m[1])).limit(1);
    if (!img || sniff(Buffer.from(img.data as any)) !== "jpeg") { res.status(400).json({ error: "Image must be a JPEG", code: "not_jpeg" }); return; }
    const [school] = await db.select({ photoUrl: schoolsTable.photoUrl }).from(schoolsTable).where(eq(schoolsTable.id, req.params.schoolId)).limit(1);
    const [bot] = await db.select({ id: schoolBotsTable.id }).from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, req.params.schoolId)).limit(1);
    if (!school || !bot) { res.status(404).json({ error: "Not found" }); return; }
    await db.update(schoolBotsTable).set({ photoJpegImageId: m[1], photoJpegSourceUrl: school.photoUrl ?? null }).where(eq(schoolBotsTable.id, bot.id));
    await resyncHandler(req, res, req.params.schoolId);
  } catch (err) {
    logger.error({ err }, "School bot photo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
