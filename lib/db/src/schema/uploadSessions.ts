/**
 * schema/uploadSessions.ts — «با بات بفرست».
 * ─────────────────────────────────────────────────────────────────────────────
 * بعضی چیزها را نمی‌شود در یک فرم وب تایپ کرد: یک پیام تلگرامی با فرمت کامل،
 * یک ویس ضبط‌شده، یک عکسی که همین الان روی گوشی است. راه‌حل، یک جلسه‌ی
 * کوتاه‌عمرِ «ضبط» است: سایت یک لینک عمیق به بات پلتفرم می‌سازد
 * (`t.me/<bot>?start=upload_<id>`)، کاربر پیامش را همان‌جا می‌فرستد، و بات
 * محتوایش را در همین ردیف می‌نشاند تا سایت برش دارد.
 *
 * **چرا داده‌ی سایت است و نه شیت تننت؟** این یک وضعیت گذراست، نه پیکربندی
 * بات. هیچ‌وقت به شیت نمی‌رود و بعد از استفاده یا انقضا دور ریخته می‌شود.
 *
 * ⚠️ **`file_id` ذخیره می‌شود، نه `(chat_id, message_id)` برای کپی مستقیم.**
 * پیامی که کاربر به **بات پلتفرم** می‌دهد در چتی است که بات تننت اصلاً به آن
 * دسترسی ندارد، پس `copy_message` بین این دو کار نمی‌کند. ولی `file_id`
 * تلگرام قابل استفاده توسط هر باتی برای *ارسال* است، پس بات تننت می‌تواند
 * همان محتوا را دوباره بفرستد. `entities` هم ذخیره می‌شود تا فرمت متن
 * (بولد، لینک، …) مو‌به‌مو بازتولید شود.
 */
import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const uploadSessionsTable = pgTable(
  "bot_upload_sessions",
  {
    /** همان چیزی که در `?start=upload_<id>` می‌رود — پس باید غیرقابل حدس باشد. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** باتی که این محتوا برایش جمع می‌شود (فقط برای ممیزی و محدودسازی). */
    botId: text("bot_id"),
    /** کجای سایت این را خواسته — `broadcast`، `panel_media`, … */
    kind: text("kind").notNull(),

    /** `pending` → `waiting` (کاربر استارت زده) → `filled` | `expired`. */
    status: text("status").notNull().default("pending"),

    // ─── محتوای ضبط‌شده ───────────────────────────────────────────────
    /** چتِ کاربر با بات پلتفرم — برای ارسال پیام تأیید به خودش. */
    chatId: text("chat_id"),
    messageId: text("message_id"),
    /** `text` | `photo` | `voice` | `audio` | `video` | `document` | `animation` */
    mediaType: text("media_type"),
    fileId: text("file_id"),
    /** متن پیام یا کپشن مدیا. */
    content: text("content"),
    /** `entities` یا `caption_entities` تلگرام — برای بازتولید دقیق فرمت. */
    entities: jsonb("entities"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** جلسه‌ی مصرف‌نشده بعد از این زمان بی‌اعتبار است. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // وبهوک با `chat_id` دنبال جلسه‌ی باز می‌گردد؛ بدون این ایندکس، هر پیامِ
    // بات پلتفرم یک اسکن کامل جدول است.
    index("bot_upload_sessions_chat_idx").on(table.chatId, table.status),
  ],
);

export type UploadSession = typeof uploadSessionsTable.$inferSelect;
