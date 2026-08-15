/**
 * schema/platformSettings.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * یک جدول key/value برای تنظیمات **سطح پلتفرم** — چیزهایی که مالک سایت
 * تنظیم می‌کند و به هیچ کاربر یا باتی گره نخورده‌اند.
 *
 * تا امروز سایت هیچ‌جایی برای این نوع داده نداشت، و نتیجه‌اش این بود که
 * صفحه‌ی کیف پول از کاربر «هش تراکنش» می‌خواست ولی هیچ‌وقت **آدرس مقصد**
 * را نشانش نمی‌داد — یعنی عملاً واریز تتر غیرقابل انجام بود. همین‌طور
 * کارت‌به‌کارت، که شماره‌ی کارتی برای نمایش نداشت.
 *
 * چرا key/value و نه ستون‌های صریح؟ چون این تنظیمات کمِ کم تغییر می‌کنند و
 * تعدادشان با هر قابلیت جدید زیاد می‌شود؛ با این شکل، افزودن یک تنظیم جدید
 * فقط یک تغییر در `lib/platformSettings.ts` است، نه یک مایگریشن دیگر.
 *
 * ⚠️ این جدول برای «راز» نیست. هرچه اینجا گذاشته شود ممکن است به کلاینت
 * فرستاده شود؛ توکن و کلید همچنان فقط در env می‌مانند.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const platformSettingsTable = pgTable("platform_settings", {
  /** شناسه‌ی تنظیم، مثلاً `payment_methods`. */
  key: text("key").primaryKey(),
  /** مقدار، همیشه JSON سریال‌شده (`JSON.stringify`). */
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  /** آخرین کسی که تغییرش داده — برای ممیزی. */
  updatedBy: text("updated_by"),
});

export type PlatformSetting = typeof platformSettingsTable.$inferSelect;
