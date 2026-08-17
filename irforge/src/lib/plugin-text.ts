/**
 * plugin-text.ts — نام و توضیح پلاگین به زبان کاربر.
 *
 * مانیفست هر پلاگین دو زبان دارد (`name`/`name_fa` و `description`/
 * `description_fa`). قبلاً هر جای UI خودش تصمیم می‌گرفت کدام را نشان دهد و
 * تقریباً همه‌جا `name_fa || name` بود — یعنی کاربرِ انگلیسی هم فارسی می‌دید.
 * بدتر اینکه توضیح‌ها در مانیفست‌ها یکدست نبودند، پس فهرست پلاگین‌ها در هر
 * زبانی قاطی دیده می‌شد.
 *
 * یک تابع، یک قاعده: فارسی برای `fa`، انگلیسی برای بقیه، و اگر زبانِ خواسته‌شده
 * خالی بود به آن یکی می‌افتد — چون یک متنِ به‌زبانِ-دیگر از یک رشته‌ی خالی بهتر
 * است.
 *
 * عربی/ترکی/روسی عمداً انگلیسی می‌گیرند: مانیفست‌ها فقط دو زبان دارند و ترجمه‌ی
 * ماشینیِ توضیح محصول بدتر از انگلیسیِ درست است.
 */

export type PluginTextSource = {
  name?: string | null;
  name_fa?: string | null;
  description?: string | null;
  description_fa?: string | null;
};

function pick(fa: string | null | undefined, en: string | null | undefined, isFa: boolean): string {
  const persian = (fa ?? "").trim();
  const english = (en ?? "").trim();
  if (isFa) return persian || english;
  return english || persian;
}

export function pluginName(plugin: PluginTextSource, lang: string, fallback = ""): string {
  return pick(plugin.name_fa, plugin.name, lang === "fa") || fallback;
}

export function pluginDescription(plugin: PluginTextSource, lang: string): string {
  return pick(plugin.description_fa, plugin.description, lang === "fa");
}
