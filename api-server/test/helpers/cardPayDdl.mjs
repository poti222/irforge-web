/**
 * test/helpers/cardPayDdl.mjs — DDLِ کاملِ ماژولِ کارت‌به‌کارت (0029..0032) از روی فایل‌های آینه.
 * تست‌های زنده هر کدام روی یک schemaِ موقتِ جدا اجرا می‌کنند.
 */
import fs from "node:fs";

const read = (f) => {
  const t = fs.readFileSync(new URL(`../../../lib/db/migrations/${f}`, import.meta.url), "utf8");
  return t.slice(t.indexOf("-- ───"));
};

export const DDL_FILES = [
  "0029_card_autoconfirm.sql",
  "0030_card_autoconfirm_effects.sql",
  "0031_card_autoconfirm_reject.sql",
  "0032_card_autoconfirm_p8_p9.sql",
];
export const DDL_ALL = DDL_FILES.map(read).join("\n");

/** جدول‌های سایتِ اصلی که ماژول به آن‌ها دست می‌زند (نسخه‌ی حداقلی برایِ تست). */
export const SITE_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT NOT NULL DEFAULT 'user');
CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, sheet_id TEXT);
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', receipt_url TEXT, tx_hash TEXT, reviewed_by TEXT, review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS wallet_topups (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, requested_amount INTEGER NOT NULL, suffix INTEGER NOT NULL,
  final_amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', matched_sms_id TEXT,
  receipt_image_url TEXT, receipt_uploaded_at TIMESTAMPTZ, admin_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_topups_pending_final_amount_uk ON wallet_topups (final_amount) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS sms_logs (
  id TEXT PRIMARY KEY, raw_text TEXT NOT NULL, sender TEXT, parsed_amount INTEGER,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), matched_payment_id TEXT, webhook_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`;
