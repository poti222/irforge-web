/**
 * middleware/impersonation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * جعل هویت برای **دیدن** است، نه انجام دادن.
 *
 * توکن جعل هویت با `imp_<actorId>_<random>` شروع می‌شود، پس هر درخواستی که با
 * آن می‌آید قابل تشخیص است بدون یک کوئری اضافه. روی این نشست:
 *
 *   - اقدامات مخرب — خرید، حذف، تغییر رمز، جابه‌جایی کیف پول — کاملاً مسدودند.
 *   - هر نوشتنی در لاگ با **actor واقعی** برچسب می‌خورد، نه با کاربری که هویتش
 *     جعل شده.
 *
 * بدون این، «به حساب کاربر نگاه می‌کنم» و «به‌جای کاربر کاری کردم» در لاگ‌ها
 * از هم قابل تشخیص نبودند.
 */
import type { Response, NextFunction } from "express";

const IMPERSONATION_PREFIX = "imp_";

export function isImpersonationToken(token: string | undefined | null): boolean {
  return typeof token === "string" && token.startsWith(IMPERSONATION_PREFIX);
}

/** actor واقعی از داخل خود توکن — `imp_<actorId>_<random>`. */
export function impersonationActor(token: string): string | null {
  if (!isImpersonationToken(token)) return null;
  const rest = token.slice(IMPERSONATION_PREFIX.length);
  const idx = rest.lastIndexOf("_");
  return idx > 0 ? rest.slice(0, idx) : null;
}

/**
 * روی هر روت مخربی می‌نشیند. نشست عادی بی‌تأثیر رد می‌شود؛ نشست جعل هویت 403
 * می‌گیرد با کدی که UI به «در حالت جعل هویت نمی‌توانید این کار را بکنید»
 * تبدیل می‌کند.
 */
export function blockWhileImpersonating(req: any, res: Response, next: NextFunction) {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (isImpersonationToken(token)) {
    res.status(403).json({
      error: "This action is blocked during impersonation",
      code: "impersonation_readonly",
      actor: impersonationActor(token),
    });
    return;
  }
  next();
}
