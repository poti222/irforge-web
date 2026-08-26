/**
 * test/wallet.test.mjs — IRFORGE_PROMPT_V3 Phase 34/36.
 *
 * `lib/wallet.ts` (Postgres `wallets`/`wallet_transactions` — not to be
 * confused with the bot-side Sheets ledger `lib/walletStore.ts`, which has
 * its own test file) never had direct coverage before: Phase 34 only got a
 * source-text regression check (`test/adminPanel.test.mjs`) confirming the
 * atomic SQL *pattern* is still there. This exercises the actual control
 * flow — insufficient balance, the `type` tag each function writes, and
 * `ensureWallet`'s create-if-missing.
 *
 * The mock can't evaluate the opaque `sql\`balance +/- amt\`` fragment
 * `deductWallet`/`creditWallet` build (that's Postgres's job, and it's the
 * same pattern already proven at every other `walletsTable.balance` call
 * site in this codebase) — so `db.update(...).returning()` is configured
 * per test to return what the WHERE clause would have matched.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db, walletsTable, walletTransactionsTable } = await import("@workspace/db");
const mod = await import("../src/lib/wallet.ts");

function installDb({ existingWallet = null, updateResult = [] } = {}) {
  const txInserts = [];
  const walletInserts = [];

  db.select = () => ({
    from: (table) => ({
      where: () => ({
        limit: async () => (table === walletsTable && existingWallet ? [existingWallet] : []),
      }),
    }),
  });

  db.insert = (table) => ({
    values: (value) => {
      if (table === walletTransactionsTable) txInserts.push(value);
      if (table === walletsTable) walletInserts.push(value);
      return {
        returning: async () => (table === walletsTable ? [{ id: value.id, userId: value.userId, balance: value.balance }] : [value]),
      };
    },
  });

  db.update = (table) => ({
    set: () => ({
      where: () => ({
        returning: async () => (table === walletsTable ? updateResult : []),
      }),
    }),
  });

  return { txInserts, walletInserts };
}

// ─── deductWallet ───────────────────────────────────────────────────────────

test("deductWallet: موجودی کافی → true، یک ردیف تراکنشِ type=spend (پیش‌فرض)", async () => {
  const { txInserts } = installDb({ updateResult: [{ id: "w1", userId: "u1", balance: 50 }] });
  const ok = await mod.deductWallet("u1", 100, "Bot purchase: X");
  assert.equal(ok, true);
  assert.equal(txInserts.length, 1);
  assert.equal(txInserts[0].type, "spend");
  assert.equal(txInserts[0].amount, 100);
  assert.equal(txInserts[0].status, "approved");
});

test("deductWallet: موجودی ناکافی (WHERE چیزی برنمی‌گرداند) → false، بدون ثبت تراکنش", async () => {
  const { txInserts } = installDb({ updateResult: [] });
  const ok = await mod.deductWallet("u1", 100, "Bot purchase: X");
  assert.equal(ok, false);
  assert.equal(txInserts.length, 0);
});

test("deductWallet: مبلغِ صفر یا منفی → true، بدون هیچ برخوردی با دیتابیس", async () => {
  db.update = () => { throw new Error("should not touch db.update for a zero amount"); };
  db.insert = () => { throw new Error("should not touch db.insert for a zero amount"); };
  assert.equal(await mod.deductWallet("u1", 0, "x"), true);
  assert.equal(await mod.deductWallet("u1", -5, "x"), true);
});

test("deductWallet: با type سفارشی (کسرِ دستیِ سوپرادمین) → همان type روی ردیفِ تراکنش", async () => {
  const { txInserts } = installDb({ updateResult: [{ id: "w1", userId: "u1", balance: 10 }] });
  await mod.deductWallet("u1", 40, "Admin debit: fix", db, "admin_debit");
  assert.equal(txInserts[0].type, "admin_debit");
});

// ─── creditWallet ───────────────────────────────────────────────────────────

test("creditWallet: کیف‌پول از قبل هست → بدون ساختِ ردیفِ تازه، یک تراکنشِ type=admin_credit (پیش‌فرض)", async () => {
  const { txInserts, walletInserts } = installDb({
    existingWallet: { id: "w1", userId: "u1", balance: 10 },
    updateResult: [{ id: "w1", userId: "u1", balance: 60 }],
  });
  const balance = await mod.creditWallet("u1", 50, "Admin credit: goodwill");
  assert.equal(balance, 60);
  assert.equal(walletInserts.length, 0, "کیف‌پولِ موجود نباید دوباره ساخته شود");
  assert.equal(txInserts.length, 1);
  assert.equal(txInserts[0].type, "admin_credit");
  assert.equal(txInserts[0].amount, 50);
});

test("creditWallet: کیف‌پول وجود ندارد → اول ساخته می‌شود، بعد شارژ می‌شود", async () => {
  const { txInserts, walletInserts } = installDb({
    existingWallet: null,
    updateResult: [{ id: "w1", userId: "u1", balance: 50 }],
  });
  const balance = await mod.creditWallet("u1", 50, "Admin credit: goodwill");
  assert.equal(balance, 50);
  assert.equal(walletInserts.length, 1, "کیف‌پولِ نبود باید ساخته شود");
  assert.equal(walletInserts[0].balance, 0, "کیف‌پولِ تازه با موجودیِ صفر ساخته می‌شود، شارژ در قدمِ بعدی است");
  assert.equal(txInserts[0].type, "admin_credit");
});

test("creditWallet: با type سفارشی", async () => {
  const { txInserts } = installDb({
    existingWallet: { id: "w1", userId: "u1", balance: 0 },
    updateResult: [{ id: "w1", userId: "u1", balance: 100 }],
  });
  await mod.creditWallet("u1", 100, "Deposit approved", "deposit_card");
  assert.equal(txInserts[0].type, "deposit_card");
});

// ─── ensureWallet ───────────────────────────────────────────────────────────

test("ensureWallet: کیف‌پول موجود → همان را برمی‌گرداند، چیزی نمی‌سازد", async () => {
  const { walletInserts } = installDb({ existingWallet: { id: "w1", userId: "u1", balance: 30 } });
  const w = await mod.ensureWallet("u1");
  assert.equal(w.balance, 30);
  assert.equal(walletInserts.length, 0);
});

test("ensureWallet: کیف‌پول نبود → با موجودیِ صفر می‌سازد", async () => {
  const { walletInserts } = installDb({ existingWallet: null });
  const w = await mod.ensureWallet("u1");
  assert.equal(w.balance, 0);
  assert.equal(walletInserts.length, 1);
});
