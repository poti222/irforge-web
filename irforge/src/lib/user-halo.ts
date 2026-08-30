/**
 * user-halo.ts — هاله‌ی رنگیِ نقش/جنسیت روی ردیف/کارتِ یک کاربر در فهرست‌های
 * ادمین — فاز ۵ (identityverificationspec.md).
 *
 * منطقِ سطح‌بندی این‌جا تکرار نمی‌شود چون دوباره‌نویسی‌اش در هر فهرست، دقیقاً
 * همان خطری بود که این فایل حلش می‌کند: دو فهرستِ کاربران (پنل ادمین و صفحه‌ی
 * «مدیریت کاربران») دو کپیِ جدا از این تابع داشتند، و یکی‌شان (مدیریت کاربران)
 * از اول اصلاً هاله نداشت — یعنی کاربری که آن‌جا را می‌دید، بسته به این‌که کدام
 * فهرست را باز کرده، رنگ می‌دید یا نمی‌دید.
 *
 * اولویت: super_admin (مشکی، هرگز دست‌نخورده — «دست نزن برای سوپرها») >
 * admin (طلایی، حتی اگر آن ادمین male/female هم باشد) > جنسیت > هیچ‌کدام.
 * چون role دقیقاً یکی از این سه مقدار است، هیچ‌وقت دو تا از این سه با هم
 * برخورد نمی‌کنند — فقط جنسیت و نقش رقابت می‌کنند، که همان چیزی است که
 * ترتیب زیر حل می‌کند.
 *
 * فقط دسکتاپ: قصدش این نیست که موبایل را هم پوشش بدهد — پیشوندِ ریسپانسیوِ
 * خودِ کلاس (`md:`) این را تأمین می‌کند، زیر `md` هیچ گرادیانی رنگ نمی‌شود.
 */
export function getRowHaloClass(u: { role: string; gender?: "male" | "female" | null }): string {
  if (u.role === "super_admin") return "md:[background:linear-gradient(to_right,rgba(0,0,0,0.35),transparent)]";
  if (u.role === "admin") return "md:[background:linear-gradient(to_right,rgba(234,179,8,0.35),transparent)]";
  if (u.gender === "male") return "md:[background:linear-gradient(to_right,rgba(96,165,250,0.35),transparent)]";
  if (u.gender === "female") return "md:[background:linear-gradient(to_right,rgba(244,114,182,0.35),transparent)]";
  return "";
}
