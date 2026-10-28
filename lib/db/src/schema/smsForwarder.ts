/**
 * schema/smsForwarder.ts — «ارسال پیامک به تلگرام».
 *
 * برنامه‌ی پیامک‌خوانِ گوشی هر پیامکِ انتخاب‌شده را به **یک** وبهوکِ هر اکانت می‌فرستد؛ قانون‌ها (rules)
 * تعیین می‌کنند پیام به کدام مقصدِ تلگرام برود و از کدام مسیر (بات / اکانتِ شخصی / هر دو).
 *
 * ⚠️ منبعِ حقیقتِ DDL در پروداکشن `api-server/migrate.mjs` است (آینه: `lib/db/migrations/0065_sms_forwarder.sql`).
 * اینجا فقط برای این است که `drizzle-kit push` این جدول‌ها را «اضافه» نبیند و حذفشان نکند.
 */
import { pgTable, text, timestamp, boolean, integer, index, check, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const smsForwardAccountsTable = pgTable("sms_forward_accounts", {
  userId: text("user_id").primaryKey(),
  /** بخشِ عمومیِ آدرسِ وبهوک (`smf_…`)؛ راز نیست. */
  publicId: text("public_id").notNull().unique(),
  /** SHA-256 ِ secretِ وبهوک — خودِ secret فقط یک‌بار نمایش داده می‌شود. */
  secretHash: text("secret_hash").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** توکنِ باتِ خودِ کاربر، AES-256-GCM (lib/tokenCrypto.ts). */
  botTokenEnc: text("bot_token_enc"),
  botUsername: text("bot_username"),
  /** StringSessionِ اکانتِ شخصی (MTProto)، AES-256-GCM. */
  userbotSessionEnc: text("userbot_session_enc"),
  userbotLabel: text("userbot_label"),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const smsForwardRulesTable = pgTable(
  "sms_forward_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** خالی = هر فرستنده */
    senderFilter: text("sender_filter").array().notNull().default(sql`'{}'`),
    /** null = هر متن */
    keyword: text("keyword"),
    /** bot | userbot | both (both = اول اکانتِ شخصی، اگر نشد بات) */
    via: text("via").notNull().default("bot"),
    /** @username یا شناسه‌ی عددی (برایِ اکانتِ شخصی: me = پیام‌های ذخیره‌شده) */
    chatRef: text("chat_ref").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("idx_sms_forward_rules_user").on(t.userId, t.sortOrder),
    viaChk: check("sms_forward_rules_via_chk", sql`${t.via} IN ('bot', 'userbot', 'both')`),
  }),
);

export const smsForwardLogTable = pgTable(
  "sms_forward_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    ruleId: text("rule_id"),
    ruleName: text("rule_name"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    sender: text("sender"),
    contentHash: text("content_hash").notNull(),
    textLen: integer("text_len").notNull().default(0),
    /** sent | failed | no_rule | duplicate */
    status: text("status").notNull(),
    via: text("via"),
    error: text("error"),
  },
  (t) => ({
    byUserTime: index("idx_sms_forward_log_user_time").on(t.userId, t.receivedAt.desc()),
    dedupe: index("idx_sms_forward_log_dedupe").on(t.userId, t.contentHash, t.receivedAt.desc()),
  }),
);

/** قفلِ اتمیکِ ضدِ ارسالِ چندباره‌ی یک پیامک (INSERT … ON CONFLICT). */
export const smsForwardClaimTable = pgTable(
  "sms_forward_claim",
  {
    userId: text("user_id").notNull(),
    contentHash: text("content_hash").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.contentHash] }) }),
);

export type SmsForwardAccount = typeof smsForwardAccountsTable.$inferSelect;
export type SmsForwardRule = typeof smsForwardRulesTable.$inferSelect;
export type SmsForwardLogRow = typeof smsForwardLogTable.$inferSelect;
