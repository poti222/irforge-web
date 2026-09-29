/**
 * test/cardAutoconfirmChecklist.test.mjs — فاز ۹: «چک‌لیست نهاییِ» IRFORGE_CARD_AUTOCONFIRM_PROMPT به‌صورتِ تستِ زنده.
 * هر تست یک بندِ چک‌لیست است و نامش همان بند؛ رویِ Postgresِ واقعی و routeهای واقعیِ HTTP.
 *
 *  ۱ هیچ دو درخواستِ فعال با مبلغِ نهاییِ یکسان روی یک کانال (سطحِ DB، زیرِ بارِ هم‌زمان)
 *  ۲ پیامکِ برداشت یا مبلغِ نادقیق هرگز تأیید نمی‌کند (+ فرستنده‌ی غیرمجاز، secretِ غلط، replay)
 *  ۳ تأییدِ دوباره اثرِ مالیِ تکراری ندارد
 *  ۴ فروشنده A به کانال/پیامک/درخواستِ فروشنده B دسترسی ندارد
 *  ۵ شماره‌کارت و secret رمزنگاری/هش شده‌اند
 *  ۶ مسیرِ فیش + تأییدِ دستی (شمارنده‌ی ۵دقیقه‌ای سمتِ بات: irforge-app)
 *  ۷ همه‌ی مبالغ عدد صحیحِ ریال‌اند
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.PAYMENT_INTERNAL_SECRET = "checklist-internal-secret";
process.env.PUBLIC_SITE_URL = "https://irforge.example";

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { DDL_ALL, SITE_TABLES_DDL } from "./helpers/cardPayDdl.mjs";

const { createPaymentSmsRouter } = await import("../src/routes/paymentSmsWebhook.ts");
const { createInternalBotPaymentsRouter } = await import("../src/routes/internalBotPayments.ts");
const { createWalletTopupRouter } = await import("../src/routes/walletTopup.ts");
const { createBotPaymentChannelsRouter } = await import("../src/routes/botPaymentChannels.ts");
const { createChannel, validateNewChannel, PLATFORM_OWNER } = await import("../src/lib/paymentChannelAdmin.ts");
const { createPaymentRequest } = await import("../src/lib/paymentRequests.ts");
const { matchSms, confirmRequestTx } = await import("../src/lib/paymentMatcher.ts");
const { decideRequestByAdmin } = await import("../src/lib/paymentDecisions.ts");
const { assignSmsToRequest } = await import("../src/lib/paymentAdmin.ts");
const { createPaymentAlerts } = await import("../src/lib/paymentAlerts.ts");
const { registerDefaultPaymentEffects } = await import("../src/lib/paymentEffectsBoot.ts");
registerDefaultPaymentEffects();

const CARD = "6037997000000001";
const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
const INTERNAL = process.env.PAYMENT_INTERNAL_SECRET;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

async function withEnv(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_ck_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 60, options: `-c search_path=${schema}` });
  await pool.query(DDL_ALL);
  await pool.query(SITE_TABLES_DDL);
  await pool.query("INSERT INTO users (id, name, email) VALUES ('u1','علی','a@x.io'),('u2','رضا','b@x.io')");
  await pool.query("INSERT INTO bots (id, user_id, name, sheet_id) VALUES ('bot_A','ownA','A','sheet_A_12345'),('bot_B','ownB','B','sheet_B_12345')");
  const alerts = createPaymentAlerts({});
  const OWN = { ownA: "bot_A", ownB: "bot_B" };
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", createPaymentSmsRouter({ pool, hitFn: okHit, matcher: (p, id) => matchSms(p, id, { alerts }) }));
  app.use("/api", createInternalBotPaymentsRouter({
    pool, hitFn: okHit,
    resolveBot: async (sid) => ({ sheet_A_12345: { botId: "bot_A" }, sheet_B_12345: { botId: "bot_B" } })[sid] ?? null,
  }));
  app.use("/api", createWalletTopupRouter({
    pool, hitFn: okHit, alerts, profile: (_q, _s, n) => n(),
    auth: (req, res, next) => { const u = req.header("x-test-user"); if (!u) { res.status(401).json({}); return; } req.userId = u; next(); },
  }));
  app.use("/api", createBotPaymentChannelsRouter({
    pool, hitFn: okHit, audit: async () => {},
    auth: (req, res, next) => { const u = req.header("x-test-user"); if (!u) { res.status(401).json({}); return; } req.userId = u; next(); },
    resolveBot: async (userId, botId) => { if (OWN[userId] === botId) return { botId }; throw { status: 404, error: "not yours" }; },
  }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const j = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const internal = (sheet, path, body) => j("POST", `/internal/payments${path}`, { body: { spreadsheetId: sheet, ...body }, headers: { "x-payment-internal-secret": INTERNAL } });
  const sms = (channelId, secret, text, extra = {}) => j("POST", `/payments/sms/${channelId}`, {
    body: { text, sender: "Blubank", time: new Date().toISOString(), ...extra }, headers: { "x-sms-secret": secret },
  });
  const seller = (userId, method, path, body) => j(method, `/bots/${OWN[userId]}/payment-channels${path}`, { body, headers: { "x-test-user": userId } });
  const bank = (rial) => `بلو\nواریز پول\n فاطمه عزیز، ${Number(rial).toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;
  const mkBotChannel = async (botOwner) => {
    const out = await j("POST", `/bots/${OWN[botOwner]}/payment-channels`, {
      body: { cardNumber: CARD, holderName: "فروشنده", bankName: "بلو" }, headers: { "x-test-user": botOwner },
    });
    return { id: out.json.channel.id, secret: out.json.smsSecret };
  };
  const mkPlatform = () => createChannel(pool, { owner: PLATFORM_OWNER, maxChannels: 5, fields: validateNewChannel({ cardNumber: CARD, holderName: "سایت", bankName: "بلو" }) });
  try {
    await fn({ pool, j, internal, sms, seller, bank, mkBotChannel, mkPlatform, origin });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test("۱) هیچ دو درخواستِ فعال با مبلغِ نهاییِ یکسان روی یک کانال نیست — ۶۰ درخواستِ هم‌زمان، و insertِ مستقیم هم توسطِ DB رد می‌شود", live, () => withEnv(async (t) => {
  const { channel } = await t.mkPlatform();
  const made = await Promise.all(Array.from({ length: 60 }, (_, i) => createPaymentRequest(t.pool, {
    channelId: channel.id, channelScope: { scope: "platform" }, userId: `u${i}`, purpose: "wallet_topup", baseAmountRial: 2_000_000,
  })));
  const finals = made.filter((m) => m.request.status === "pending").map((m) => m.request.finalAmountRial);
  assert.equal(new Set(finals).size, finals.length, "مبلغِ نهاییِ تکراری بینِ pendingها");
  assert.ok(finals.every((f) => f > 2_000_000 && f <= 2_009_990 && f % 10 === 0));
  const dup = await t.pool.query(
    `SELECT channel_id, final_amount_rial, COUNT(*) FROM payment_requests WHERE status IN ('pending','awaiting_review')
      GROUP BY 1, 2 HAVING COUNT(*) > 1`);
  assert.equal(dup.rows.length, 0);
  // دورزدنِ اپلیکیشن: خودِ DB رد می‌کند
  await assert.rejects(() => t.pool.query(
    `INSERT INTO payment_requests (id, channel_id, channel_kind, scope, user_id, purpose, base_amount_rial, suffix_rial, final_amount_rial, status, expires_at)
     VALUES ('pr_dup', $1, 'card_manual', 'platform', 'x', 'wallet_topup', 2000000, $2, $3, 'pending', NOW() + interval '5 minutes')`,
    [channel.id, finals[0] - 2_000_000, finals[0]]), (e) => e.code === "23505");
}));

test("۲) برداشت، مبلغِ نادقیق، فرستنده‌ی غیرمجاز، secretِ غلط و replay هرگز شارژ نمی‌کنند", live, () => withEnv(async (t) => {
  const { channel } = await t.mkPlatform();
  await t.pool.query("UPDATE payment_channels SET sender_allowlist = ARRAY['Blubank'] WHERE id = $1", [channel.id]);
  const secret = "irfsms_known_secret_for_test";
  const { hashSmsSecret } = await import("../src/lib/smsChannelSecret.ts");
  await t.pool.query("UPDATE payment_channels SET sms_secret_hash = $2 WHERE id = $1", [channel.id, hashSmsSecret(secret)]);
  const r = await t.j("POST", "/wallet/topup/request", { body: { amount: 200_000 }, headers: { "x-test-user": "u1" } });
  const final = r.json.finalAmount;
  const bal = async () => Number((await t.pool.query("SELECT COALESCE(SUM(balance),0) AS b FROM wallets")).rows[0].b);
  const bad = [
    t.bank(final + 10), t.bank(final - 10), t.bank(final + 1000), t.bank(Math.round(final / 10)),        // مبلغ نادقیق (حتی تومان به‌جای ریال)
    `بلو\nبرداشت\n ${final.toLocaleString("en-US")} ریال از حساب شما کسر شد.`,                              // برداشت با همان مبلغ
    `واریز ${final} ریال`.replace(String(final), "abc"),                                                   // نامفهوم
  ];
  for (const text of bad) assert.equal((await t.sms(channel.id, secret, text)).json.matched, false, text.slice(0, 40));
  assert.equal((await t.sms(channel.id, secret, t.bank(final), { sender: "Evil" })).json.matched, false);        // فرستنده‌ی غیرمجاز
  assert.equal((await t.sms(channel.id, "irfsms_wrong", t.bank(final))).status, 401);                           // secret غلط
  assert.equal((await t.sms("pch_doesnotexist", secret, t.bank(final))).status, 401);                            // کانالِ ناموجود = همان ۴۰۱
  assert.equal(await bal(), 0);
  // مبلغِ درست → یک‌بار؛ replay (همان پیامک و نسخه‌ی بی‌زمان) → اثرِ دوم ندارد
  const T = new Date().toISOString();
  const good = await t.sms(channel.id, secret, t.bank(final), { time: T });
  assert.equal(good.json.matched, true);
  for (let i = 0; i < 5; i++) await t.sms(channel.id, secret, t.bank(final), { time: T });
  await t.sms(channel.id, secret, t.bank(final));
  assert.equal(await bal(), 2_000_000);
}));

test("۳) تأییدِ دوباره اثرِ مالیِ تکراری ندارد — SMS، تأییدِ ادمین، تخصیصِ دستی و confirmRequestTx هم‌زمان", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkPlatform();
  const r = await t.j("POST", "/wallet/topup/request", { body: { amount: 300_000 }, headers: { "x-test-user": "u1" } });
  const id = r.json.id, final = r.json.finalAmount;
  const early = new Date(Date.now() - 10 * 60_000).toISOString();
  await t.sms(channel.id, smsSecret, t.bank(final), { time: early });                     // unmatched (قبل از پنجره)
  const smsId = (await t.pool.query("SELECT id FROM sms_inbox WHERE status = 'unmatched'")).rows[0].id;
  const attempts = [
    decideRequestByAdmin(t.pool, { requestId: id, decision: "approve", adminId: "a1" }),
    decideRequestByAdmin(t.pool, { requestId: id, decision: "approve", adminId: "a2" }),
    assignSmsToRequest(t.pool, { smsId, requestId: id, adminId: "a3" }),
    t.sms(channel.id, smsSecret, t.bank(final)),
    t.sms(channel.id, smsSecret, t.bank(final)),
  ];
  await Promise.allSettled(attempts);
  const ledger = (await t.pool.query("SELECT amount FROM wallet_transactions WHERE user_id = 'u1'")).rows;
  assert.equal(ledger.length, 1, `credit ${ledger.length}×`);
  const st = (await t.pool.query("SELECT status FROM payment_requests WHERE id = $1", [id])).rows[0].status;
  assert.equal(st, "confirmed");
  // همه‌ی مسیرهای تأیید effect را داخلِ همان تراکنش اجرا می‌کنند: مجموعِ شارژ دقیقاً base — هرگز صفر، هرگز دوبرابر.
  const bal = Number((await t.pool.query("SELECT COALESCE(SUM(balance),0) AS b FROM wallets WHERE user_id = 'u1'")).rows[0].b);
  assert.equal(bal, 3_000_000);
}));

test("۴) فروشنده A به کانال/پیامک/درخواستِ فروشنده B دسترسی ندارد (پنلِ فروشنده، APIِ داخلیِ بات، وبهوک)", live, () => withEnv(async (t) => {
  const A = await t.mkBotChannel("ownA");
  const B = await t.mkBotChannel("ownB");
  // پنل: A کانالِ B را نه می‌بیند نه تغییر می‌دهد
  for (const [m, p, body] of [["PATCH", `/${B.id}`, { holderName: "x" }], ["POST", `/${B.id}/rotate-secret`], ["POST", `/${B.id}/test-sms`], ["DELETE", `/${B.id}`], ["GET", `/${B.id}/sms-log`]]) {
    const r = await t.seller("ownA", m, p, body);
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  const listA = await t.seller("ownA", "GET", "");
  assert.deepEqual(listA.json.channels.map((c) => c.id), [A.id]);
  // API داخلی: مشتریِ A یک درخواست می‌سازد؛ tenant B نه get می‌کند، نه cancel/receipt/claim
  const created = await t.internal("sheet_A_12345", "/requests/create", { userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const rid = created.json.payment.id;
  for (const path of ["/requests/get", "/requests/cancel"]) {
    const r = await t.internal("sheet_B_12345", path, { requestId: rid, userId: "1001" });
    assert.ok([403, 404].includes(r.status), `${path} → ${r.status}`);
  }
  // درخواستِ A تأیید می‌شود؛ tenant B هرگز اثرش را claim/done نمی‌کند، A می‌کند (یک‌بار)
  await decideRequestByAdmin(t.pool, { requestId: rid, decision: "approve", adminId: "seller-admin" });
  const bClaim = await t.internal("sheet_B_12345", "/requests/claim", { requestId: rid });
  assert.notEqual(bClaim.json?.claimed, true);
  const bDone = await t.internal("sheet_B_12345", "/requests/effect-done", { requestId: rid });
  assert.notEqual(bDone.json?.done, true);
  assert.equal((await t.pool.query("SELECT effect_claimed_at FROM payment_requests WHERE id = $1", [rid])).rows[0].effect_claimed_at, null);
  assert.equal((await t.internal("sheet_A_12345", "/requests/claim", { requestId: rid })).json.claimed, true);
  assert.equal((await t.internal("sheet_A_12345", "/requests/claim", { requestId: rid })).json.claimed, false);
  assert.equal((await t.internal("sheet_B_12345", "/requests/create", { userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000, channelId: A.id })).status >= 400, true);
  assert.equal((await t.internal("sheet_A_12345", "/requests/get", { requestId: rid, userId: "1001" })).status, 200);
  // وبهوک: secretِ B روی کانالِ A و برعکس → ۴۰۱؛ پیامکِ A هرگز درخواستِ B را تأیید نمی‌کند
  assert.equal((await t.sms(A.id, B.secret, t.bank(created.json.payment.finalAmountRial))).status, 401);
  const forB = await t.internal("sheet_B_12345", "/requests/create", { userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  assert.equal((await t.sms(A.id, A.secret, t.bank(forB.json.payment.finalAmountRial))).json.matched, false);
  assert.equal((await t.pool.query("SELECT status FROM payment_requests WHERE id = $1", [forB.json.payment.id])).rows[0].status, "pending");
  // وبهوکِ کانالِ فروشنده با کیف‌پولِ پلتفرم بی‌ارتباط است
  await t.mkPlatform();
  assert.equal((await t.pool.query("SELECT COUNT(*)::int AS n FROM wallet_transactions")).rows[0].n, 0);
}));

test("۵) شماره‌کارت رمزنگاری و secret فقط هش‌شده است (DB و پاسخ‌ها)", live, () => withEnv(async (t) => {
  const made = await t.j("POST", "/bots/bot_A/payment-channels", {
    body: { cardNumber: "6037-9970-0000-0001", holderName: "فروشنده", bankName: "بلو" }, headers: { "x-test-user": "ownA" },
  });
  const secret = made.json.smsSecret;
  const row = (await t.pool.query("SELECT * FROM payment_channels WHERE id = $1", [made.json.channel.id])).rows[0];
  assert.match(row.card_number_enc, /^[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+$/);            // iv:tag:ciphertext
  assert.ok(!row.card_number_enc.includes(CARD) && !row.card_number_enc.includes("6037"));
  assert.match(row.sms_secret_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.sms_secret_hash, secret);
  assert.ok(!JSON.stringify(row).includes(secret));
  const dump = JSON.stringify((await t.pool.query("SELECT * FROM payment_events")).rows) + JSON.stringify((await t.pool.query("SELECT * FROM payment_requests")).rows);
  assert.ok(!dump.includes(CARD) && !dump.includes(secret));
  // هیچ پاسخِ لیست/GET شماره‌ی کامل نمی‌دهد
  const list = await t.j("GET", "/bots/bot_A/payment-channels", { headers: { "x-test-user": "ownA" } });
  assert.ok(!JSON.stringify(list.json).includes(CARD) && !JSON.stringify(list.json).includes(secret));
  // ذخیره‌ی plaintextِ دستی هرگز به مشتری نمایش داده نمی‌شود
  await t.pool.query("UPDATE payment_channels SET card_number_enc = $2 WHERE id = $1", [made.json.channel.id, CARD]);
  const created = await t.internal("sheet_A_12345", "/requests/create", { userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  assert.notEqual(created.status, 201);
  assert.ok(!JSON.stringify(created.json).includes(CARD));
}));

test("۶) مسیرِ فیش + تأییدِ دستی (سایت): فیش → awaiting_review → ادمین؛ قبل از تصمیم پیامک هنوز می‌تواند تأیید کند", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkPlatform();
  const a = await t.j("POST", "/wallet/topup/request", { body: { amount: 200_000 }, headers: { "x-test-user": "u1" } });
  const up = await t.j("POST", `/wallet/topup/${a.json.id}/receipt`, { body: { receiptUrl: PNG }, headers: { "x-test-user": "u1" } });
  assert.equal(up.json.status, "awaiting_review");
  // پیامکِ دیررسیدِ همان مبلغ روی awaiting_review هم تأیید می‌کند (بدونِ سقفِ بالایِ زمان)
  const sm = await t.sms(channel.id, smsSecret, t.bank(a.json.finalAmount));
  assert.equal(sm.json.matched, true);
  // نفرِ دوم: فیش + تأییدِ دستی
  const b = await t.j("POST", "/wallet/topup/request", { body: { amount: 100_000 }, headers: { "x-test-user": "u2" } });
  await t.j("POST", `/wallet/topup/${b.json.id}/receipt`, { body: { receiptUrl: PNG }, headers: { "x-test-user": "u2" } });
  const d = await decideRequestByAdmin(t.pool, { requestId: b.json.id, decision: "approve", adminId: "root" });
  assert.equal(d.decided, true);
  assert.deepEqual((await t.pool.query("SELECT user_id, balance FROM wallets ORDER BY user_id")).rows.map((x) => [x.user_id, Number(x.balance)]),
    [["u1", 2_000_000], ["u2", 1_000_000]]);
}));

test("۷) همه‌ی مبالغ عدد صحیحِ ریال‌اند: ستون‌ها bigint/integer، پاسخ‌ها عددِ صحیح، اعشار رد می‌شود", live, () => withEnv(async (t) => {
  const cols = (await t.pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name ~ '(amount|_rial|balance|suffix)$'
        AND table_name IN ('payment_channels','payment_requests','sms_inbox')`)).rows;
  assert.ok(cols.length >= 6);
  for (const c of cols) assert.equal(c.data_type, "bigint", `${c.table_name}.${c.column_name}`);
  const floats = (await t.pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name IN ('payment_channels','payment_requests','sms_inbox') AND data_type IN ('real','double precision','numeric')`)).rows[0].n;
  assert.equal(floats, 0);
  await t.mkPlatform();
  for (const bad of [200_000.5, "200000.5", 1e21, -1, NaN]) {
    assert.equal((await t.j("POST", "/wallet/topup/request", { body: { amount: bad }, headers: { "x-test-user": "u1" } })).status, 400, String(bad));
  }
  const ok = await t.j("POST", "/wallet/topup/request", { body: { amount: 200_000 }, headers: { "x-test-user": "u1" } });
  for (const k of ["requestedAmount", "suffixRial", "finalAmount"]) assert.ok(Number.isInteger(ok.json[k]), k);
  assert.equal(ok.json.finalAmount, 2_000_000 + ok.json.suffixRial);
  // مبلغِ اعشاریِ ریال در سطحِ DB هم ممکن نیست
  await assert.rejects(() => t.pool.query(
    "UPDATE payment_requests SET final_amount_rial = 2000000.5 WHERE id = $1", [ok.json.id]), (e) => ["22P02", "23514", "42804"].includes(e.code) || /invalid input|check constraint/.test(e.message));
}));
