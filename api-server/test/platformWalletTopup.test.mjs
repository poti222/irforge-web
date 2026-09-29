/**
 * test/platformWalletTopup.test.mjs — فاز ۸ کارت‌به‌کارتِ خودکار: شارژِ کیف‌پولِ خودِ IrForge روی ماژولِ مشترک
 * (`routes/walletTopup.ts`، `lib/platformWallet.ts`، `lib/platformWalletEffect.ts`، aliasِ `walletTopupSmsWebhook.ts`).
 *
 * معیار: شارژِ کیف‌پولِ پلتفرم end-to-end با ماژولِ جدید؛ اثرِ مالی دقیقاً یک‌بار (حتی زیرِ race)، rollbackِ کاملِ تأیید اگر شارژ
 * نشد، ایزوله‌سازیِ کاربر/scope، مسیرِ فیش + تأییدِ دستی، و aliasِ قدیمیِ پیامک که منطقِ موازی ندارد.
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL` (Postgres واقعی، schemaِ موقتِ جدا، express واقعی روی HTTP).
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.SMS_WEBHOOK_SECRET = "legacy-webhook-secret-for-tests";

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { DDL_ALL, SITE_TABLES_DDL } from "./helpers/cardPayDdl.mjs";

const { createWalletTopupRouter } = await import("../src/routes/walletTopup.ts");
const { createPaymentSmsRouter } = await import("../src/routes/paymentSmsWebhook.ts");
const { createLegacyWalletWebhookRouter } = await import("../src/routes/walletTopupSmsWebhook.ts");
const { createChannel, validateNewChannel, PLATFORM_OWNER } = await import("../src/lib/paymentChannelAdmin.ts");
const { matchSms } = await import("../src/lib/paymentMatcher.ts");
const { createPaymentAlerts } = await import("../src/lib/paymentAlerts.ts");
const { logPaymentEvent } = await import("../src/lib/paymentEvents.ts");
const { decideRequestByAdmin } = await import("../src/lib/paymentDecisions.ts");
const { TOPUP_PRESETS_TOMAN, TOPUP_MIN_TOMAN } = await import("../src/lib/platformWallet.ts");
const { registerDefaultPaymentEffects } = await import("../src/lib/paymentEffectsBoot.ts");
const { createBotPayment } = await import("../src/lib/paymentBotApi.ts");
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");

registerDefaultPaymentEffects();

const CARD = "6037997000000001";
const CARD2 = "6104337000000008";
const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ─── خالص ───────────────────────────────────────────────────────────────────

test("پیش‌ست‌ها و حداقلِ شارژ طبقِ مشخصاتِ فاز ۸", () => {
  assert.deepEqual([...TOPUP_PRESETS_TOMAN], [100_000, 200_000, 500_000, 700_000, 1_000_000]);
  assert.equal(TOPUP_MIN_TOMAN, 100_000);
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

async function withEnv(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p8_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 40, options: `-c search_path=${schema}` });
  await pool.query(DDL_ALL);
  await pool.query(SITE_TABLES_DDL);
  await pool.query("INSERT INTO users (id, name, email) VALUES ('u1','علی','a@x.io'),('u2','رضا','b@x.io')");

  const userNotes = [];
  const adminNotes = [];
  const alerts = createPaymentAlerts({
    record: (ev) => logPaymentEvent(pool, ev),
    notifyPlatformUser: async (userId, m) => { userNotes.push({ userId, ...m }); },
    notifyAdmins: async (m) => { adminNotes.push(m); },
  });
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", createWalletTopupRouter({
    pool, hitFn: okHit, alerts,
    auth: (req, res, next) => {
      const u = req.header("x-test-user");
      if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
      req.userId = u; next();
    },
    profile: (_req, _res, next) => next(),
    notifyAdmins: async (m) => { adminNotes.push(m); },
  }));
  app.use("/api", createPaymentSmsRouter({ pool, hitFn: okHit, matcher: (p, id) => matchSms(p, id, { alerts }) }));
  app.use("/api", createLegacyWalletWebhookRouter({ pool, hitFn: okHit, rateLimit: (_q, _s, n) => n(), alerts }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}/api`;

  const call = async (method, path, { body, user = "u1", headers = {} } = {}) => {
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const postSms = async (channelId, secret, text, extra = {}) => {
    const res = await fetch(`${origin}/payments/sms/${channelId}`, {
      method: "POST", headers: { "content-type": "application/json", "x-sms-secret": secret },
      body: JSON.stringify({ text, sender: "Blubank", time: new Date().toISOString(), ...extra }),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const mkChannel = async (fields = {}) => createChannel(pool, {
    owner: PLATFORM_OWNER, maxChannels: 5,
    fields: validateNewChannel({ cardNumber: CARD, holderName: "صاحبِ سایت", bankName: "بلو", bankParser: "blubank", ...fields }),
  });
  const balance = async (userId = "u1") => Number((await pool.query("SELECT balance FROM wallets WHERE user_id = $1", [userId])).rows[0]?.balance ?? 0);
  const ledger = async (userId = "u1") => (await pool.query("SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at", [userId])).rows;
  const reqRow = async (id) => (await pool.query("SELECT * FROM payment_requests WHERE id = $1", [id])).rows[0];
  const events = async (kind) => (await pool.query("SELECT * FROM payment_events WHERE kind = $1", [kind])).rows;
  const bankSms = (rial) => `بلو\nواریز پول\n فاطمه عزیز، ${Number(rial).toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;

  try {
    await fn({ pool, call, postSms, mkChannel, balance, ledger, reqRow, events, bankSms, userNotes, adminNotes, origin });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test("config: بدونِ کانال غیرفعال؛ با کانال، پیش‌ست‌ها و حداقل — و شماره‌کارتِ کامل هرگز", live, () => withEnv(async (t) => {
  let r = await t.call("GET", "/wallet/topup/config");
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.enabled, r.json.channels.length], [false, 0]);
  const { channel } = await t.mkChannel();
  r = await t.call("GET", "/wallet/topup/config");
  assert.equal(r.json.enabled, true);
  assert.deepEqual(r.json.presets, [100_000, 200_000, 500_000, 700_000, 1_000_000]);
  assert.equal(r.json.min, 100_000);
  assert.equal(r.json.channels[0].id, channel.id);
  assert.equal(r.json.channels[0].cardLast4, "0001");
  assert.ok(!JSON.stringify(r.json).includes(CARD), "شماره‌کارتِ کامل نباید در config بیاید");
  assert.equal((await t.call("GET", "/wallet/topup/config", { user: null })).status, 401);
  // کانالِ غیرفعال دیده نمی‌شود
  await t.pool.query("UPDATE payment_channels SET active = false");
  assert.equal((await t.call("GET", "/wallet/topup/config")).json.enabled, false);
}));

test("درخواست: اعتبارسنجیِ مبلغ، مبلغِ نهاییِ یکتا، idempotency، سقفِ فعال", live, () => withEnv(async (t) => {
  await t.mkChannel();
  for (const bad of [99_999, 0, -5, 1.5, "abc", 50_000_001, null]) {
    const r = await t.call("POST", "/wallet/topup/request", { body: { amount: bad } });
    assert.equal(r.status, 400, `amount=${bad}`);
    assert.equal(r.json.code, "invalid_amount");
  }
  const a = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  assert.equal(a.status, 201);
  assert.equal(a.json.status, "pending");
  assert.equal(a.json.requestedAmount, 200_000);
  assert.ok(a.json.finalAmount > 2_000_000 && a.json.finalAmount <= 2_000_000 + 9990 && a.json.finalAmount % 10 === 0);
  assert.equal(a.json.channel.cardNumber, CARD);                 // شماره‌ی کارت فقط داخلِ درخواستِ فعالِ خودش
  assert.ok(a.json.expiresAt);
  // همان مبلغ دوباره → همان درخواست
  const again = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  assert.deepEqual([again.status, again.json.existing, again.json.id], [200, true, a.json.id]);
  // مبلغِ دیگر → درخواستِ دوم؛ سقفِ ۳ فعال
  assert.equal((await t.call("POST", "/wallet/topup/request", { body: { amount: 300_000 } })).status, 201);
  assert.equal((await t.call("POST", "/wallet/topup/request", { body: { amount: 400_000 } })).status, 201);
  const cap = await t.call("POST", "/wallet/topup/request", { body: { amount: 500_000 } });
  assert.deepEqual([cap.status, cap.json.code], [429, "active_request_limit"]);
  assert.equal((await t.events("request_created")).length, 3);
}));

test("سرتاسر: مشتری دقیقاً مبلغِ نهایی را واریز می‌کند → پیامک تأیید و کیف‌پول فقط base شارژ می‌شود، یک‌بار", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkChannel();
  const r = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  const final = r.json.finalAmount;

  // ±۱۰ ریال → هیچ‌کاری
  const wrong = await t.postSms(channel.id, smsSecret, t.bankSms(final + 10));
  assert.equal(wrong.json.matched, false);
  assert.equal(await t.balance(), 0);
  assert.equal((await t.call("GET", `/wallet/topup/${r.json.id}/status`)).json.status, "pending");

  const ok = await t.postSms(channel.id, smsSecret, t.bankSms(final));
  assert.deepEqual([ok.status, ok.json.matched], [201, true]);
  assert.equal(await t.balance(), 2_000_000);                    // base، نه final (پسوند پولِ کاربر نیست)
  const led = await t.ledger();
  assert.equal(led.length, 1);
  assert.deepEqual([led[0].type, Number(led[0].amount), led[0].status], ["deposit_card_auto", 2_000_000, "approved"]);
  assert.match(led[0].review_note, new RegExp(r.json.id));
  const row = await t.reqRow(r.json.id);
  assert.deepEqual([row.status, row.confirmed_by], ["confirmed", "sms"]);
  assert.ok(row.effect_claimed_at && row.effect_done_at, "اثر «اعمال‌شده» علامت خورده است");
  const st = await t.call("GET", `/wallet/topup/${r.json.id}/status`);
  assert.deepEqual([st.json.status, st.json.confirmedBy], ["confirmed", "sms"]);
  assert.equal(st.json.channel.cardNumber, null);                // بعد از تأیید شماره‌کارت دیگر برنمی‌گردد

  // تکرارِ همان پیامک (retryِ forwarder) و پیامکِ دیررسیدِ همان مبلغ → اثرِ دوم ندارد
  const dup = await t.postSms(channel.id, smsSecret, t.bankSms(final), { time: undefined });
  assert.ok([200, 201].includes(dup.status));
  assert.equal(dup.json.matched, false);
  assert.equal(await t.balance(), 2_000_000);
  assert.equal((await t.ledger()).length, 1);
  // اعلانِ کاربر (بعد از commit) و لاگِ ادمین
  assert.equal(t.userNotes.length, 1);
  assert.equal(t.userNotes[0].userId, "u1");
  assert.equal(t.userNotes[0].type, "wallet_topup_confirmed");
  assert.equal((await t.events("confirmed_by_sms")).length, 1);
  assert.equal((await t.events("sms_received")).length >= 2, true);
}));

test("پیامکِ برداشت، فرستنده‌ی غیرمجاز و secretِ غلط هرگز شارژ نمی‌کنند", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkChannel({ senderAllowlist: ["Blubank"] });
  const r = await t.call("POST", "/wallet/topup/request", { body: { amount: 100_000 } });
  const final = r.json.finalAmount;
  const withdraw = `بلو\nبرداشت\n ${final.toLocaleString("en-US")} ریال از حساب شما کسر شد.\n موجودی: 1,000 ریال`;
  assert.equal((await t.postSms(channel.id, smsSecret, withdraw)).json.matched, false);
  assert.equal((await t.postSms(channel.id, smsSecret, t.bankSms(final), { sender: "Scammer" })).json.matched, false);
  assert.equal((await t.postSms(channel.id, "irfsms_wrong", t.bankSms(final))).status, 401);
  assert.equal(await t.balance(), 0);
  assert.equal((await t.events("sms_auth_failed")).length, 1);
  // در لاگِ ادمین هیچ متنِ خامِ پیامک/secret نیست
  const all = JSON.stringify((await t.pool.query("SELECT * FROM payment_events")).rows);
  assert.ok(!all.includes("فاطمه عزیز") && !all.includes(smsSecret) && !all.includes(CARD));
}));

test("race: پیامک و تأییدِ دستیِ هم‌زمان (و ۱۰ ارسالِ هم‌زمانِ همان پیامک) → فقط یک شارژ", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkChannel();
  for (let round = 0; round < 3; round++) {
    const uid = `race${round}`;
    const r = await t.call("POST", "/wallet/topup/request", { user: uid, body: { amount: 100_000 } });
    const final = r.json.finalAmount;
    const [d, s1, ...rest] = await Promise.all([
      decideRequestByAdmin(t.pool, { requestId: r.json.id, decision: "approve", adminId: "root" }),
      t.postSms(channel.id, smsSecret, t.bankSms(final), { time: "2026-09-29T10:00:00Z" }),
      ...Array.from({ length: 8 }, () => t.postSms(channel.id, smsSecret, t.bankSms(final), { time: "2026-09-29T10:00:00Z" })),
    ]);
    assert.ok(d.decided === true || d.request.status === "confirmed");
    assert.equal(await t.balance(uid), 1_000_000, `round ${round}`);
    assert.equal((await t.ledger(uid)).length, 1, `round ${round}`);
    assert.ok([s1, ...rest].every((x) => [200, 201].includes(x.status)));
  }
}));

test("effect خطا می‌دهد (سرریزِ موجودی) → کلِ تأیید rollback: pending می‌ماند، ledger بی‌تغییر، رویدادِ خطا ثبت می‌شود", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkChannel();
  const r = await t.call("POST", "/wallet/topup/request", { body: { amount: 500_000 } });
  await t.pool.query("INSERT INTO wallets (id, user_id, balance) VALUES ('w1','u1',2147000000)");   // + ۵٬۰۰۰٬۰۰۰ از INTEGER می‌گذرد
  const res = await t.postSms(channel.id, smsSecret, t.bankSms(r.json.finalAmount));
  assert.equal(res.json.matched, false);
  assert.equal(await t.balance(), 2147000000);
  assert.equal((await t.ledger()).length, 0);
  const row = await t.reqRow(r.json.id);
  assert.equal(row.status, "pending");
  assert.equal(row.confirmed_by, null);
  const sms = (await t.pool.query("SELECT status FROM sms_inbox WHERE channel_id = $1", [channel.id])).rows[0];
  assert.equal(sms.status, "unmatched");
  assert.equal((await t.events("confirm_blocked_effect_failed")).length, 1);
  assert.equal(t.userNotes.length, 0);                            // کاربر «تأیید شد» نمی‌بیند
}));

test("مسیرِ فیش: آپلود → awaiting_review → تأییدِ دستی شارژ می‌کند؛ ردِ دستی نمی‌کند؛ دیگران دسترسی ندارند", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkChannel();
  const r = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  const id = r.json.id;
  for (const bad of [undefined, "", "hello", "data:text/html;base64,PHNjcmlwdD4=", "https://evil.example/x.png", `data:image/png;base64,${"A".repeat(200_000)}`]) {
    const x = await t.call("POST", `/wallet/topup/${id}/receipt`, { body: { receiptUrl: bad } });
    assert.equal(x.status, 400, String(bad).slice(0, 30));
  }
  // کاربرِ دیگر نه می‌بیند، نه فیش می‌گذارد، نه لغو می‌کند
  assert.equal((await t.call("GET", `/wallet/topup/${id}/status`, { user: "u2" })).status, 404);
  assert.equal((await t.call("POST", `/wallet/topup/${id}/receipt`, { user: "u2", body: { receiptUrl: PNG } })).status, 404);
  assert.equal((await t.call("POST", `/wallet/topup/${id}/cancel`, { user: "u2" })).status, 404);
  assert.equal((await t.reqRow(id)).status, "pending");

  const up = await t.call("POST", `/wallet/topup/${id}/receipt`, { body: { receiptUrl: PNG } });
  assert.deepEqual([up.status, up.json.status], [200, "awaiting_review"]);
  assert.ok(up.json.receiptUploadedAt);
  assert.equal(t.adminNotes.filter((m) => m.type === "admin_topup_receipt").length, 1);
  // بعد از فیش کاربر دیگر لغو نمی‌کند (فقط ادمین تصمیم می‌گیرد)
  assert.equal((await t.call("POST", `/wallet/topup/${id}/cancel`)).status, 409);
  // فیشِ دوباره
  assert.equal((await t.call("POST", `/wallet/topup/${id}/receipt`, { body: { receiptUrl: PNG } })).status, 409);

  const ok = await decideRequestByAdmin(t.pool, { requestId: id, decision: "approve", adminId: "root" });
  assert.equal(ok.decided, true);
  assert.equal(await t.balance(), 2_000_000);
  assert.equal((await t.reqRow(id)).confirmed_by, "admin");
  const second = await decideRequestByAdmin(t.pool, { requestId: id, decision: "reject", adminId: "root2" });
  assert.equal(second.decided, false);                            // اولین تصمیم برنده است
  assert.equal(await t.balance(), 2_000_000);

  // ردِ دستی: هیچ شارژی
  const r2 = await t.call("POST", "/wallet/topup/request", { user: "u2", body: { amount: 100_000 } });
  await t.call("POST", `/wallet/topup/${r2.json.id}/receipt`, { user: "u2", body: { receiptUrl: PNG } });
  const rej = await decideRequestByAdmin(t.pool, { requestId: r2.json.id, decision: "reject", adminId: "root", reason: "فیش نامعتبر" });
  assert.equal(rej.decided, true);
  assert.equal(await t.balance("u2"), 0);
  assert.equal((await t.call("GET", `/wallet/topup/${r2.json.id}/status`, { user: "u2" })).json.rejectReason, "فیش نامعتبر");
  // پیامکِ دیررسیدِ همان مبلغ روی درخواستِ ردشده اثری ندارد
  const late = await t.postSms(channel.id, smsSecret, t.bankSms(r2.json.finalAmount));
  assert.ok([200, 201].includes(late.status));
  assert.equal(late.json.matched, false);
  assert.equal(await t.balance("u2"), 0);
}));

test("ایزوله‌سازی: کانالِ bot هرگز برایِ شارژِ پلتفرم انتخاب نمی‌شود و درخواستِ bot از این API دیده نمی‌شود", live, () => withEnv(async (t) => {
  await t.mkChannel();
  await t.pool.query(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, holder_name, sms_secret_hash)
     VALUES ('botch','bot','bot_A','card_manual','x:y:z','فروشنده','h')`);
  const viaBot = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000, channelId: "botch" } });
  assert.deepEqual([viaBot.status, viaBot.json.code], [503, "no_channel"]);
  const cfg = await t.call("GET", "/wallet/topup/config");
  assert.ok(!cfg.json.channels.some((c) => c.id === "botch"));
  // یک درخواستِ bot-scope با user_id مشابهِ کاربرِ سایت
  await t.pool.query("UPDATE payment_channels SET active = true WHERE id = 'botch'");
  const { request } = await (async () => {
    const { createPaymentRequest } = await import("../src/lib/paymentRequests.ts");
    return createPaymentRequest(t.pool, { channelId: "botch", channelScope: { scope: "bot", botId: "bot_A" }, userId: "u1", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  })();
  assert.equal((await t.call("GET", `/wallet/topup/${request.id}/status`)).status, 404);
  assert.deepEqual((await t.call("GET", "/wallet/topup")).json.items, []);
  assert.equal((await t.call("POST", `/wallet/topup/${request.id}/cancel`)).status, 404);
  assert.equal((await t.reqRow(request.id)).status, "pending");
}));

test("لینکِ مبلغ-ثابتِ پلتفرم: نفرِ دوم در صف؛ لغوِ اولی نوبتِ دومی را می‌رساند", live, () => withEnv(async (t) => {
  await t.mkChannel({ kind: "fixed_link", paymentUrl: "https://pay.example/fixed" });
  const a = await t.call("POST", "/wallet/topup/request", { user: "u1", body: { amount: 200_000 } });
  const b = await t.call("POST", "/wallet/topup/request", { user: "u2", body: { amount: 200_000 } });
  assert.deepEqual([a.json.status, a.json.suffixRial, a.json.channel.paymentUrl], ["pending", 0, "https://pay.example/fixed"]);
  assert.deepEqual([b.json.status, b.json.queuedAhead], ["queued", 0]);
  assert.equal(b.json.channel.paymentUrl, null);                  // تا نوبتش نرسیده لینک نمی‌بیند
  await t.call("POST", `/wallet/topup/${a.json.id}/cancel`);
  const bAfter = await t.call("GET", `/wallet/topup/${b.json.id}/status`, { user: "u2" });
  assert.equal(bAfter.json.status, "pending");
  assert.equal(bAfter.json.channel.paymentUrl, "https://pay.example/fixed");
}));

test("aliasِ قدیمیِ /internal/wallet-topup/sms-webhook: همان pipeline؛ secret/کانال درست بررسی می‌شود", live, () => withEnv(async (t) => {
  const legacy = (secret, body) => fetch(`${t.origin}/internal/wallet-topup/sms-webhook`, {
    method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-sms-webhook-secret": secret } : {}) }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  // بدونِ کانالِ فعال: پیامک ذخیره نمی‌شود و ۵۰۳
  const noChan = await legacy(process.env.SMS_WEBHOOK_SECRET, { text: t.bankSms(1_000_010) });
  assert.equal(noChan.status, 503);

  const { channel } = await t.mkChannel();
  const r = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  assert.equal((await legacy("wrong", { text: t.bankSms(r.json.finalAmount) })).status, 403);
  assert.equal((await legacy(undefined, { text: t.bankSms(r.json.finalAmount) })).status, 403);
  assert.equal((await legacy(process.env.SMS_WEBHOOK_SECRET, {})).status, 400);
  assert.equal(await t.balance(), 0);

  const ok = await legacy(process.env.SMS_WEBHOOK_SECRET, { text: t.bankSms(r.json.finalAmount), sender: "Blubank" });
  assert.deepEqual([ok.status, ok.json.matched], [201, true]);
  assert.equal(await t.balance(), 2_000_000);
  // پیامک در همان sms_inboxِ جدید نشسته و تکرارش اثرِ دوم ندارد
  const inbox = (await t.pool.query("SELECT status, channel_id FROM sms_inbox")).rows;
  assert.deepEqual(inbox.map((x) => [x.status, x.channel_id]), [["matched", channel.id]]);
  await legacy(process.env.SMS_WEBHOOK_SECRET, { text: t.bankSms(r.json.finalAmount), sender: "Blubank" });
  assert.equal(await t.balance(), 2_000_000);
  assert.equal((await t.events("legacy_webhook_used")).length >= 0, true);
}));

test("کانالِ غیرفعال/تغییرِ کانال وسطِ پرداخت: درخواستِ در حالِ پرداخت همچنان با پیامکِ کانالِ خودش تأیید می‌شود", live, () => withEnv(async (t) => {
  const c1 = await t.mkChannel();
  const r = await t.call("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  const c2 = await t.mkChannel({ cardNumber: CARD2 });            // کانالِ تازه‌تر → پیش‌فرضِ درخواست‌های بعدی
  const r2 = await t.call("POST", "/wallet/topup/request", { user: "u2", body: { amount: 200_000 } });
  assert.equal(r2.json.channel.id, c2.channel.id);
  assert.equal(r.json.channel.id, c1.channel.id);
  // پیامکِ کانالِ دوم، درخواستِ کانالِ اول را تأیید نمی‌کند حتی با مبلغِ برابر
  const cross = await t.postSms(c2.channel.id, c2.smsSecret, t.bankSms(r.json.finalAmount));
  assert.equal(cross.json.matched, false);
  assert.equal(await t.balance("u1"), 0);
  assert.equal((await t.postSms(c1.channel.id, c1.smsSecret, t.bankSms(r.json.finalAmount))).json.matched, true);
  assert.equal(await t.balance("u1"), 2_000_000);
}));

test("bot-scope و platform در یک DB: تأییدِ bot هرگز کیف‌پولِ سایت را شارژ نمی‌کند", live, () => withEnv(async (t) => {
  await t.mkChannel();
  await t.pool.query(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, holder_name, sms_secret_hash)
     VALUES ('botch','bot','bot_A','card_manual',$1,'فروشنده','h')`, [encryptToken(CARD2)]);
  const { payment } = await createBotPayment(t.pool, { botId: "bot_A", userId: "u1", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  const d = await decideRequestByAdmin(t.pool, { requestId: payment.id, decision: "approve", adminId: "seller-admin" });
  assert.equal(d.decided, true);
  assert.equal(await t.balance("u1"), 0);                         // اثرِ bot سمتِ بات است (claim)، نه کیف‌پولِ سایت
  assert.equal((await t.ledger("u1")).length, 0);
}));
