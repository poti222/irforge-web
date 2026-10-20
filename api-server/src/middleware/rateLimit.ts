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
import { eq, sql } from "drizzle-orm";
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
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - windowMs).toISOString();
  const blockIso = blockMs > 0 ? new Date(now.getTime() + blockMs).toISOString() : null;
  try {
    /**
     * یک دستور اتمیک (INSERT … ON CONFLICT DO UPDATE).
     *
     * نسخه‌ی قبلی اول SELECT می‌زد و بعد UPDATE؛ N درخواست هم‌زمان همه یک
     * `count` یکسان می‌خواندند و شمارنده فقط یک واحد بالا می‌رفت — یعنی با
     * ارسال موازی، سقف هر محدودیت (IP، شماره، …) عملاً وجود نداشت. اینجا
     * خودِ دیتابیس افزایش را سریالایز می‌کند.
     *
     * منطق همان قبلی است: بلاکِ فعال شمارنده را تغییر نمی‌دهد؛ پنجره‌ی
     * منقضی شمارنده را به ۱ برمی‌گرداند؛ عبور از سقف (در صورت blockMs)
     * بلاک می‌گذارد.
     */
    const result: any = await db.execute(sql`
      INSERT INTO auth_rate_limits (key, count, window_started_at, blocked_until)
      VALUES (${key}, 1, ${nowIso}::timestamptz, NULL)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN auth_rate_limits.blocked_until IS NOT NULL
               AND auth_rate_limits.blocked_until > ${nowIso}::timestamptz
            THEN auth_rate_limits.count
          WHEN auth_rate_limits.window_started_at <= ${cutoffIso}::timestamptz THEN 1
          ELSE auth_rate_limits.count + 1
        END,
        window_started_at = CASE
          WHEN (auth_rate_limits.blocked_until IS NULL
                OR auth_rate_limits.blocked_until <= ${nowIso}::timestamptz)
               AND auth_rate_limits.window_started_at <= ${cutoffIso}::timestamptz
            THEN ${nowIso}::timestamptz
          ELSE auth_rate_limits.window_started_at
        END,
        blocked_until = CASE
          WHEN auth_rate_limits.blocked_until IS NOT NULL
               AND auth_rate_limits.blocked_until > ${nowIso}::timestamptz
            THEN auth_rate_limits.blocked_until
          WHEN auth_rate_limits.window_started_at <= ${cutoffIso}::timestamptz THEN NULL
          WHEN auth_rate_limits.count + 1 > ${limit} AND ${blockIso}::timestamptz IS NOT NULL
            THEN ${blockIso}::timestamptz
          ELSE auth_rate_limits.blocked_until
        END
      RETURNING count, window_started_at AS "windowStartedAt", blocked_until AS "blockedUntil"
    `);
    const row = (result?.rows ?? result)?.[0];
    if (!row) return { allowed: true, retryAfterSeconds: 0 };

    const count = Number(row.count);
    const blockedUntil = row.blockedUntil ? new Date(row.blockedUntil) : null;
    if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000),
      };
    }
    if (count > limit) {
      const windowStartedAt = new Date(row.windowStartedAt);
      const windowAge = now.getTime() - windowStartedAt.getTime();
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - windowAge) / 1000)),
      };
    }
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

/**
 * IP کلاینت.
 *
 * ⚠️ قبلاً **اولین** مقدار `X-Forwarded-For` برداشته می‌شد — ولی همان مقداری
 * است که خودِ کلاینت می‌فرستد؛ پراکسی فقط IP واقعی را به **انتهای** لیست
 * اضافه می‌کند. با یک هدر جعلی در هر درخواست، همه‌ی محدودیت‌های IP بی‌اثر
 * بودند. حالا مقدارِ `TRUSTED_PROXY_HOPS`-ام از انتها برداشته می‌شود
 * (پیش‌فرض ۱ = یک پراکسی مورد اعتماد، مثل Railway). اگر جلوی Railway یک CDN
 * هم هست مقدار را ۲ بگذارید. مقدار ۰ یعنی هدر را نادیده بگیر.
 */
export function clientIp(req: Request): string {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  const hops = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 1;
  if (hops > 0) {
    const fwd = req.headers["x-forwarded-for"];
    const joined = Array.isArray(fwd) ? fwd.join(",") : String(fwd ?? "");
    const parts = joined.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[Math.max(0, parts.length - hops)].slice(0, 64);
    }
  }
  return String(req.socket?.remoteAddress || req.ip || "unknown").trim().slice(0, 64);
}

/** IRFORGE_PROMPT_V3 Phase 5.2 — the JSON body already carried
 * retryAfterSeconds; a real `Retry-After` header lets a spec-compliant HTTP
 * client (and any browser devtools inspecting the response) back off
 * correctly without parsing the body, and a translated message replaces the
 * generic English one the UI otherwise has nothing to show.
 *
 * Exported (IRFORGE_SMS_OTP_PROMPT Phase 3) so other rate limiters — e.g.
 * lib/smsOtpRateLimit.ts — can reuse the exact same 429 shape instead of a
 * second, slightly-different helper living in two places. */
export function send429(res: Response, retryAfterSeconds: number, message = "چند لحظه صبر کنید و دوباره تلاش کنید."): void {
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.status(429).json({
    error: message,
    code: "rate_limited",
    retryAfterSeconds,
  });
}

/**
 * محدودیت per-IP روی اندپوینت‌های احراز هویت.
 * `scope` فقط برای خوانایی کلید است؛ سقف مشترک است تا کسی نتواند با پخش‌کردن
 * درخواست‌ها بین چند اندپوینت از آن رد شود.
 */
// `hitFn` on the three functions below defaults to `hit` (the real,
// DB-backed limiter) in production. Tests substitute a fake so the verdict
// is deterministic without a live Postgres — ES module named exports are
// read-only from the importing side, so `rateLimit.hit = fake` isn't
// possible; passing it as a parameter is.
type HitFn = typeof hit;
export type { HitFn };

export function authRateLimit(scope: string, hitFn: HitFn = hit) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const verdict = await hitFn(`ip:${clientIp(req)}`, IP_LIMIT);
    if (!verdict.allowed) {
      logger.warn({ scope, ip: clientIp(req) }, "auth rate limit: IP blocked");
      send429(res, verdict.retryAfterSeconds);
      return;
    }
    next();
  };
}

/**
 * IRFORGE_PROMPT_V3 Phase 5.2 — a generous limiter for `/api` as a whole, so
 * an unauthenticated scan can't walk every route at full speed. Deliberately
 * far above what any real user session needs; this is a backstop, not a
 * feature limit — the per-route limiters below are where the real ceilings
 * for expensive endpoints live.
 */
export const GLOBAL_IP_LIMIT_PER_MINUTE = 300;

export function globalRateLimit(req: Request, res: Response, next: NextFunction, hitFn: HitFn = hit): void {
  hitFn(`global-ip:${clientIp(req)}`, GLOBAL_IP_LIMIT_PER_MINUTE, 0, 60 * 1000)
    .then((verdict) => {
      if (!verdict.allowed) {
        logger.warn({ ip: clientIp(req), path: req.path }, "global rate limit: IP blocked");
        send429(res, verdict.retryAfterSeconds);
        return;
      }
      next();
    })
    .catch((err) => {
      logger.error({ err }, "globalRateLimit failed (allowing request)");
      next();
    });
}

/**
 * IRFORGE_PROMPT_V3 Phase 5.2 — tighter, per-route limits for expensive
 * operations (bot creation, backup export/restore, media upload, broadcast,
 * translate-all, any CSV export), keyed **per user**, not per IP — an
 * attacker with one account behind a proxy pool defeats an IP-only limit,
 * and these routes all require auth (`requireAuth` sets `req.userId`)
 * before this can run.
 */
export function perUserRateLimit(scope: string, limit: number, windowMs = WINDOW_MS, hitFn: HitFn = hit) {
  return async (req: Request & { userId?: string }, res: Response, next: NextFunction) => {
    if (!req.userId) {
      // requireAuth must run first; if it didn't, fail closed rather than
      // rate-limiting nothing under a shared "anonymous" key.
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const verdict = await hitFn(`user:${scope}:${req.userId}`, limit, 0, windowMs);
    if (!verdict.allowed) {
      logger.warn({ scope, userId: req.userId }, "per-user rate limit: blocked");
      send429(res, verdict.retryAfterSeconds);
      return;
    }
    next();
  };
}

/** کلید محدودیتِ ورودهای ناموفق یک شماره. */
export function phoneKey(phone: string): string {
  return `phone:${phone}`;
}

/** IRFORGE_PROMPT_V3 Phase 14 — همان کلید، برای ورود با ایمیل. */
export function emailKey(email: string): string {
  return `email:${email}`;
}
