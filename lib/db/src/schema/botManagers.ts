/**
 * schema/botManagers.ts — «مدیرِ دعوت‌شده‌ی یک بات».
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز فقط **مالک** بات می‌توانست از سایت مدیریتش کند. کد ادمین هم صرفاً
 * یک توکن فعال‌سازی برای خودِ مالک بود. یعنی اگر می‌خواستی مدیریت یک بات را
 * به کسی بسپاری، هیچ راهی نبود.
 *
 * این جدول همان واگذاری را ثبت می‌کند: کاربر کد ادمین بات را در پروفایلش
 * وارد می‌کند و یک **دسترسیِ ثبت‌شده** می‌گیرد.
 *
 * سه قیدی که این را از یک «توکن حامل» جدا می‌کند — و دلیل وجود این جدول
 * به‌جای پذیرفتنِ ساده‌ی کد در هر درخواست:
 *
 *   ۱. **ثبت می‌شود.** مالک می‌بیند چه کسی و از چه زمانی دسترسی دارد.
 *   ۲. **قابل ابطال است.** مالک می‌تواند حذفش کند؛ یک کد لو‌رفته تا ابد
 *      معتبر نمی‌ماند.
 *   ۳. **محدود به همان یک بات است** و فقط پنل مدیریت را باز می‌کند — نه حذف
 *      بات، نه ساخت کد تازه، نه هیچ عملیات مالکیتی. آن‌ها با
 *      `requireBotOwnership` می‌مانند که عمداً دست‌نخورده ماند.
 */
import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const botManagersTable = pgTable(
  "bot_managers",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    userId: text("user_id").notNull(),
    /** چطور این دسترسی داده شد — امروز فقط `admin_code`. */
    grantedVia: text("granted_via").notNull().default("admin_code"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // یک کاربر برای یک بات فقط یک دسترسی دارد؛ وارد کردن دوباره‌ی کد
    // نباید ردیف تکراری بسازد.
    unique("bot_managers_bot_user_uniq").on(table.botId, table.userId),
  ],
);

export type BotManager = typeof botManagersTable.$inferSelect;
