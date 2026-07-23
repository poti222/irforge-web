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
