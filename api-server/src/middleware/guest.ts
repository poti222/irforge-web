/**
 * middleware/guest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `allowGuest` — تنها راهی که یک مهمان می‌تواند به یک روت برسد.
 *
 * پیش‌فرض کل سیستم **رد** است: `requireAuth` توکن مهمان را نمی‌پذیرد. هر روتی
 * که باید برای مهمان باز باشد، باید صریحاً و یکی‌یکی این میدل‌ور را بگیرد.
 *
 * مهمان **می‌تواند**: پوسته‌ی داشبورد، بات‌های نمونه، /learn و /pricing، و
 * افزودن به سبد.
 * مهمان **نمی‌تواند**: خرید، ساخت یا مالکیت بات، تیکت، کیف پول، یا خواندن و
 * نوشتن هر چیزی که به یک کاربر واقعی تعلق دارد.
 *
 * این‌ها سمت **سرور** اعمال می‌شوند. یک دکمه‌ی غیرفعال اعمال نیست.
 */
import type { Request, Response, NextFunction } from "express";
import { db, guestSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isGuestToken, GUEST_TOKEN_PREFIX } from "../routes/guest";
import { requireAuth } from "../routes/auth";

/**
 * روت را هم برای کاربر احراز هویت‌شده و هم برای مهمانِ معتبر باز می‌کند.
 * وقتی مهمان است `req.isGuest = true` و `req.userId` **ست نمی‌شود** — تا هیچ
 * کد پایین‌دستی نتواند اشتباهی مهمان را صاحب داده فرض کند.
 */
export function allowGuest(req: any, res: Response, next: NextFunction) {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");

  if (!isGuestToken(token)) {
    // کاربر عادی — مسیر همیشگی، بدون تخفیف.
    requireAuth(req, res, next);
    return;
  }

  const id = token.slice(GUEST_TOKEN_PREFIX.length);
  db.select()
    .from(guestSessionsTable)
    .where(eq(guestSessionsTable.id, id))
    .limit(1)
    .then((rows) => {
      const row = rows[0];
      if (!row || row.expiresAt < new Date()) {
        res.status(401).json({ error: "Guest session expired" });
        return;
      }
      req.isGuest = true;
      req.guestId = row.id;
      next();
    })
    .catch(() => res.status(500).json({ error: "Internal server error" }));
}

/**
 * روی روت‌هایی که `allowGuest` دارند ولی بخشی از کارشان نوشتن است.
 * برمی‌گرداند 403 با کدی که UI به «برای این کار ثبت‌نام کنید» تبدیل می‌کند.
 */
export function denyGuestWrite(req: any, res: Response, next: NextFunction) {
  if (req.isGuest) {
    res.status(403).json({
      error: "Create an account to do this",
      code: "guest_forbidden",
    });
    return;
  }
  next();
}
