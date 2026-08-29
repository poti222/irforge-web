/**
 * lib/profile.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * یک تعریف واحد از «پروفایل کامل» — هم برای دروازه‌ی خرید (خودِ این فایل، از
 * قبل) و هم برای دروازه‌ی اجباریِ تکمیل هویت (Mandatory Profile Completion).
 * این دو عمداً **یک** قاعده‌اند، نه دو تای موازی روی یک ستون: هر دو
 * `users.profile_complete` را می‌نویسند، و دو قانونِ متفاوت روی یک ستون یعنی
 * هرکدام آخر بار اجرا شده مقدارِ دیگری را زیرِ پا می‌گذارد. پس این فایل
 * اَبَرمجموعه‌ی هر دو نیاز است: هرچه قبلاً برای خرید لازم بود، هنوز لازم است؛
 * هرچه ویزارد تکمیل هویت تازه اضافه کرده هم لازم است.
 *
 * فیلدهای لازم: نام و نام خانوادگی، ایمیل، شماره‌ی **تأییدشده**، شناسه‌ی عددی
 * تلگرام، یوزرنیم تلگرام، جنسیت، یوزرنیمِ پلتفرم، و رمزِ عبور.
 *
 * ── چرا یوزرنیم تلگرام فرق دارد ──────────────────────────────────────────────
 * `telegramUsername` سمت تلگرام **اختیاری** است: یک حساب کاملاً واقعی می‌تواند
 * اصلاً یوزرنیم نداشته باشد و Bot API آن فیلد را حذف می‌کند. برخورد با آن مثل
 * بقیه‌ی فیلدها یعنی مسدود کردن خریدارانی که هیچ‌وقت یوزرنیم نگذاشته‌اند و هیچ
 * راهی هم برای فهمیدنش ندارند.
 *
 * پس این یک شرطِ **نرم** با مسیر خودخدمتی است: وقتی همه چیز کامل است و فقط
 * یوزرنیم غایب است، `missing` شامل `telegramUsername` می‌شود ولی UI به‌جای یک
 * پیام بن‌بست، صفحه‌ای نشان می‌دهد که می‌گوید در تلگرام (تنظیمات ← Username)
 * یوزرنیم بگذارید و یک دکمه‌ی «دوباره بررسی کن» می‌دهد.
 *
 * ── چرا رمز عبور برای حساب‌های OAuth استثناست ────────────────────────────────
 * کسی که با گوگل/گیت‌هاب حساب ساخته یک `passwordHash` تصادفی و ناشناخته دارد
 * (ببینید GET /auth/google/callback و GET /auth/github/callback) — او هرگز
 * این رمز را تایپ نکرده و نمی‌داند، پس truthy بودنِ passwordHash به‌تنهایی
 * «رمزِ واقعی دارد» را ثابت نمی‌کند. `oauthProvider` همان تمایز را می‌دهد؛
 * چنین حسابی همیشه از این یک فیلد معاف است.
 */
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ProfileField =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "phoneVerified"
  | "telegramId"
  | "telegramUsername"
  | "gender"
  | "platformUsername"
  | "password";

export interface ProfileCheck {
  complete: boolean;
  missing: ProfileField[];
  /** فقط یوزرنیمِ تلگرام مانده — حالتی که مسیر خودخدمتی مخصوص خودش را دارد. */
  onlyUsernameMissing: boolean;
}

type UserLike = Pick<
  typeof usersTable.$inferSelect,
  | "name"
  | "email"
  | "phone"
  | "phoneVerified"
  | "telegramId"
  | "telegramUsername"
  | "gender"
  | "platformUsername"
  | "passwordHash"
  | "oauthProvider"
>;

export function checkProfile(user: UserLike): ProfileCheck {
  const missing: ProfileField[] = [];

  // نام کامل به دو بخش تقسیم می‌شود؛ ستون `name` یک رشته‌ی واحد است.
  const parts = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) missing.push("firstName");
  if (parts.length < 2) missing.push("lastName");

  if (!user.email || user.email.trim() === "") missing.push("email");
  if (!user.phone || user.phone.trim() === "") missing.push("phone");
  else if (!user.phoneVerified) missing.push("phoneVerified");
  if (!user.telegramId) missing.push("telegramId");
  if (!user.telegramUsername) missing.push("telegramUsername");
  if (!user.gender) missing.push("gender");
  if (!user.platformUsername) missing.push("platformUsername");
  if (!user.passwordHash && !user.oauthProvider) missing.push("password");

  const onlyUsernameMissing = missing.length === 1 && missing[0] === "telegramUsername";
  return { complete: missing.length === 0, missing, onlyUsernameMissing };
}

/**
 * بررسی می‌کند و ستون موجود `users.profileComplete` را همگام نگه می‌دارد.
 * ستون از قبل وجود داشت — به‌جای اضافه‌کردن یکی دیگر، همان به‌روز می‌شود.
 */
export async function assertProfileComplete(userId: string): Promise<ProfileCheck> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return { complete: false, missing: ["email"], onlyUsernameMissing: false };

  const result = checkProfile(user);
  if (user.profileComplete !== result.complete) {
    await db
      .update(usersTable)
      .set({ profileComplete: result.complete })
      .where(eq(usersTable.id, userId))
      .catch(() => {});
  }
  return result;
}

/**
 * میدل‌ور دروازه‌ی خرید.
 *
 * پاسخ ساختاریافته است تا UI بتواند دقیقاً نام ببرد چه چیزی کم است — یک ۴۰۳
 * بی‌جزئیات کاربر را وادار به حدس‌زدن می‌کند.
 */
export function requireCompleteProfile() {
  return async (req: any, res: any, next: any) => {
    const result = await assertProfileComplete(req.userId);
    if (!result.complete) {
      res.status(403).json({
        error: "profile_incomplete",
        missing: result.missing,
        onlyUsernameMissing: result.onlyUsernameMissing,
      });
      return;
    }
    next();
  };
}
