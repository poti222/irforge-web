/**
 * middleware/rateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * محدودسازی نرخ برای اندپوینت‌های احراز هویت.
 *
 * یک کد ۶ رقمی یعنی یک میلیون حالت — بدون محدودیت، یک اسکریپت آن را در چند
 * دقیقه تمام می‌کند. این فایل بخشی از خودِ فیچر است، نه سخت‌سازیِ اختیاری.
 *
 * **وضعیت در دیتابیس است، نه در حافظه‌ی پروسه.** سرویس روی Railway اجرا
 * می‌شود: یک ری‌استارت یا یک اینستنس دوم نباید شمارنده را صفر کند، وگرنه
 * دور زدنِ محدودیت فقط به اندازه‌ی یک ری‌استارت فاصله دارد.
 */
import type { Request, Response, NextFunction } from "express";
import { db, authRateLimitsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export const WINDOW_MS = 15 * 60 * 1000;
/** سقف درخواست‌های احراز هویت از یک IP در پنجره. */
export const IP_LIMIT = 20;
/** سقف ورودهای ناموفق برای یک شماره، و مدت بلاک بعد از آن. */
export const PHONE_FAIL_LIMIT = 5;
export const PHONE_BLOCK_MS = 15 * 60 * 1000;

interface Verdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * یک ضربه به شمارنده‌ی `key` می‌زند و می‌گوید اجازه هست یا نه.
 *
 * پنجره کشویی نیست بلکه ثابت است: وقتی `windowStartedAt` قدیمی‌تر از پنجره
 * باشد شمارنده صفر می‌شود. برای این کاربرد کافی است و یک UPDATE ساده دارد.
 */
export async function hit(
  key: string,
  limit: number,
  blockMs = 0,
  windowMs = WINDOW_MS,
): Promise<Verdict> {
  const now = new Date();
  try {
    const [row] = await db
      .select()
      .from(authRateLimitsTable)
      .where(eq(authRateLimitsTable.key, key))
      .limit(1);

    if (!row) {
      await db
        .insert(authRateLimitsTable)
        .values({ key, count: 1, windowStartedAt: now })
        .onConflictDoNothing();
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (row.blockedUntil && row.blockedUntil.getTime() > now.getTime()) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((row.blockedUntil.getTime() - now.getTime()) / 1000),
      };
    }

    const windowAge = now.getTime() - row.windowStartedAt.getTime();
    if (windowAge > windowMs) {
      await db
        .update(authRateLimitsTable)
        .set({ count: 1, windowStartedAt: now, blockedUntil: null })
        .where(eq(authRateLimitsTable.key, key));
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const next = row.count + 1;
    if (next > limit) {
      const blockedUntil = blockMs > 0 ? new Date(now.getTime() + blockMs) : null;
      await db
        .update(authRateLimitsTable)
        .set({ count: next, blockedUntil })
        .where(eq(authRateLimitsTable.key, key));
      const retry = blockedUntil
        ? Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000)
        : Math.ceil((windowMs - windowAge) / 1000);
      return { allowed: false, retryAfterSeconds: retry };
    }

    await db
      .update(authRateLimitsTable)
      .set({ count: next })
      .where(eq(authRateLimitsTable.key, key));
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err) {
    // اگر خودِ محدودساز خراب شود، **اجازه می‌دهیم** — قفل‌کردن کل ورود سایت
    // به‌خاطر یک خطای دیتابیس بدتر از از دست دادن موقت محدودیت است. خطا لاگ
    // می‌شود تا دیده شود.
    logger.error({ err, key }, "rateLimit hit failed (allowing request)");
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** شمارنده‌ی یک کلید را صفر می‌کند — بعد از یک ورود موفق. */
export async function reset(key: string): Promise<void> {
  await db
    .update(authRateLimitsTable)
    .set({ count: 0, windowStartedAt: new Date(), blockedUntil: null })
    .where(eq(authRateLimitsTable.key, key))
    .catch(() => {});
}

/** IP کلاینت، با اعتماد به پراکسی Railway. */
export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : String(fwd ?? "").split(",")[0];
  return (first || req.ip || "unknown").trim().slice(0, 64);
}

/**
 * محدودیت per-IP روی اندپوینت‌های احراز هویت.
 * `scope` فقط برای خوانایی کلید است؛ سقف مشترک است تا کسی نتواند با پخش‌کردن
 * درخواست‌ها بین چند اندپوینت از آن رد شود.
 */
export function authRateLimit(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const verdict = await hit(`ip:${clientIp(req)}`, IP_LIMIT);
    if (!verdict.allowed) {
      logger.warn({ scope, ip: clientIp(req) }, "auth rate limit: IP blocked");
      res.status(429).json({
        error: "Too many requests. Please try again later.",
        code: "rate_limited",
        retryAfterSeconds: verdict.retryAfterSeconds,
      });
      return;
    }
    next();
  };
}

/** کلید محدودیتِ ورودهای ناموفق یک شماره. */
export function phoneKey(phone: string): string {
  return `phone:${phone}`;
}
