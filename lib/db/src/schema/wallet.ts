/**
 * schema/wallet.ts
 * Z5 — کیف پول
 *
 * توجه: مبالغ به «تومان» (عدد صحیح) ذخیره می‌شوند تا با بقیهٔ اپ (payment.amount,
 * plan.price و formatToman) یکدست باشند — نه cents.
 */
import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const walletsTable = pgTable("wallets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  /** موجودی به تومان */
  balance: integer("balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  /** deposit_card | deposit_gateway | deposit_usdt | spend | referral_credit */
  type: text("type").notNull(),
  /** مبلغ به تومان */
  amount: integer("amount").notNull(),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  /** فیش کارت‌به‌کارت (base64/URL) — روش‌محور، nullable */
  receiptUrl: text("receipt_url"),
  /** هش تراکنش USDT — روش‌محور، nullable */
  txHash: text("tx_hash"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWalletSchema = createInsertSchema(walletsTable).omit({ createdAt: true, updatedAt: true });
export const insertWalletTxSchema = createInsertSchema(walletTransactionsTable).omit({ createdAt: true, updatedAt: true });
export type Wallet = typeof walletsTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;

/**
 * WALLET_TOPUPS — شارژِ کیف‌پول با تشخیص خودکارِ پیامکِ واریزیِ بلوبانک.
 * ─────────────────────────────────────────────────────────────────────────
 * یک لینکِ پرداختِ بلوبانکِ **مبلغ‌باز** (کاربر خودش عدد را در صفحه‌ی بلوبانک
 * تایپ می‌کند) برای همه‌ی مبالغ — چه دکمه‌ی preset، چه دلخواه. چون لینک باز
 * است و مبلغ ثابت نیست، امکان ندارد دو کاربر هم‌زمان دقیقاً یک عدد را واریز
 * کنند و پیامکِ بانکی بینشان مبهم بماند — راه‌حل این نیست که فقط یک سفارش
 * در لحظه مجاز باشد (نوبت‌دهی)، بلکه هر سفارش یک عددِ یکتای خودش را می‌گیرد:
 * `finalAmount = requestedAmount + suffix` (سه‌رقمیِ تصادفی). کاربر دقیقاً
 * همین عددِ نهایی را در بلوبانک وارد می‌کند، نه مبلغِ اصلی.
 *
 * یکتاییِ `finalAmount` در بینِ سفارش‌های `pending` با یک ایندکسِ جزئی
 * (`wallet_topups_pending_final_amount_uk` در migrate.mjs) enforce می‌شود؛
 * سرویس (`walletTopupService.ts`) روی خطای `23505` دوباره یک suffix دیگر
 * امتحان می‌کند.
 */
export const walletTopupsTable = pgTable("wallet_topups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  /** مبلغی که کاربر واقعاً می‌خواهد به کیف‌پولش اضافه شود (تومان). */
  requestedAmount: integer("requested_amount").notNull(),
  /** پسوندِ تصادفیِ سه‌رقمی که برای یکتاسازی به requestedAmount اضافه می‌شود. */
  suffix: integer("suffix").notNull(),
  /** requestedAmount + suffix — همان عددی که کاربر باید در بلوبانک وارد کند. */
  finalAmount: integer("final_amount").notNull(),
  /** pending | confirmed | expired | canceled */
  status: text("status").notNull().default("pending"),
  matchedSmsId: text("matched_sms_id"),
  receiptImageUrl: text("receipt_image_url"),
  receiptUploadedAt: timestamp("receipt_uploaded_at", { withTimezone: true }),
  adminNotifiedAt: timestamp("admin_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** فقط برای pending — createdAt + ۲۰ دقیقه. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

/** هر پیامکِ واریزیِ خام — چه match شود چه نه، برای ممیزی و رسیدگیِ دستی. */
export const smsLogsTable = pgTable("sms_logs", {
  id: text("id").primaryKey(),
  rawText: text("raw_text").notNull(),
  sender: text("sender"),
  /** مبلغِ استخراج‌شده به تومان (بعد از تبدیلِ احتمالیِ ریال÷۱۰) — null یعنی پارس نشد. */
  parsedAmount: integer("parsed_amount"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  matchedPaymentId: text("matched_payment_id"),
  webhookIp: text("webhook_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWalletTopupSchema = createInsertSchema(walletTopupsTable).omit({ createdAt: true });
export const insertSmsLogSchema = createInsertSchema(smsLogsTable).omit({ createdAt: true });
export type WalletTopup = typeof walletTopupsTable.$inferSelect;
export type SmsLog = typeof smsLogsTable.$inferSelect;
