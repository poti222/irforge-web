/**
 * bot-tiers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PRODUCTS_PHASES_3_TO_6_PROMPT Phase 5: this file used to hold the
 * hardcoded Standard/Pro tier data (`BOT_TIERS`/`getBotTier()`) that the
 * products-section rework (see PROGRESS.md's `[products-section]` entries)
 * replaced with a real, database-backed source — `GET /api/products`
 * (Phase 2's `products` table, category="bot") is now the only place that
 * data lives, read via `hooks/use-products.ts`. `BOT_TIERS`/`getBotTier()`
 * were deleted outright once their last consumers (`buy-bot.tsx`/
 * `buy-bot-detail.tsx` in Phase 3, `admin-user-detail.tsx`/`LandingPlans.tsx`
 * in Phase 5) stopped reading them — left in place, they'd have been exactly
 * the kind of unused split-source trap Phase 1 flagged in `pluginPricing.ts`.
 *
 * What's left here is genuinely type-only / still-in-use: `BotTierId` (a
 * bot's `tier` column still stores these three literal strings — "custom"
 * included, even though it has no `products` row of its own since the
 * self-serve custom builder is a separate, disabled-for-now path per
 * `buy-bot.tsx`'s own comment) and the custom-package module checklist
 * (`CustomModule`/`CUSTOM_MODULES`/`CUSTOM_MAX_RAM_GB`/`CUSTOM_MAX_CPU_CORES`),
 * which was explicitly out of scope for the products migration.
 */

export type BotTierId = "standard" | "pro" | "custom";

/** Ceiling on the self-serve custom builder. Admins are not bound by this. */
export const CUSTOM_MAX_RAM_GB = 8;
export const CUSTOM_MAX_CPU_CORES = 8;

/**
 * چک‌لیست ماژول‌های بات برای کارت «سفارشی» — فعلاً کاملاً نمایشی (بدون منطق
 * قیمت‌گذاری یا اتصال به بک‌اند). بخشی که "mandatory: true" باشد به‌صورت
 * تیک‌خورده و غیرقابل تغییر نمایش داده می‌شود.
 */
export interface CustomModule {
  id: string;
  name: { fa: string; en: string };
  mandatory: boolean;
}

export const CUSTOM_MODULES: CustomModule[] = [
  { id: "core", name: { fa: "هسته‌ی اصلی ربات", en: "Bot core engine" }, mandatory: true },
  { id: "dashboard", name: { fa: "پنل مدیریت", en: "Admin dashboard" }, mandatory: true },
  { id: "wallet", name: { fa: "اتصال به کیف پول", en: "Wallet integration" }, mandatory: true },
  { id: "broadcast", name: { fa: "پیام همگانی (Broadcast)", en: "Broadcast messaging" }, mandatory: false },
  { id: "payments", name: { fa: "درگاه پرداخت اختصاصی", en: "Custom payment gateway" }, mandatory: false },
  { id: "analytics", name: { fa: "آنالیتیکس پیشرفته", en: "Advanced analytics" }, mandatory: false },
  { id: "multi-admin", name: { fa: "چند ادمینی", en: "Multi-admin access" }, mandatory: false },
  { id: "custom-theme", name: { fa: "قالب اختصاصی", en: "Custom theme" }, mandatory: false },
  { id: "api-access", name: { fa: "دسترسی API", en: "API access" }, mandatory: false },
  { id: "webhooks", name: { fa: "وب‌هوک‌ها", en: "Webhooks" }, mandatory: false },
];
