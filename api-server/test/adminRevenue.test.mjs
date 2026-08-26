/**
 * test/adminRevenue.test.mjs — IRFORGE_PROMPT_V3 Phase 35.
 *
 * `getRevenueEntries()` is the one place that decides "what counts as
 * revenue and which bucket it falls in" — both `GET /admin/stats` (the
 * aggregate cards) and `GET /admin/revenue-details` (the Phase 35
 * drill-down) call it, so a bug here would silently make the two disagree.
 *
 * `db.select().from(table).where(...)` here has no `.limit()` — unlike the
 * single-row lookups elsewhere in this suite — so the fake's `where` resolves
 * directly to the row array.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db, paymentsTable, walletTransactionsTable } = await import("@workspace/db");
const mod = await import("../src/lib/adminRevenue.ts");

function installDb({ payments = [], walletSpends = [] } = {}) {
  db.select = () => ({
    from: (table) => ({
      where: async () => {
        if (table === paymentsTable) return payments;
        if (table === walletTransactionsTable) return walletSpends;
        return [];
      },
    }),
  });
}

function payment(overrides = {}) {
  return { id: "pay_1", amount: 150_000, botId: "bot_1", userId: "user_1", createdAt: new Date("2026-08-01"), ...overrides };
}

function walletSpend(overrides = {}) {
  return { id: "wtx_1", amount: 90_000, note: "Bot purchase: My Bot", userId: "user_1", createdAt: new Date("2026-08-02"), ...overrides };
}

test("فیشِ تأییدشده با bot_id → دسته‌ی bot", async () => {
  installDb({ payments: [payment()], walletSpends: [] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "bot");
  assert.equal(entries[0].source, "payment");
  assert.equal(entries[0].amount, 150_000);
});

test("فیشِ تأییدشده بدون bot_id → دسته‌ی other", async () => {
  installDb({ payments: [payment({ botId: null })], walletSpends: [] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries[0].kind, "other");
});

test("خرجِ کیف‌پول با یادداشتِ «Bot purchase:» → دسته‌ی bot", async () => {
  installDb({ payments: [], walletSpends: [walletSpend({ note: "Bot purchase: Foo" })] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries[0].kind, "bot");
  assert.equal(entries[0].source, "wallet");
});

test("خرجِ کیف‌پول با یادداشتِ «Plugin:» → دسته‌ی plugin", async () => {
  installDb({ payments: [], walletSpends: [walletSpend({ note: "Plugin: catalog" })] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries[0].kind, "plugin");
});

test("خرجِ کیف‌پول با یادداشتِ دیگر (مثلاً تغییرِ پلن) → دسته‌ی other", async () => {
  installDb({ payments: [], walletSpends: [walletSpend({ note: "Plan upgrade: طلایی" })] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries[0].kind, "other");
});

test("خرجِ کیف‌پول بدون یادداشت → دسته‌ی other، بدون throw", async () => {
  installDb({ payments: [], walletSpends: [walletSpend({ note: null })] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries[0].kind, "other");
});

test("هر دو منبع با هم ترکیب می‌شوند، بدون دوباره‌شماری", async () => {
  installDb({
    payments: [payment({ id: "pay_1", amount: 100 }), payment({ id: "pay_2", amount: 200, botId: null })],
    walletSpends: [walletSpend({ id: "wtx_1", amount: 50, note: "Plugin: x" })],
  });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries.length, 3);
  assert.equal(mod.sumRevenue(entries), 350);
});

test("sumRevenue: مجموعِ ساده، آرایه‌ی خالی صفر می‌دهد", () => {
  assert.equal(mod.sumRevenue([]), 0);
  assert.equal(mod.sumRevenue([{ amount: 10 }, { amount: 20 }]), 30);
});

test("amount غایب (null) به صفر سقوط می‌کند، نه NaN", async () => {
  installDb({ payments: [payment({ amount: null })], walletSpends: [] });
  const entries = await mod.getRevenueEntries();
  assert.equal(entries[0].amount, 0);
});
