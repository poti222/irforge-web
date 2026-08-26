/**
 * plugin-sections.ts — کلید سکشن (از مانیفست بات) → کلید ترجمه‌ی نامش.
 *
 * مانیفست هر پلاگین `web_section` می‌دهد؛ یک کلید خام مثل `booking`. نام
 * ترجمه‌شده‌ی همان سکشن در namespace `botWorkspace` است. این نقشه آن دو را به
 * هم می‌رساند تا هر جایی که می‌خواهد بگوید «در بخش … مدیریتش کن» نامِ درست و
 * ترجمه‌شده را نشان دهد، نه یک کلید انگلیسی خام.
 *
 * قبلاً همین نقشه داخل `PluginsManager.tsx` بود؛ حالا سه جا لازمش دارند
 * (فهرست پلاگین‌ها، صفحه‌ی جزئیات، سکشن هر بات) و کپی‌کردنش یعنی سه نسخه که از
 * هم عقب می‌افتند.
 */
import type { LocaleShape } from "@/hooks/use-translation";

export const SECTION_LABEL_KEYS: Record<string, keyof LocaleShape["botWorkspace"]> = {
  tickets: "sectionTickets",
  loyalty: "sectionLoyalty",
  booking: "sectionBooking",
  subscriptions: "sectionSubscriptions",
  giveaways: "sectionGiveaways",
  surveys: "sectionSurveys",
  drip: "sectionDrip",
  crm: "sectionCrm",
  catalog: "sectionCatalog",
  wallet: "sectionWallet",
  orders: "sectionOrders",
  payments: "sectionPayments",
};
