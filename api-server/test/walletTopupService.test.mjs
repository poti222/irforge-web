/**
 * test/walletTopupService.test.mjs — Wallet top-up Phase 2.
 *
 * `lib/walletTopupService.ts`: `requestTopup`'s suffix-retry-on-23505 loop,
 * amount bounds, `cancelTopup`/`getTopupForUser`/`expireStaleTopups`'s
 * conditional-update shape, and the BluBank SMS parser (`parseBlubankDepositSms`)
 * — the piece that turns a real bank SMS into a matchable Toman amount.
 *
 * Same `db.insert/update/select` module-mutation mock as test/wallet.test.mjs
 * (ESM named exports are read-only from the importing side).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db, walletTopupsTable } = await import("@workspace/db");
const mod = await import("../src/lib/walletTopupService.ts");

function pgUniqueViolation() {
  const err = new Error("duplicate key value violates unique constraint");
  err.code = "23505";
  return err;
}

// ─── requestTopup ───────────────────────────────────────────────────────────

test("requestTopup: مسیرِ موفق → یک ردیفِ pending با finalAmount = requestedAmount + suffix", async () => {
  const inserted = [];
  db.insert = (table) => ({
    values: (value) => {
      inserted.push(value);
      return { returning: async () => [value] };
    },
  });

  const row = await mod.requestTopup("u1", 100000);
  assert.equal(inserted.length, 1);
  assert.equal(row.userId, "u1");
  assert.equal(row.requestedAmount, 100000);
  assert.equal(row.status, "pending");
  assert.ok(row.suffix >= 100 && row.suffix <= 999);
  assert.equal(row.finalAmount, 100000 + row.suffix);
});

test("requestTopup: برخوردِ یکتاییِ finalAmount (23505) → یک پسوندِ دیگر امتحان می‌کند", async () => {
  let calls = 0;
  db.insert = () => ({
    values: (value) => ({
      returning: async () => {
        calls += 1;
        if (calls < 3) throw pgUniqueViolation();
        return [value];
      },
    }),
  });

  const row = await mod.requestTopup("u1", 50000);
  assert.equal(calls, 3, "باید دقیقاً بعد از دو برخورد، بارِ سوم موفق شود");
  assert.equal(row.requestedAmount, 50000);
});

test("requestTopup: بعد از تمامِ تلاش‌ها هنوز 23505 → TopupSuffixExhaustedError", async () => {
  db.insert = () => ({
    values: () => ({
      returning: async () => { throw pgUniqueViolation(); },
    }),
  });
  await assert.rejects(() => mod.requestTopup("u1", 50000), mod.TopupSuffixExhaustedError);
});

test("requestTopup: خطای دیگر (نه 23505) → مستقیم پرتاب می‌شود", async () => {
  db.insert = () => ({
    values: () => ({
      returning: async () => { throw new Error("connection lost"); },
    }),
  });
  await assert.rejects(() => mod.requestTopup("u1", 50000), /connection lost/);
});

test("requestTopup: مبلغِ کمتر از حدِ مجاز → InvalidTopupAmountError، بدون تماس با دیتابیس", async () => {
  db.insert = () => { throw new Error("should not touch db for an invalid amount"); };
  await assert.rejects(() => mod.requestTopup("u1", 1000), mod.InvalidTopupAmountError);
});

test("requestTopup: مبلغِ بیشتر از حدِ مجاز → InvalidTopupAmountError", async () => {
  db.insert = () => { throw new Error("should not touch db for an invalid amount"); };
  await assert.rejects(() => mod.requestTopup("u1", 999_999_999), mod.InvalidTopupAmountError);
});

// ─── cancelTopup / getTopupForUser ──────────────────────────────────────────

test("cancelTopup: سفارشِ pending و مالِ همان کاربر → لغو می‌شود", async () => {
  db.update = (table) => ({
    set: (patch) => ({
      where: () => ({
        returning: async () => [{ id: "t1", userId: "u1", status: patch.status }],
      }),
    }),
  });
  const row = await mod.cancelTopup("u1", "t1");
  assert.equal(row.status, "canceled");
});

test("cancelTopup: سفارش پیدا نشد (دیگر pending نیست یا مالِ کاربرِ دیگری‌ست) → null", async () => {
  db.update = () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) });
  const row = await mod.cancelTopup("u1", "t1");
  assert.equal(row, null);
});

test("getTopupForUser: پیدا شد → همان ردیف", async () => {
  db.select = () => ({
    from: () => ({ where: () => ({ limit: async () => [{ id: "t1", userId: "u1" }] }) }),
  });
  const row = await mod.getTopupForUser("u1", "t1");
  assert.equal(row.id, "t1");
});

test("getTopupForUser: پیدا نشد → null", async () => {
  db.select = () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
  const row = await mod.getTopupForUser("u1", "missing");
  assert.equal(row, null);
});

// ─── expireStaleTopups ──────────────────────────────────────────────────────

test("expireStaleTopups: تعدادِ ردیف‌هایی که expired شدند را برمی‌گرداند", async () => {
  db.update = () => ({
    set: () => ({ where: () => ({ returning: async () => [{ id: "t1" }, { id: "t2" }] }) }),
  });
  const count = await mod.expireStaleTopups();
  assert.equal(count, 2);
});

test("expireStaleTopups: چیزی برای expire کردن نبود → صفر", async () => {
  db.update = () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) });
  assert.equal(await mod.expireStaleTopups(), 0);
});

// ─── parseBlubankDepositSms ─────────────────────────────────────────────────

const SAMPLE_DEPOSIT_SMS = [
  "بلو",
  "واریز پول",
  " فاطمه عزیز، 1,000,000 ریال به حساب شما نشست.",
  " موجودی: 1,068,654 ریال",
  "۲۱:۱۱",
  "۱۴۰۵.۰۶.۰۸",
].join("\n");

test("parseBlubankDepositSms: نمونه‌ی واقعی → ریال درست پارس و به تومان تبدیل می‌شود (÷۱۰)", () => {
  const parsed = mod.parseBlubankDepositSms(SAMPLE_DEPOSIT_SMS);
  assert.ok(parsed);
  assert.equal(parsed.amountRial, 1_000_000);
  assert.equal(parsed.amountToman, 100_000);
});

test("parseBlubankDepositSms: پیامکی که «واریز» ندارد (مثلاً برداشت) → null", () => {
  const text = "بلو\nبرداشت پول\n فاطمه عزیز، 500,000 ریال از حساب شما برداشت شد.\n";
  assert.equal(mod.parseBlubankDepositSms(text), null);
});

test("parseBlubankDepositSms: قالبِ مبلغ/عبارت مطابقت ندارد → null", () => {
  assert.equal(mod.parseBlubankDepositSms("بلو\nواریز پول\nپیام نامرتبط"), null);
});

test("parseBlubankDepositSms: نامِ صاحبِ حساب متغیر است و در الگو قفل نشده", () => {
  const text = "بلو\nواریز پول\n علی عزیز، 250,000 ریال به حساب شما نشست.\n موجودی: 900,000 ریال";
  const parsed = mod.parseBlubankDepositSms(text);
  assert.ok(parsed);
  assert.equal(parsed.amountToman, 25_000);
});
