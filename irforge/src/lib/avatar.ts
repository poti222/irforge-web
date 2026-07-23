/**
 * avatar.ts
 * ─────────────────────────────────────────────────────────
 * تابع مشترک برای گرفتن آواتار با اولویت‌بندی صحیح.
 * همه جا از این استفاده کن — سایدبار، هدر، هرجا.
 *
 * اولویت:
 *   ۱. telegramPhotoUrl  (جدیدترین و بهترین منبع)
 *   ۲. avatar            (عکس دستی آپلود شده)
 *   ۳. ""                (خالی → AvatarFallback خودش نشون می‌ده)
 */

type AvatarUser = {
  telegramPhotoUrl?: string | null;
  avatar?: string | null;
};

export function getDisplayAvatar(user: AvatarUser): string {
  return user.telegramPhotoUrl || user.avatar || "";
}
