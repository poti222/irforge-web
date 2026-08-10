/**
 * routes/guest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * دسترسی مهمان: کسی بتواند بدون حساب وارد شود و نگاه کند.
 *
 * ── دو تصمیم که کل امنیت این فیچر روی آن‌هاست ────────────────────────────────
 *
 * ۱. **مهمان یک ردیف `users` نیست.** ساختن کاربر با `role: "guest"` با ایندکس
 *    یکتای شماره تداخل می‌کرد، هر شمارش کاربر و کوئری صورت‌حساب را آلوده
 *    می‌کرد، و روت ورود را برای همیشه مجبور می‌کرد ردیف‌های بدون رمز را استثنا
 *    کند.
 *
 * ۲. **توکن مهمان نوعِ متفاوتی از توکن نشست کاربر است** و میدل‌ور احراز هویت
 *    **پیش‌فرض-رد** است: `requireAuth` مهمان را رد می‌کند، نقطه. روت‌های
 *    فقط-خواندنی یکی‌یکی با `allowGuest` وارد می‌شوند. اگر هویت مهمان از همان
 *    مسیر هویت کاربر رد می‌شد، یک بررسی جاافتاده هر اندپوینت احراز هویت‌شده را
 *    ناشناس می‌کرد — پرخطرترین بخش این فیچر همین است و دلیل پیش‌فرض-رد بودن.
 */
import { Router } from "express";
import crypto from "crypto";
import { db, guestSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

/** نشست مهمان ۳۰ روز. پاک‌سازی در بوت انجام می‌شود (فاز ۱). */
const GUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * پیشوند عمدی و متمایز. هیچ‌جا با توکن نشست کاربر (که `<userId>.<hex>` است)
 * اشتباه گرفته نمی‌شود، و `requireAuth` صریحاً ردش می‌کند.
 */
export const GUEST_TOKEN_PREFIX = "guest_";

export function isGuestToken(token: string | undefined | null): boolean {
  return typeof token === "string" && token.startsWith(GUEST_TOKEN_PREFIX);
}

// ─── POST /api/guest/session ─────────────────────────────────────────────────
router.post("/guest/session", async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const token = `${GUEST_TOKEN_PREFIX}${id}`;
    const expiresAt = new Date(Date.now() + GUEST_TTL_MS);
    const locale = typeof req.body?.locale === "string" ? req.body.locale.slice(0, 8) : null;

    await db.insert(guestSessionsTable).values({ id, expiresAt, locale });

    res.status(201).json({ token, expiresAt: expiresAt.toISOString(), guest: true });
  } catch (err) {
    logger.error({ err }, "guest/session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/guest/me ───────────────────────────────────────────────────────
// عمداً شکل کاربر را تقلید نمی‌کند: هیچ فیلد جعلیِ پروفایل برنمی‌گردد.
router.get("/guest/me", async (req: any, res) => {
  try {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!isGuestToken(token)) {
      res.status(401).json({ error: "Not a guest session" });
      return;
    }
    const id = token.slice(GUEST_TOKEN_PREFIX.length);
    const [row] = await db
      .select()
      .from(guestSessionsTable)
      .where(eq(guestSessionsTable.id, id))
      .limit(1);
    if (!row || row.expiresAt < new Date()) {
      res.status(401).json({ error: "Guest session expired" });
      return;
    }
    await db
      .update(guestSessionsTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(guestSessionsTable.id, id));

    res.json({ guest: true, id: row.id, expiresAt: row.expiresAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "guest/me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/guest/convert ─────────────────────────────────────────────────
// وقتی مهمان ثبت‌نام یا ورود کرد: سبد منتقل می‌شود، ردیف مهمان علامت می‌خورد.
// بقیه‌ی چیزها دور ریخته می‌شوند — بنر همین را صریح می‌گوید.
router.post("/guest/convert", async (req: any, res) => {
  try {
    const guestToken = req.body?.guestToken;
    const userId = req.body?.userId;
    if (!isGuestToken(guestToken) || typeof userId !== "string" || userId === "") {
      res.status(400).json({ error: "Invalid conversion" });
      return;
    }
    const id = String(guestToken).slice(GUEST_TOKEN_PREFIX.length);
    await db
      .update(guestSessionsTable)
      .set({ convertedUserId: userId })
      .where(eq(guestSessionsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "guest/convert error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
