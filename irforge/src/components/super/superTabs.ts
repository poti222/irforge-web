/**
 * components/super/superTabs.ts — فهرستِ تب‌هایِ `/super` (بدونِ React؛ قابلِ تست).
 *
 * منبعِ یگانه‌یِ «چه تب‌هایی هست، در کدام گروه، با چه نامی»؛ `pages/super.tsx` برایِ هر شناسه آیکن و محتوا را
 * (با `Record<SuperTabId, …>`، یعنی فراموش‌کردنِ یک تب خطایِ کامپایل است) می‌گذارد و `SuperOverview` از همین‌جا می‌داند
 * هر مورد از «نیازمندِ توجه» به کدام تب می‌پرد.
 */
export const SUPER_GROUPS_META = [
  { id: "home", fa: "شروع", en: "Start", tabs: [
    { id: "overview", fa: "نمای کلی", en: "Overview" },
  ] },
  { id: "people", fa: "کاربران و مدارس", en: "People & schools", tabs: [
    { id: "users", fa: "کاربران", en: "Users" },
    { id: "bots", fa: "همه ربات‌ها", en: "All bots" },
    { id: "schools", fa: "مدارس", en: "Schools" },
  ] },
  { id: "money", fa: "مالی", en: "Finance", tabs: [
    { id: "payments", fa: "پرداخت‌ها", en: "Payments" },
    { id: "cardpay", fa: "کارت‌به‌کارتِ خودکار", en: "Auto card payments" },
  ] },
  { id: "commerce", fa: "فروش", en: "Commerce", tabs: [
    { id: "plans", fa: "پلن‌ها و نرخ ارز", en: "Plans & exchange rate" },
    { id: "products", fa: "محصولات", en: "Products" },
    { id: "discounts", fa: "تخفیف‌ها", en: "Discounts" },
  ] },
  { id: "content", fa: "محتوا و اطلاع‌رسانی", en: "Content", tabs: [
    { id: "announcements", fa: "اعلان‌ها", en: "Announcements" },
    { id: "updates", fa: "آپدیت‌ها", en: "Updates" },
    { id: "pluginNotes", fa: "یادداشتِ پلاگین‌ها", en: "Plugin notes" },
  ] },
  { id: "support", fa: "پشتیبانی و ثبت‌نام", en: "Support & signups", tabs: [
    { id: "tickets", fa: "تیکت‌ها", en: "Tickets" },
    { id: "signups", fa: "ثبت‌نام‌ها و هویتِ آزمایشی", en: "Signups & test identities" },
  ] },
  { id: "infra", fa: "زیرساخت", en: "Infrastructure", tabs: [
    { id: "sheetPool", fa: "استخر شیت", en: "Sheet pool" },
    { id: "schoolBotPool", fa: "استخر باتِ مدرسه", en: "School bot pool" },
    { id: "cutover", fa: "سوییچِ Sheets/Postgres", en: "Sheets/Postgres cutover" },
    { id: "sheetsImport", fa: "ایمپورتِ Sheets", en: "Sheets import" },
  ] },
  { id: "settings", fa: "تنظیمات و ردپا", en: "Settings & audit", tabs: [
    { id: "settings", fa: "تنظیماتِ سایت", en: "Site settings" },
    { id: "audit", fa: "ردپای سراسری", en: "Audit trail" },
  ] },
] as const;

export type SuperTabId = (typeof SUPER_GROUPS_META)[number]["tabs"][number]["id"];

export interface SuperTabMeta { id: SuperTabId; fa: string; en: string }
/** همه‌یِ تب‌ها به‌ترتیبِ نمایش (تخت). */
export const SUPER_TAB_META: readonly SuperTabMeta[] = SUPER_GROUPS_META.flatMap((g) => g.tabs as readonly SuperTabMeta[]);
export const SUPER_TAB_IDS: readonly SuperTabId[] = SUPER_TAB_META.map((t) => t.id);
export const DEFAULT_SUPER_TAB: SuperTabId = "overview";

export function isSuperTab(id: string | null | undefined): id is SuperTabId {
  return !!id && (SUPER_TAB_IDS as readonly string[]).includes(id);
}

/** تبِ اولیه از `?tab=`؛ ناشناخته/خالی → نمایِ کلی (نه صفحه‌یِ خالی). */
export function readInitialTab(search: string): SuperTabId {
  const t = new URLSearchParams(search).get("tab");
  return isSuperTab(t) ? t : DEFAULT_SUPER_TAB;
}

/** هر موردِ «نیازمندِ توجه» (کلیدِ `/api/super/overview` → attention) به کدام تب می‌پرد. */
export const ATTENTION_TABS = {
  pendingWalletReceipts: "payments",
  cardPaymentsAwaitingReview: "cardpay",
  openTickets: "tickets",
  pendingSignups: "signups",
  silentPaymentChannels: "cardpay",
} as const satisfies Record<string, SuperTabId>;
