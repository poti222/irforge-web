/**
 * schema/paymentChannels.ts
 * ─────────────────────────────────────────────────────────────────────────
 * ماژولِ مشترکِ «کارت‌به‌کارت با تأیید خودکار از روی پیامک بانک»
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۱).
 *
 * دو کاربرد روی همین سه جدول: scope=platform (شارژ کیف‌پولِ خودِ IrForge) و
 * scope=bot (فروش داخل باتِ یک فروشنده). همه‌ی مبالغ عدد صحیحِ **ریال**
 * (BIGINT) هستند؛ تومان فقط در مرزِ API/UI (lib/currency.ts).
 *
 * ⚠️ منبعِ حقیقتِ DDL در پروداکشن `api-server/migrate.mjs` است (آینه:
 * `lib/db/migrations/0029_card_autoconfirm.sql`). همه‌ی CHECKها و ایندکس‌های
 * یکتا اینجا هم اعلام شده‌اند تا `drizzle-kit push` آن‌ها را «اضافه» ندیده و
 * حذف نکند — یکتاییِ مبلغ و «هر پیامک فقط یک‌بار» قیدِ سطحِ دیتابیس‌اند.
 * bot_id عمداً FOREIGN KEY ندارد: purgeBotFully ردیفِ بات را حذف می‌کند و
 * سابقه‌ی مالی نباید با آن پاک شود.
 */
import { pgTable, text, timestamp, integer, bigint, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const paymentChannelsTable = pgTable(
  "payment_channels",
  {
    id: text("id").primaryKey(),
    /** platform | bot */
    scope: text("scope").notNull(),
    /** الزامی وقتی scope=bot، وگرنه NULL */
    botId: text("bot_id"),
    /** card_manual | fixed_link | open_link */
    kind: text("kind").notNull(),
    /** شماره‌ی کارت، AES-256-GCM (lib/tokenCrypto.ts) — هرگز plaintext. */
    cardNumberEnc: text("card_number_enc"),
    holderName: text("holder_name"),
    bankName: text("bank_name"),
    paymentUrl: text("payment_url"),
    /** هشِ secretِ webhookِ همین کانال — خودِ secret فقط یک‌بار نمایش داده می‌شود. */
    smsSecretHash: text("sms_secret_hash").notNull(),
    senderAllowlist: text("sender_allowlist").array().notNull().default(sql`'{}'`),
    /** blubank | generic | … */
    bankParser: text("bank_parser").notNull().default("blubank"),
    /** حداقل مبلغِ پایه (ریال). پیش‌فرض ۱٬۰۰۰٬۰۰۰ = ۱۰۰٬۰۰۰ تومان (حدِ بلوبانک). */
    minAmountRial: bigint("min_amount_rial", { mode: "number" }).notNull().default(1000000),
    active: boolean("active").notNull().default(true),
    lastSmsAt: timestamp("last_sms_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_payment_channels_scope_bot").on(t.scope, t.botId),
    check("payment_channels_scope_chk", sql`${t.scope} IN ('platform', 'bot')`),
    check("payment_channels_scope_bot_chk", sql`(${t.scope} = 'bot') = (${t.botId} IS NOT NULL)`),
    check("payment_channels_kind_chk", sql`${t.kind} IN ('card_manual', 'fixed_link', 'open_link')`),
    check(
      "payment_channels_kind_fields_chk",
      sql`(${t.kind} = 'card_manual' AND ${t.cardNumberEnc} IS NOT NULL)
        OR (${t.kind} IN ('fixed_link', 'open_link') AND ${t.paymentUrl} IS NOT NULL)`,
    ),
    check("payment_channels_min_amount_chk", sql`${t.minAmountRial} > 0`),
  ],
);

export const paymentRequestsTable = pgTable(
  "payment_requests",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => paymentChannelsTable.id),
    /** کپیِ kind کانال — تا ایندکسِ یکتای fixed_link بدونِ JOIN بیان شود. */
    channelKind: text("channel_kind").notNull(),
    scope: text("scope").notNull(),
    botId: text("bot_id"),
    userId: text("user_id").notNull(),
    /** wallet_topup | order */
    purpose: text("purpose").notNull(),
    orderId: text("order_id"),
    /** مبلغی که کاربر می‌خواهد (اعتبارِ کیف‌پول / قیمتِ سفارش) — ریال. */
    baseAmountRial: bigint("base_amount_rial", { mode: "number" }).notNull(),
    /** پسوندِ یکتاساز، مضربِ ۱۰ ریال، ≤ ۹۹۹۰ (۰ برای fixed_link). */
    suffixRial: bigint("suffix_rial", { mode: "number" }).notNull().default(0),
    /** base + suffix — دقیقاً همان عددی که کاربر واریز می‌کند و پیامک باید داشته باشد. */
    finalAmountRial: bigint("final_amount_rial", { mode: "number" }).notNull(),
    /** queued | pending | awaiting_review | confirmed | expired | canceled | rejected */
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    queuePosition: integer("queue_position"),
    receiptFileId: text("receipt_file_id"),
    receiptUploadedAt: timestamp("receipt_uploaded_at", { withTimezone: true }),
    /** sms | admin */
    confirmedBy: text("confirmed_by"),
    confirmedByAdminId: text("confirmed_by_admin_id"),
    matchedSmsId: text("matched_sms_id").references((): any => smsInboxTable.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    accountIdSnapshot: text("account_id_snapshot"),
    /** scope=bot: بات «claim» می‌کند تا اثرِ تأیید فقط یک‌بار اعمال شود (فاز ۵). */
    effectClaimedAt: timestamp("effect_claimed_at", { withTimezone: true }),
    effectDoneAt: timestamp("effect_done_at", { withTimezone: true }),
    /** ردِ دستیِ ادمین (فاز ۶) — فقط وقتی status=rejected. */
    rejectedByAdminId: text("rejected_by_admin_id"),
    rejectReason: text("reject_reason"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_requests_active_final_uk")
      .on(t.channelId, t.finalAmountRial)
      .where(sql`${t.status} IN ('pending', 'awaiting_review')`),
    uniqueIndex("payment_requests_fixed_pending_uk")
      .on(t.channelId, t.baseAmountRial)
      .where(sql`${t.status} = 'pending' AND ${t.channelKind} = 'fixed_link'`),
    index("idx_payment_requests_channel_status").on(t.channelId, t.status),
    index("idx_payment_requests_owner").on(t.scope, t.botId, t.userId),
    index("idx_payment_requests_order").on(t.orderId).where(sql`${t.orderId} IS NOT NULL`),
    index("idx_payment_requests_pending_expiry").on(t.expiresAt).where(sql`${t.status} = 'pending'`),
    index("idx_payment_requests_effect_pending")
      .on(t.botId, t.confirmedAt)
      .where(sql`${t.status} = 'confirmed' AND ${t.effectClaimedAt} IS NULL`),
    check(
      "payment_requests_reject_chk",
      sql`(${t.rejectedByAdminId} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.rejectReason} IS NULL) OR ${t.status} = 'rejected'`,
    ),
    check(
      "payment_requests_effect_chk",
      sql`(${t.effectClaimedAt} IS NULL OR ${t.status} = 'confirmed') AND (${t.effectDoneAt} IS NULL OR ${t.effectClaimedAt} IS NOT NULL)`,
    ),
    index("idx_payment_requests_queue")
      .on(t.channelId, t.baseAmountRial, t.queuePosition)
      .where(sql`${t.status} = 'queued'`),
    check(
      "payment_requests_status_chk",
      sql`${t.status} IN ('queued', 'pending', 'awaiting_review', 'confirmed', 'expired', 'canceled', 'rejected')`,
    ),
    check("payment_requests_kind_chk", sql`${t.channelKind} IN ('card_manual', 'fixed_link', 'open_link')`),
    check("payment_requests_scope_chk", sql`${t.scope} IN ('platform', 'bot')`),
    check("payment_requests_scope_bot_chk", sql`(${t.scope} = 'bot') = (${t.botId} IS NOT NULL)`),
    check("payment_requests_purpose_chk", sql`${t.purpose} IN ('wallet_topup', 'order')`),
    check("payment_requests_order_chk", sql`(${t.purpose} = 'order') = (${t.orderId} IS NOT NULL)`),
    check(
      "payment_requests_amounts_chk",
      sql`${t.baseAmountRial} > 0 AND ${t.suffixRial} >= 0 AND ${t.finalAmountRial} >= ${t.baseAmountRial}
        AND ${t.finalAmountRial} = ${t.baseAmountRial} + ${t.suffixRial}`,
    ),
    check(
      "payment_requests_suffix_chk",
      sql`${t.suffixRial} = 0 OR (${t.channelKind} <> 'fixed_link' AND ${t.suffixRial} % 10 = 0 AND ${t.suffixRial} <= 9990)`,
    ),
    check("payment_requests_expiry_chk", sql`${t.status} <> 'pending' OR ${t.expiresAt} IS NOT NULL`),
    check("payment_requests_queue_chk", sql`(${t.status} = 'queued') = (${t.queuePosition} IS NOT NULL)`),
    check(
      "payment_requests_confirm_chk",
      sql`(${t.status} = 'confirmed') = (${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
    ),
    check("payment_requests_confirm_by_chk", sql`${t.confirmedBy} IS NULL OR ${t.confirmedBy} IN ('sms', 'admin')`),
    check(
      "payment_requests_confirm_admin_chk",
      sql`${t.confirmedBy} IS DISTINCT FROM 'admin' OR ${t.confirmedByAdminId} IS NOT NULL`,
    ),
  ],
);

export const smsInboxTable = pgTable(
  "sms_inbox",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => paymentChannelsTable.id),
    rawText: text("raw_text").notNull(),
    sender: text("sender"),
    /** زمانِ پیامک (طبقِ گوشی) — نه زمانِ ورودِ آن به سرور. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    /** هشِ متن+فرستنده+زمان — idempotency، یکتا به‌ازای کانال. */
    contentHash: text("content_hash").notNull(),
    /** deposit | withdraw | unknown */
    direction: text("direction").notNull().default("unknown"),
    amountRial: bigint("amount_rial", { mode: "number" }),
    balanceRial: bigint("balance_rial", { mode: "number" }),
    parsedOk: boolean("parsed_ok").notNull().default(false),
    matchedRequestId: text("matched_request_id").references((): any => paymentRequestsTable.id),
    /** unmatched | matched | ambiguous | ignored */
    status: text("status").notNull().default("unmatched"),
  },
  (t) => [
    uniqueIndex("sms_inbox_channel_hash_uk").on(t.channelId, t.contentHash),
    uniqueIndex("sms_inbox_matched_request_uk").on(t.matchedRequestId).where(sql`${t.matchedRequestId} IS NOT NULL`),
    index("idx_sms_inbox_channel_status").on(t.channelId, t.status, t.receivedAt),
    check("sms_inbox_direction_chk", sql`${t.direction} IN ('deposit', 'withdraw', 'unknown')`),
    check("sms_inbox_status_chk", sql`${t.status} IN ('unmatched', 'matched', 'ambiguous', 'ignored')`),
    check(
      "sms_inbox_amounts_chk",
      sql`(${t.amountRial} IS NULL OR ${t.amountRial} > 0) AND (${t.balanceRial} IS NULL OR ${t.balanceRial} >= 0)`,
    ),
    check("sms_inbox_parsed_chk", sql`NOT ${t.parsedOk} OR (${t.direction} <> 'unknown' AND ${t.amountRial} IS NOT NULL)`),
    check("sms_inbox_matched_chk", sql`(${t.status} = 'matched') = (${t.matchedRequestId} IS NOT NULL)`),
    check(
      "sms_inbox_matched_deposit_chk",
      sql`${t.status} <> 'matched' OR (${t.parsedOk} AND ${t.direction} = 'deposit')`,
    ),
  ],
);

export type PaymentChannel = typeof paymentChannelsTable.$inferSelect;
export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
export type SmsInboxRow = typeof smsInboxTable.$inferSelect;
