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

/**
 * IRFORGE_PRODUCTS_PHASES_3_TO_6_PROMPT Phase 6: `products` rows come back
 * from the API as `{name, nameFa, description, descriptionFa}` (camelCase —
 * routes/products.ts's `formatProduct()`, matching this whole repo's REST
 * convention), not the snake_case `{name_fa, description_fa}` plugin
 * manifests use above. `PluginTextSource`'s fields are all optional, so
 * TypeScript accepts a `Product` passed straight into `pluginName()`/
 * `pluginDescription()` with zero error — every field it reads (`name_fa`,
 * `description_fa`) is silently `undefined`, and the fa/en fallback
 * degrades exactly like the `marketplace_items` bug this file's own header
 * comment cites: an English-language viewer would see `name` fine (English
 * is the fallback branch), but a Farsi viewer would see `name` too, not
 * `nameFa` — the opposite direction of that bug, same root cause (the two
 * language columns not lining up with what the picker function reads).
 * `productName()`/`productDescription()` below are the camelCase-aware
 * counterparts — the correct thing to call for anything shaped like a
 * `products` row.
 */
export type ProductTextSource = {
  name?: string | null;
  nameFa?: string | null;
  description?: string | null;
  descriptionFa?: string | null;
};

export function productName(product: ProductTextSource, lang: string, fallback = ""): string {
  return pick(product.nameFa, product.name, lang === "fa") || fallback;
}

export function productDescription(product: ProductTextSource, lang: string): string {
  return pick(product.descriptionFa, product.description, lang === "fa");
}
