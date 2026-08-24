/**
 * test/walletStore.test.mjs — IRFORGE_PROMPT_V3 Phase 24
 *
 * Exercises lib/walletStore.ts against the fake `botConfig.sheetLayer` (same
 * harness as test/catalogStore.test.mjs) with `advisoryLock.withLock`
 * monkeypatched to run `fn()` directly — mirrors the `sheetLayer` monkeypatch
 * convention, and lets these tests run without a real Postgres connection.
 * A *separate* test file (advisoryLock itself isn't unit-testable without a
 * live Postgres) would be needed to exercise the actual lock acquisition;
 * what matters here is that walletStore calls into it correctly and that
 * the balance/ledger/freeze semantics mirror
 * plugins/wallet/{domain,service,ledger,order_integration,notifications}.py.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const { advisoryLock } = await import("../src/lib/botAdvisoryLock.ts");
const store = await import("../src/lib/walletStore.ts");

const SID = "SHEET_TEST_WALLET";

function installSheet(initial = {}) {
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) tabs.set(tab, new Map(Object.entries(rows)));

  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = tabs.get(tab);
      if (!rows) return [];
      return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
    },
    async upsertRow(_sid, tab, key, value) {
      if (!tabs.has(tab)) tabs.set(tab, new Map());
      const rows = tabs.get(tab);
      const created = !rows.has(key);
      rows.set(key, JSON.parse(JSON.stringify(value)));
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      const rows = tabs.get(tab);
      if (!rows || !rows.has(key)) return false;
      rows.delete(key);
      return true;
    },
    async listTabs() {
      return [...tabs.keys()];
    },
  });
  return tabs;
}

// همه‌ی تست‌ها بدون Postgres واقعی اجرا می‌شوند — قفل را عبور می‌دهیم.
Object.assign(advisoryLock, {
  isConfigured: () => true,
  async withLock(_name, fn) {
    return fn();
  },
});

// ── walletIdFor ─────────────────────────────────────────────────────────

test("walletIdFor یک شناسه‌ی قطعی و lowercase می‌سازد", () => {
  assert.equal(store.walletIdFor("user", "12345"), "user:12345:irt");
  assert.equal(store.walletIdFor("USER", "ABC", "usd"), "user:abc:usd");
});

// ── getOrCreateWallet ────────────────────────────────────────────────────

test("getOrCreateWallet یک ولت صفرمانده‌ی فعال می‌سازد و idempotent است", async () => {
  installSheet();
  const w1 = await store.getOrCreateWallet(SID, "user", "1");
  assert.equal(w1.balance, 0);
  assert.equal(w1.status, "active");
  assert.equal(w1.currency, "IRT");

  const w2 = await store.getOrCreateWallet(SID, "user", "1");
  assert.equal(w2.id, w1.id);
  assert.equal(w2.created_at, w1.created_at);
});

// ── adminCredit / adminDebit ─────────────────────────────────────────────

test("adminCredit موجودی را بالا می‌برد و یک ردیف دفترکل با action=admin_credit ثبت می‌کند", async () => {
  const tabs = installSheet();
  const { wallet, entry } = await store.adminCredit(SID, "1", 50000, "top up", "web:admin1");
  assert.equal(wallet.balance, 50000);
  assert.equal(entry.action, "admin_credit");
  assert.equal(entry.amount_before, 0);
  assert.equal(entry.amount_changed, 50000);
  assert.equal(entry.amount_after, 50000);
  assert.equal(entry.reference_type, "manual");
  assert.equal(entry.reference_id, "web:admin1");
  assert.match(entry.id, /^txn_[0-9a-f]{12}$/);
  assert.equal(tabs.get("transactions").size, 1);
});

test("adminCredit مبلغ صفر یا منفی را رد می‌کند", async () => {
  installSheet();
  await assert.rejects(() => store.adminCredit(SID, "1", 0, "x", "actor"));
  await assert.rejects(() => store.adminCredit(SID, "1", -10, "x", "actor"));
});

test("adminDebit موجودی را کم می‌کند", async () => {
  installSheet();
  await store.adminCredit(SID, "1", 10000, "seed", "actor");
  const { wallet, entry } = await store.adminDebit(SID, "1", 4000, "spend", "actor");
  assert.equal(wallet.balance, 6000);
  assert.equal(entry.action, "admin_debit");
  assert.equal(entry.amount_changed, -4000);
});

test("adminDebit روی اضافه‌برداشت رد می‌شود", async () => {
  installSheet();
  await store.adminCredit(SID, "1", 1000, "seed", "actor");
  await assert.rejects(() => store.adminDebit(SID, "1", 5000, "x", "actor"), /کافی نیست/);
});

test("credit/debit روی ولتِ مسدود رد می‌شود", async () => {
  installSheet();
  await store.freezeWallet(SID, "1", "actor");
  await assert.rejects(() => store.adminCredit(SID, "1", 1000, "x", "actor"), /مسدود/);
  await assert.rejects(() => store.adminDebit(SID, "1", 1, "x", "actor"), /مسدود/);
});

// ── freeze / unfreeze ────────────────────────────────────────────────────

test("freezeWallet وضعیت را frozen می‌کند و idempotent است", async () => {
  const tabs = installSheet();
  const w1 = await store.freezeWallet(SID, "1", "actor", "suspicious activity");
  assert.equal(w1.status, "frozen");
  assert.equal(tabs.get("transactions").size, 1);

  const w2 = await store.freezeWallet(SID, "1", "actor");
  assert.equal(w2.status, "frozen");
  assert.equal(tabs.get("transactions").size, 1, "دومین freeze نباید ردیف دفترکل تازه بنویسد");
});

test("unfreezeWallet وضعیت را برمی‌گرداند به active", async () => {
  installSheet();
  await store.freezeWallet(SID, "1", "actor");
  const w = await store.unfreezeWallet(SID, "1", "actor");
  assert.equal(w.status, "active");
});

test("unfreezeWallet روی ولتِ غیرمسدود idempotent است (بدون ردیف دفترکل تازه)", async () => {
  const tabs = installSheet();
  await store.getOrCreateWallet(SID, "user", "1");
  await store.unfreezeWallet(SID, "1", "actor");
  assert.equal((tabs.get("transactions") ?? new Map()).size, 0);
});

// ── listTransactions ─────────────────────────────────────────────────────

test("listTransactions فقط تراکنش‌های همان ولت را برمی‌گرداند، جدیدترین اول", async () => {
  installSheet();
  await store.adminCredit(SID, "1", 1000, "first", "actor");
  await store.adminCredit(SID, "2", 999, "other wallet", "actor");
  await store.adminCredit(SID, "1", 2000, "second", "actor");

  const wallet = await store.getOrCreateWallet(SID, "user", "1");
  const txns = await store.listTransactions(SID, wallet.id);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].reason, "second", "جدیدترین باید اول باشد");
  assert.equal(txns[1].reason, "first");
});

test("listTransactions به limit احترام می‌گذارد", async () => {
  installSheet();
  for (let i = 0; i < 5; i++) await store.adminCredit(SID, "1", 100, `t${i}`, "actor");
  const wallet = await store.getOrCreateWallet(SID, "user", "1");
  const txns = await store.listTransactions(SID, wallet.id, 2);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].reason, "t4");
  assert.equal(txns[1].reason, "t3");
});

// ── charge / refund order ────────────────────────────────────────────────

function seedOrder(tabs, orderId, fields = {}) {
  if (!tabs.has("payments")) tabs.set("payments", new Map());
  tabs.get("payments").set(orderId, { order_id: orderId, user_id: "1", ...fields });
}

test("chargeOrder کیف‌پولِ مالکِ سفارش را بدهکار می‌کند و ledger entry را روی سفارش می‌نویسد", async () => {
  const tabs = installSheet();
  seedOrder(tabs, "ORD1");
  await store.adminCredit(SID, "1", 10000, "seed", "actor");
  const { wallet, entry, order } = await store.chargeOrder(SID, "ORD1", 5000, "", "web:admin1");
  assert.equal(wallet.balance, 5000);
  assert.equal(entry.action, "purchase_debit");
  assert.equal(entry.reference_type, "order");
  assert.equal(entry.reference_id, "ORD1");
  assert.equal(order.wallet_ledger_entry, entry.id);
  assert.equal(tabs.get("payments").get("ORD1").wallet_ledger_entry, entry.id);
});

test("chargeOrder روی موجودیِ ناکافی رد می‌شود", async () => {
  const tabs = installSheet();
  seedOrder(tabs, "ORD1");
  await assert.rejects(() => store.chargeOrder(SID, "ORD1", 5000, "", "actor"), /کافی نیست/);
});

test("chargeOrder کد سفارش را case-insensitive پیدا می‌کند (اول UPPER بعد خام)", async () => {
  const tabs = installSheet();
  seedOrder(tabs, "ord-lower");
  await store.adminCredit(SID, "1", 1000, "seed", "actor");
  const { order } = await store.chargeOrder(SID, "ord-lower", 100, "", "actor");
  assert.equal(order.order_id, "ord-lower");
});

test("chargeOrder روی سفارشِ ناموجود یا بی‌مالک ۴۰۴ می‌دهد", async () => {
  installSheet();
  await assert.rejects(() => store.chargeOrder(SID, "MISSING", 100, "", "actor"), /پیدا نشد/);
});

test("refundOrder کیف‌پولِ مالکِ سفارش را بستانکار می‌کند با action=credit (نه admin_credit)", async () => {
  const tabs = installSheet();
  seedOrder(tabs, "ORD2");
  const { wallet, entry, order } = await store.refundOrder(SID, "ORD2", 3000, "", "web:admin1");
  assert.equal(wallet.balance, 3000);
  assert.equal(entry.action, "credit");
  assert.equal(entry.reference_type, "order_refund");
  assert.equal(order.wallet_refund_entry, entry.id);
});

// ── notify settings ──────────────────────────────────────────────────────

test("getWalletNotifySettings بدون ردیف → پیش‌فرض دقیقاً برابر با DEFAULT_CFG بات", async () => {
  installSheet();
  const settings = await store.getWalletNotifySettings(SID);
  assert.equal(settings.user_notify_enabled, true);
  assert.equal(settings.admin_notify_enabled, false);
  assert.deepEqual(settings.log_targets, []);
  assert.equal(settings.templates.credit, store.DEFAULT_TEMPLATES.credit);
});

test("setWalletNotifySettings مقدار را ذخیره می‌کند و در خواندنِ بعدی برمی‌گردد", async () => {
  installSheet();
  const saved = await store.setWalletNotifySettings(SID, {
    user_notify_enabled: false, admin_notify_enabled: true,
    log_targets: ["-1001", " -1002 ", ""],
    templates: { credit: "custom {amount}" },
  });
  assert.equal(saved.user_notify_enabled, false);
  assert.equal(saved.admin_notify_enabled, true);
  assert.deepEqual(saved.log_targets, ["-1001", "-1002"]);
  assert.equal(saved.templates.credit, "custom {amount}");
  assert.equal(saved.templates.debit, store.DEFAULT_TEMPLATES.debit, "قالبِ نیامده باید پیش‌فرض بماند");

  const reloaded = await store.getWalletNotifySettings(SID);
  assert.deepEqual(reloaded, saved);
});

// ── template formatting / receipt building ───────────────────────────────

test("formatWalletTemplate جایگذاری امن می‌کند، کلید ناشناخته دست‌نخورده می‌ماند", () => {
  assert.equal(store.formatWalletTemplate("{a} and {b}", { a: "X" }), "X and {b}");
});

test("buildUserReceiptText برای admin_credit/admin_debit به قالب درست نگاشت می‌شود", async () => {
  installSheet();
  const { wallet, entry } = await store.adminCredit(SID, "1", 1000, "top up", "actor");
  const settings = await store.getWalletNotifySettings(SID);
  const text = store.buildUserReceiptText(wallet, entry, settings);
  assert.match(text, /1,000|1000/);
});

test("buildUserReceiptText وقتی user_notify_enabled خاموش است null برمی‌گرداند", async () => {
  installSheet();
  const { wallet, entry } = await store.adminCredit(SID, "1", 1000, "x", "actor");
  const settings = { ...store.DEFAULT_NOTIFY_SETTINGS, user_notify_enabled: false, templates: store.DEFAULT_TEMPLATES };
  assert.equal(store.buildUserReceiptText(wallet, entry, settings), null);
});

test("buildUserReceiptText برای owner_type غیر از user همیشه null است", () => {
  const wallet = { id: "admin:1:irt", owner_type: "admin", owner_id: "1", currency: "IRT", balance: 0, status: "active" };
  const entry = { id: "t", wallet_id: wallet.id, action: "admin_credit", amount_before: 0, amount_changed: 100, amount_after: 100, reason: "", actor: "", reference_type: "", reference_id: "", meta: {}, at: "" };
  assert.equal(store.buildUserReceiptText(wallet, entry, store.DEFAULT_NOTIFY_SETTINGS), null);
});

test("buildUserReceiptText برای freeze/unfreeze با entry=null و tmplKey صریح کار می‌کند", async () => {
  installSheet();
  const wallet = await store.freezeWallet(SID, "1", "actor", "abuse");
  const text = store.buildUserReceiptText(wallet, null, store.DEFAULT_NOTIFY_SETTINGS, "freeze");
  assert.ok(text && text.includes("مسدود"));
});
