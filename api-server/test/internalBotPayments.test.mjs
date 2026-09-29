/**
 * test/internalBotPayments.test.mjs — فاز ۵ (سمتِ سایت): API داخلیِ مین‌بات ← سایت برای
 * پرداختِ کارت‌به‌کارتِ باتِ فروشنده (`routes/internalBotPayments.ts`، `lib/paymentBotApi.ts`).
 *
 * تمرکز: ایزولاسیونِ tenant، فقط-یک‌بار بودنِ claimِ اثرِ تأیید، جریانِ فیش، ساختِ idempotent،
 * و اینکه شماره‌کارت فقط در وضعیت‌هایی که باید برمی‌گردد و plaintext هرگز نشت نمی‌کند.
 *
 * بخشِ خالص همیشه اجرا می‌شود؛ بخشِ زنده (express + Postgres واقعی) فقط با `CARD_TEST_PG_URL`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.PAYMENT_INTERNAL_SECRET = "test-internal-secret-value";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";

const { encryptToken } = await import("../src/lib/tokenCrypto.ts");
const { createInternalBotPaymentsRouter } = await import("../src/routes/internalBotPayments.ts");
const { maskCardNumber, formatCardNumber, isValidCardNumber, digitsOnly } = await import("../src/lib/cardMask.ts");
const { ingestSms } = await import("../src/lib/smsIngest.ts");
const { matchSms } = await import("../src/lib/paymentMatcher.ts");
const { createBotPayment, getBotPayment, MAX_ACTIVE_PER_USER } = await import("../src/lib/paymentBotApi.ts");

const SECRET = process.env.PAYMENT_INTERNAL_SECRET;
const CARD = "6037997000000001";
const MIN = 60_000;

// ─── خالص ───────────────────────────────────────────────────────────────────

test("cardMask: ماسک/فرمت/Luhn/ارقامِ فارسی", () => {
  assert.equal(maskCardNumber("6037-9970-0000-0001"), "6037-****-****-0001");
  assert.equal(maskCardNumber("۶۰۳۷۹۹۷۰۰۰۰۰۰۰۰۱"), "6037-****-****-0001");
  assert.equal(maskCardNumber("123"), "****");
  assert.equal(maskCardNumber(null), "****");
  assert.doesNotMatch(maskCardNumber(CARD), /9970|0000/);
  assert.equal(formatCardNumber(CARD), "6037-9970-0000-0001");
  assert.equal(digitsOnly("۱۲-٣٤ab"), "1234");
  assert.equal(isValidCardNumber("4111111111111111"), true);
  assert.equal(isValidCardNumber("4111111111111112"), false);
  assert.equal(isValidCardNumber("0000000000000000"), false);
  assert.equal(isValidCardNumber("411111111111111"), false);
});

test("منبعِ route/lib: لاگ‌ها شماره‌کارت و secret ندارند؛ botId فقط از resolveBot", () => {
  const route = fs.readFileSync(new URL("../src/routes/internalBotPayments.ts", import.meta.url), "utf8");
  const logs = [...route.matchAll(/logger\.(?:info|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(logs.length >= 4);
  // فقط شیءِ داده‌ی لاگ (آرگومانِ اول)؛ متنِ پیام ممکن است کلمه‌ی «secret» داشته باشد.
  for (const l of logs) assert.doesNotMatch(l.split('"')[0], /cardNumber|card_number|secret|receiptFileId/i, l);
  assert.doesNotMatch(route, /body\.botId|body\.bot_id|req\.query\.botId/);
  assert.match(route, /resolveBot\(spreadsheetId\)/);
  const lib = fs.readFileSync(new URL("../src/lib/paymentBotApi.ts", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /logger\./, "lib نباید چیزی لاگ کند (شماره‌کارت در دسترس است)");
  // هر query روی payment_requests به scope/bot_id محدود است
  for (const m of lib.matchAll(/(?:FROM|UPDATE) payment_requests[\s\S]*?(?:`|")/g)) {
    if (/WHERE id = \$1\s*"/.test(m[0])) assert.fail("query بدونِ فیلترِ bot: " + m[0]);
  }
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };

let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const readSql = (f) => {
  const t = fs.readFileSync(new URL(`../../lib/db/migrations/${f}`, import.meta.url), "utf8");
  return t.slice(t.indexOf("-- ───"));
};
const ddl = readSql("0029_card_autoconfirm.sql") + "\n" + readSql("0030_card_autoconfirm_effects.sql");

const SHEETS = { sheet_A_12345: "bot_A", sheet_B_12345: "bot_B" };
const resolveBot = async (sid) => (SHEETS[sid] ? { botId: SHEETS[sid] } : null);
const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });

async function withEnv(fn, { hitFn = okHit } = {}) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p5_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 40, options: `-c search_path=${schema}` });
  await pool.query(ddl);
  await pool.query("CREATE TABLE bots (id text PRIMARY KEY, sheet_id text)");
  await pool.query("INSERT INTO bots (id, sheet_id) VALUES ('bot_A', 'sheet_A_12345'), ('bot_B', 'sheet_B_12345')");
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", createInternalBotPaymentsRouter({ pool, hitFn, resolveBot }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/internal/payments`;
  const call = async (path, body, { secret = SECRET, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-payment-internal-secret": secret }), ...headers },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
  try {
    await fn({ pool, call });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

let n = 0;
async function channel(pool, { botId = "bot_A", kind = "card_manual", active = true, cardEnc = encryptToken(CARD), minRial = 1_000_000 } = {}) {
  const id = `ch_${++n}`;
  await pool.query(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, holder_name, bank_name, payment_url, sms_secret_hash, active, min_amount_rial)
     VALUES ($1,'bot',$2,$3,$4,'علی احمدی','بلوبانک',$5,'h',$6,$7)`,
    [id, botId, kind, kind === "card_manual" ? cardEnc : null, kind === "card_manual" ? null : "https://pay.example/x", active, minRial],
  );
  return { id, scope: "bot", botId, active, senderAllowlist: [], bankParser: "blubank" };
}

const bluText = (amount) =>
  `بلو\nواریز پول\n فاطمه عزیز، ${amount.toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;

const A = "sheet_A_12345";
const B = "sheet_B_12345";
const create = (call, over = {}) => call("/requests/create", {
  spreadsheetId: A, userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000, ...over,
});

test("احرازِ secret: نبود/غلط → ۴۰۳ یکسان؛ شمارشِ شکست → ۴۲۹؛ tenantِ ناموجود → ۴۰۴؛ ورودیِ بد → ۴۰۰", live, async () => {
  let fails = 0;
  const hitFn = async (key) => {
    if (key.startsWith("pay-int-fail:")) { fails++; return fails > 3 ? { allowed: false, retryAfterSeconds: 9 } : { allowed: true, retryAfterSeconds: 0 }; }
    return { allowed: true, retryAfterSeconds: 0 };
  };
  await withEnv(async ({ pool, call }) => {
    await channel(pool);
    const none = await call("/channel", { spreadsheetId: A }, { secret: null });
    const wrong = await call("/channel", { spreadsheetId: A }, { secret: SECRET + "x" });
    assert.equal(none.status, 403);
    assert.equal(wrong.status, 403);
    assert.deepEqual(none.json, wrong.json);
    const wrong2 = await call("/channel", { spreadsheetId: A }, { secret: "" });
    assert.equal(wrong2.status, 403);
    const limited = await call("/channel", { spreadsheetId: A }, { secret: "nope" });
    assert.equal(limited.status, 429);
    // secret درست هرگز شمارشِ شکست را مصرف نمی‌کند
    const before = fails;
    assert.equal((await call("/channel", { spreadsheetId: A })).status, 200);
    assert.equal(fails, before);
    assert.equal((await call("/channel", { spreadsheetId: "sheet_NOPE_99" })).status, 404);
    assert.equal((await call("/channel", { spreadsheetId: "x" })).status, 400);
    assert.equal((await call("/channel", {})).status, 400);
  }, { hitFn });
});

test("کانال: فقط اطلاعاتِ نمایشی، بدونِ شماره‌کارت؛ بدونِ کانالِ فعال → null", live, () =>
  withEnv(async ({ pool, call }) => {
    assert.equal((await call("/channel", { spreadsheetId: A })).json.channel, null);
    await channel(pool, { active: false });
    assert.equal((await call("/channel", { spreadsheetId: A })).json.channel, null);
    const ch = await channel(pool);
    const r = await call("/channel", { spreadsheetId: A });
    assert.equal(r.json.channel.id, ch.id);
    assert.equal(r.json.channel.holderName, "علی احمدی");
    assert.equal(r.json.channel.minAmountRial, 1_000_000);
    assert.doesNotMatch(JSON.stringify(r.json), /6037|cardNumber|card_number|_enc/i);
  }));

test("ساخت: pending با final=base+suffix، شماره‌کارتِ رمزگشایی‌شده و expiresAt؛ بدونِ کانال → no_channel", live, () =>
  withEnv(async ({ pool, call }) => {
    const none = await create(call);
    assert.equal(none.status, 409);
    assert.equal(none.json.code, "no_channel");
    await channel(pool);
    const r = await create(call);
    assert.equal(r.status, 201);
    const p = r.json.payment;
    assert.equal(p.status, "pending");
    assert.equal(p.baseAmountRial, 2_000_000);
    assert.ok(p.suffixRial >= 10 && p.suffixRial <= 9990 && p.suffixRial % 10 === 0);
    assert.equal(p.finalAmountRial, 2_000_000 + p.suffixRial);
    assert.equal(p.channel.cardNumber, CARD);
    assert.equal(p.channel.holderName, "علی احمدی");
    assert.ok(new Date(p.expiresAt) > new Date());
    assert.equal(r.json.existing, false);
    assert.equal(p.userId, "1001");
    // ذخیره‌ی DB: scope/bot_id از سرور، نه بدنه
    const row = (await pool.query("SELECT scope, bot_id FROM payment_requests WHERE id=$1", [p.id])).rows[0];
    assert.deepEqual([row.scope, row.bot_id], ["bot", "bot_A"]);
  }));

test("ساختِ idempotent: همان مبلغ → همان درخواست؛ مبلغِ دیگر → ۴۰۹؛ ۱۰ ساختِ هم‌زمان → یک درخواست", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const r1 = await create(call);
    const r2 = await create(call);
    assert.equal(r2.json.existing, true);
    assert.equal(r2.json.payment.id, r1.json.payment.id);
    const diff = await create(call, { baseAmountRial: 3_000_000 });
    assert.equal(diff.status, 409);
    assert.equal(diff.json.code, "active_request_exists");

    const outs = await Promise.all(Array.from({ length: 10 }, () => create(call, { userId: "2002", baseAmountRial: 1_500_000 })));
    assert.ok(outs.every((o) => o.status === 201));
    assert.equal(new Set(outs.map((o) => o.json.payment.id)).size, 1, "کاربر باید فقط یک درخواست بگیرد");
    assert.equal(outs.filter((o) => !o.json.existing).length, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_requests WHERE user_id='2002'")).rows[0].n, 1);
  }));

test("سقفِ درخواستِ فعال به‌ازای کاربر، حداقلِ مبلغ و اعتبارسنجیِ ورودی", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    for (let i = 0; i < MAX_ACTIVE_PER_USER; i++) {
      assert.equal((await create(call, { purpose: "order", orderId: `ord_${i}` })).status, 201);
    }
    const over = await create(call, { purpose: "order", orderId: "ord_over" });
    assert.equal(over.status, 409);
    assert.equal(over.json.code, "active_request_limit");
    // کاربرِ دیگر تحت‌تأثیر نیست
    assert.equal((await create(call, { userId: "3003" })).status, 201);

    const low = await create(call, { userId: "4004", baseAmountRial: 500_000 });
    assert.equal(low.status, 400);
    assert.equal(low.json.code, "amount_below_minimum");

    for (const bad of [
      { baseAmountRial: 1_500_000.5 }, { baseAmountRial: -5 }, { baseAmountRial: "abc" }, { baseAmountRial: 0 },
      { baseAmountRial: 1e20 }, { baseAmountRial: null },
      { userId: "12a" }, { userId: "" }, { userId: "1".repeat(30) },
      { purpose: "refund" }, { purpose: "order" }, { purpose: "wallet_topup", orderId: "x" },
      { purpose: "order", orderId: "bad id!" },
    ]) {
      const r = await create(call, { userId: "5005", ...bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_requests WHERE user_id='5005'")).rows[0].n, 0);
  }));

test("ایزولاسیونِ tenant: باتِ B هیچ‌چیزِ باتِ A را نمی‌بیند/تغییر نمی‌دهد؛ کانالِ دیگری را هم نمی‌تواند بخواهد", live, () =>
  withEnv(async ({ pool, call }) => {
    const chA = await channel(pool, { botId: "bot_A" });
    const chB = await channel(pool, { botId: "bot_B" });
    const a = (await create(call)).json.payment;
    assert.equal(a.channel.id, chA.id);

    assert.equal((await call("/requests/get", { spreadsheetId: B, requestId: a.id })).status, 404);
    assert.equal((await call("/requests/receipt", { spreadsheetId: B, userId: "1001", requestId: a.id, receiptFileId: "f" })).status, 404);
    assert.equal((await call("/requests/cancel", { spreadsheetId: B, userId: "1001", requestId: a.id })).status, 404);
    assert.deepEqual((await call("/requests/list", { spreadsheetId: B })).json.payments, []);
    assert.equal((await call("/requests/list", { spreadsheetId: A })).json.payments.length, 1);
    assert.equal((await call("/channel", { spreadsheetId: B })).json.channel.id, chB.id);
    // A نمی‌تواند روی کانالِ B درخواست بسازد
    const cross = await create(call, { userId: "9009", channelId: chB.id });
    assert.equal(cross.status, 409);
    assert.equal(cross.json.code, "no_channel");
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_requests WHERE channel_id=$1", [chB.id])).rows[0].n, 0);
    // بعد از تأییدِ A هم B نمی‌تواند claim/done کند
    const sms = await ingestSms(pool, chA, { text: bluText(a.finalAmountRial), sender: "Blubank", time: new Date().toISOString() });
    assert.equal((await matchSms(pool, sms.id)).outcome, "confirmed");
    const cB = await call("/requests/claim", { spreadsheetId: B, requestId: a.id });
    assert.equal(cB.json.claimed, false);
    assert.equal((await call("/requests/effect-done", { spreadsheetId: B, requestId: a.id })).json.done, false);
    assert.deepEqual((await call("/requests/unclaimed", { spreadsheetId: B })).json.payments, []);
    assert.equal((await pool.query("SELECT effect_claimed_at FROM payment_requests WHERE id=$1", [a.id])).rows[0].effect_claimed_at, null);
  }));

test("مالکیت: کاربرِ دیگرِ همان بات نمی‌تواند فیش بدهد یا لغو کند", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const a = (await create(call)).json.payment;
    assert.equal((await call("/requests/receipt", { spreadsheetId: A, userId: "7777", requestId: a.id, receiptFileId: "f" })).status, 404);
    assert.equal((await call("/requests/cancel", { spreadsheetId: A, userId: "7777", requestId: a.id })).status, 404);
    assert.equal((await call("/requests/get", { spreadsheetId: A, requestId: a.id })).json.payment.status, "pending");
  }));

test("فیش: pending → awaiting_review؛ دوباره/صف/لغو بعد از فیش → ۴۰۹؛ file_idِ نامعتبر → ۴۰۰", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const a = (await create(call)).json.payment;
    const bad = await call("/requests/receipt", { spreadsheetId: A, userId: "1001", requestId: a.id, receiptFileId: "x".repeat(300) });
    assert.equal(bad.status, 400);
    assert.equal((await call("/requests/receipt", { spreadsheetId: A, userId: "1001", requestId: a.id, receiptFileId: "" })).status, 400);
    const r = await call("/requests/receipt", { spreadsheetId: A, userId: "1001", requestId: a.id, receiptFileId: "AgACfile123" });
    assert.equal(r.status, 200);
    assert.equal(r.json.payment.status, "awaiting_review");
    assert.ok(r.json.payment.receiptUploadedAt);
    assert.equal(r.json.payment.channel.cardNumber, CARD, "در awaiting_review هنوز شماره‌کارت نمایش داده می‌شود");
    const row = (await pool.query("SELECT receipt_file_id FROM payment_requests WHERE id=$1", [a.id])).rows[0];
    assert.equal(row.receipt_file_id, "AgACfile123");
    assert.equal((await call("/requests/receipt", { spreadsheetId: A, userId: "1001", requestId: a.id, receiptFileId: "again" })).json.code, "wrong_state");
    const c = await call("/requests/cancel", { spreadsheetId: A, userId: "1001", requestId: a.id });
    assert.equal(c.status, 409, "بعد از فیش فقط ادمین تصمیم می‌گیرد");
    assert.equal((await pool.query("SELECT status FROM payment_requests WHERE id=$1", [a.id])).rows[0].status, "awaiting_review");
  }));

test("fixed_link: نفرِ دوم queued (بدونِ شماره‌کارت/لینک، با جایگاه)؛ فیش روی queued ممنوع؛ لغوِ اولی، دومی را pending می‌کند", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool, { kind: "fixed_link" });
    const first = (await create(call, { userId: "1001", baseAmountRial: 1_500_000 })).json.payment;
    const second = (await create(call, { userId: "1002", baseAmountRial: 1_500_000 })).json.payment;
    assert.equal(first.status, "pending");
    assert.equal(first.suffixRial, 0);
    assert.equal(first.channel.paymentUrl, "https://pay.example/x");
    assert.equal(second.status, "queued");
    assert.equal(second.queuedAhead, 0);
    assert.equal(second.channel.cardNumber, null);
    assert.equal(second.channel.paymentUrl, null);
    const third = (await create(call, { userId: "1003", baseAmountRial: 1_500_000 })).json.payment;
    assert.equal(third.queuedAhead, 1);
    assert.equal((await call("/requests/receipt", { spreadsheetId: A, userId: "1002", requestId: second.id, receiptFileId: "f" })).json.code, "wrong_state");
    const c = await call("/requests/cancel", { spreadsheetId: A, userId: "1001", requestId: first.id });
    assert.equal(c.status, 200);
    assert.equal(c.json.payment.status, "canceled");
    assert.deepEqual(c.json.promotedIds, [second.id]);
    const g = (await call("/requests/get", { spreadsheetId: A, requestId: second.id })).json.payment;
    assert.equal(g.status, "pending");
    assert.equal(g.channel.paymentUrl, "https://pay.example/x");
    assert.equal((await call("/requests/get", { spreadsheetId: A, requestId: third.id })).json.payment.queuedAhead, 0);
  }));

test("سرتاسر: ساخت → پیامکِ واریز → confirmed(sms) → unclaimed → ۱۰ claimِ هم‌زمان فقط یکی → effect-done", live, () =>
  withEnv(async ({ pool, call }) => {
    const ch = await channel(pool);
    const a = (await create(call)).json.payment;
    const sms = await ingestSms(pool, ch, { text: bluText(a.finalAmountRial), sender: "Blubank", time: new Date().toISOString() });
    assert.equal((await matchSms(pool, sms.id)).outcome, "confirmed", "effectِ state-only باید ثبت باشد");
    const g = (await call("/requests/get", { spreadsheetId: A, requestId: a.id })).json.payment;
    assert.equal(g.status, "confirmed");
    assert.equal(g.confirmedBy, "sms");
    assert.equal(g.channel.cardNumber, null, "بعد از تأیید شماره‌کارت برنمی‌گردد");
    assert.equal(g.effectClaimed, false);

    const un = (await call("/requests/unclaimed", { spreadsheetId: A })).json.payments;
    assert.deepEqual(un.map((p) => p.id), [a.id]);

    const claims = await Promise.all(Array.from({ length: 10 }, () => call("/requests/claim", { spreadsheetId: A, requestId: a.id })));
    assert.equal(claims.filter((c) => c.json.claimed === true).length, 1, "فقط یک claim موفق");
    assert.ok(claims.every((c) => c.status === 200));
    assert.deepEqual((await call("/requests/unclaimed", { spreadsheetId: A })).json.payments, []);

    assert.equal((await call("/requests/effect-done", { spreadsheetId: A, requestId: a.id })).json.done, true);
    assert.equal((await call("/requests/effect-done", { spreadsheetId: A, requestId: a.id })).json.done, false);
    const row = (await pool.query("SELECT effect_claimed_at, effect_done_at FROM payment_requests WHERE id=$1", [a.id])).rows[0];
    assert.ok(row.effect_claimed_at && row.effect_done_at);
    // claim روی درخواستِ confirmedنشده اثری ندارد
    const p2 = (await create(call, { userId: "2222" })).json.payment;
    assert.equal((await call("/requests/claim", { spreadsheetId: A, requestId: p2.id })).json.claimed, false);
    assert.equal((await call("/requests/effect-done", { spreadsheetId: A, requestId: p2.id })).json.done, false);
  }));

test("CHECKِ دیتابیس: effect_claimed_at فقط برای confirmed و done فقط بعد از claim", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const a = (await create(call)).json.payment;
    await assert.rejects(pool.query("UPDATE payment_requests SET effect_claimed_at = now() WHERE id=$1", [a.id]), /payment_requests_effect_chk/);
    await assert.rejects(pool.query("UPDATE payment_requests SET effect_done_at = now() WHERE id=$1", [a.id]), /payment_requests_effect_chk/);
  }));

test("پیامکِ پیش از ساخت (retest): ساخت بلافاصله confirmed برمی‌گرداند و درخواست‌های دیگر دست‌نخورده‌اند", live, () =>
  withEnv(async ({ pool }) => {
    const ch = await channel(pool);
    // مبلغِ نهایی را پیشاپیش می‌دانیم چون suffix را ثابت می‌کنیم
    const randomInt = () => 4; // pickRandom → آیتمِ پنجمِ free (suffix=50)
    const probe = await createBotPayment(pool, { botId: "bot_A", userId: "1", purpose: "wallet_topup", baseAmountRial: 2_000_000, randomInt });
    const final = probe.payment.finalAmountRial;
    await pool.query("UPDATE payment_requests SET status='canceled' WHERE id=$1", [probe.payment.id]);
    const sms = await ingestSms(pool, ch, { text: bluText(final), sender: "Blubank", time: new Date().toISOString() });
    assert.equal((await matchSms(pool, sms.id)).outcome, "no_candidate");
    const r = await createBotPayment(pool, { botId: "bot_A", userId: "2", purpose: "wallet_topup", baseAmountRial: 2_000_000, randomInt });
    assert.equal(r.payment.finalAmountRial, final);
    assert.equal(r.payment.status, "confirmed");
    assert.equal(r.payment.confirmedBy, "sms");
  }));

test("فیش + پیامکِ دیررسید: awaiting_review هم با پیامک تأیید می‌شود", live, () =>
  withEnv(async ({ pool, call }) => {
    const ch = await channel(pool);
    const a = (await create(call)).json.payment;
    await call("/requests/receipt", { spreadsheetId: A, userId: "1001", requestId: a.id, receiptFileId: "AgAC" });
    const sms = await ingestSms(pool, ch, { text: bluText(a.finalAmountRial), sender: "Blubank", time: new Date().toISOString() });
    assert.equal((await matchSms(pool, sms.id)).outcome, "confirmed");
    const g = (await call("/requests/get", { spreadsheetId: A, requestId: a.id })).json.payment;
    assert.deepEqual([g.status, g.confirmedBy], ["confirmed", "sms"]);
  }));

test("انقضا: درخواستِ سررسیدشده هنگامِ get/create منقضی می‌شود (تا sweeperِ فاز ۹)", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const old = new Date(Date.now() - 2 * 60 * MIN);
    const r = await createBotPayment(pool, { botId: "bot_A", userId: "1", purpose: "wallet_topup", baseAmountRial: 2_000_000, now: old, expiryMs: 30 * MIN });
    assert.equal(r.payment.status, "pending");
    const g = (await call("/requests/get", { spreadsheetId: A, requestId: r.payment.id })).json.payment;
    assert.equal(g.status, "expired");
    assert.equal(g.channel.cardNumber, null);
    assert.equal((await getBotPayment(pool, "bot_A", r.payment.id)).status, "expired");
    // جای آزادشده: کاربر دوباره می‌تواند بسازد
    assert.equal((await create(call, { userId: "1" })).status, 201);
  }));

test("شماره‌کارتِ plaintext در DB هرگز نمایش داده نمی‌شود (card_unavailable)", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool, { cardEnc: "6037997000000001" });
    const r = await create(call);
    assert.equal(r.status, 500);
    assert.equal(r.json.code, "card_unavailable");
    assert.doesNotMatch(JSON.stringify(r.json), /6037/);
  }));

test("work: همه‌ی کارهای بازِ همه‌ی بات‌ها با spreadsheetId؛ فقط با secret؛ بدونِ شماره‌کارت؛ فقط فعال‌ها و تأییدشده‌ی claim‌نشده", live, () =>
  withEnv(async ({ pool, call }) => {
    const chA = await channel(pool, { botId: "bot_A" });
    await channel(pool, { botId: "bot_B" });
    const a1 = (await create(call, { userId: "1001" })).json.payment;
    const a2 = (await create(call, { userId: "1002" })).json.payment;
    const b1 = (await call("/requests/create", { spreadsheetId: B, userId: "2001", purpose: "wallet_topup", baseAmountRial: 1_500_000 })).json.payment;
    // a2: فیش → awaiting_review؛ a1: تأیید با پیامک (claim‌نشده)
    await call("/requests/receipt", { spreadsheetId: A, userId: "1002", requestId: a2.id, receiptFileId: "AgAC" });
    const sms = await ingestSms(pool, chA, { text: bluText(a1.finalAmountRial), sender: "Blubank", time: new Date().toISOString() });
    assert.equal((await matchSms(pool, sms.id)).outcome, "confirmed");

    assert.equal((await call("/work", {}, { secret: null })).status, 403);
    assert.equal((await call("/work", {}, { secret: "bad" })).status, 403);
    const w = await call("/work", {});
    assert.equal(w.status, 200);
    const byId = Object.fromEntries(w.json.items.map((i) => [i.payment.id, i]));
    assert.deepEqual(Object.keys(byId).sort(), [a1.id, a2.id, b1.id].sort());
    assert.equal(byId[a1.id].spreadsheetId, A);
    assert.equal(byId[a2.id].spreadsheetId, A);
    assert.equal(byId[b1.id].spreadsheetId, B);
    assert.equal(byId[a1.id].payment.status, "confirmed");
    assert.equal(byId[a2.id].payment.status, "awaiting_review");
    assert.doesNotMatch(JSON.stringify(w.json), /6037997000000001|cardNumber":"\d/, "شماره‌کارت نباید در work بیاید");
    assert.ok(w.json.items.every((i) => i.payment.channel.cardNumber === null && i.payment.channel.paymentUrl === null));

    // بعد از claim، a1 از work حذف می‌شود؛ لغو/انقضا هم
    await call("/requests/claim", { spreadsheetId: A, requestId: a1.id });
    await call("/requests/cancel", { spreadsheetId: B, userId: "2001", requestId: b1.id });
    const w2 = await call("/work", {});
    assert.deepEqual(w2.json.items.map((i) => i.payment.id), [a2.id]);
  }));
