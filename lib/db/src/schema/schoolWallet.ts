/**
 * schema/schoolWallet.ts — کیف‌پولِ «مدرسه»، کاملاً جدا از `wallets` (کیف‌پولِ شخصیِ کاربر / باتِ پلتفرم).
 * ─────────────────────────────────────────────────────────────────────────
 * طبقِ خواستِ کاربر: خریدِ باتِ مدرسه از اینجا کسر می‌شود و هیچ ربطی به صفحه‌یِ /wallet و موتورِ شارژِ شخصی ندارد.
 * مبالغ همه ریالِ صحیح (INTEGER)؛ کسر فقط با UPDATE شرطی (lib/schoolWallet.ts). `balanceAfter` در هر تراکنش
 * برایِ ردگیریِ حسابداری ثبت می‌شود.
 * `school_wallet_topup_requests`: مدیر «درخواستِ شارژ» (مبلغ + توضیح) ثبت می‌کند و سوپرادمین تأیید/رد می‌کند
 * (موتورِ کارت‌به‌کارتِ خودکارِ پلتفرم عمداً دست‌نخورده ماند).
 */
import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const schoolWalletsTable = pgTable("school_wallets", {
  schoolId: text("school_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolWalletTransactionsTable = pgTable("school_wallet_transactions", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  /** credit | spend | admin_credit | admin_debit */
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description").notNull(),
  refId: text("ref_id"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolWalletTopupRequestsTable = pgTable("school_wallet_topup_requests", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  requestedByUserId: text("requested_by_user_id").notNull(),
  amountRial: integer("amount_rial").notNull(),
  note: text("note"),
  /** pending | approved | rejected | cancelled */
  status: text("status").notNull().default("pending"),
  decidedByUserId: text("decided_by_user_id"),
  decisionNote: text("decision_note"),
  txnId: text("txn_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export type SchoolWalletTransaction = typeof schoolWalletTransactionsTable.$inferSelect;
export type SchoolWalletTopupRequest = typeof schoolWalletTopupRequestsTable.$inferSelect;
