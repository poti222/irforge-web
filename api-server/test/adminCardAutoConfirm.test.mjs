/**
 * test/adminCardAutoConfirm.test.mjs — فاز ۸/۹: پنلِ مدیریتِ سوپرادمین برایِ «کارت‌به‌کارت خودکار»
 * (`routes/adminCardAutoConfirm.ts` + `lib/paymentAdmin.ts`).
 *
 * معیار: فقط سوپرادمین؛ هیچ راز/شماره‌کارتِ کامل/متنِ خامِ پیامک بیرون نمی‌آید؛ تأیید/ردِ دستی و تخصیصِ پیامک همان مسیرِ امنِ
 * موتورِ خودکارند (اولین تصمیم برنده، اثرِ مالی یک‌بار)؛ خاموشیِ اضطراریِ کانال؛ همه‌ی نوشتن‌ها audit می‌شوند.
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.PUBLIC_SITE_URL = "https://irforge.example";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { DDL_ALL, SITE_TABLES_DDL } from "./helpers/cardPayDdl.mjs";

const { createAdminCardAutoConfirmRouter } = await import("../src/routes/adminCardAutoConfirm.ts");
const { createWalletTopupRouter } = await import("../src/routes/walletTopup.ts");
const { createPaymentSmsRouter } = await import("../src/routes/paymentSmsWebhook.ts");
const { createChannel, validateNewChannel, PLATFORM_OWNER } = await import("../src/lib/paymentChannelAdmin.ts");
const { matchSms } = await import("../src/lib/paymentMatcher.ts");
const { createPaymentAlerts } = await import("../src/lib/paymentAlerts.ts");
const { logPaymentEvent } = await import("../src/lib/paymentEvents.ts");
const { createBotPayment } = await import("../src/lib/paymentBotApi.ts");
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");
const { hashSmsSecret } = await import("../src/lib/smsChannelSecret.ts");
const { registerDefaultPaymentEffects } = await import("../src/lib/paymentEffectsBoot.ts");
registerDefaultPaymentEffects();

const CARD = "6037997000000001";
const CARD2 = "6104337000000008";
const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

async function withEnv(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_a9_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 40, options: `-c search_path=${schema}` });
  await pool.query(DDL_ALL);
  await pool.query(SITE_TABLES_DDL);
  await pool.query("INSERT INTO users (id, name, email) VALUES ('u1','علی','ali@x.io'),('u2','رضا','reza@x.io'),('own_A','فروشنده A','sellerA@x.io')");
  await pool.query("INSERT INTO bots (id, user_id, name, sheet_id) VALUES ('bot_A','own_A','فروشگاه A','sheet_A_12345')");

  const audits = [];
  const userNotes = [];
  const adminNotes = [];
  const notifiers = {
    record: (ev) => logPaymentEvent(pool, ev),
    notifyPlatformUser: async (userId, m) => { userNotes.push({ userId, ...m }); },
    notifyAdmins: async (m) => { adminNotes.push(m); },
    notifyBotOwner: async (botId, m) => { adminNotes.push({ botId, ...m }); },
  };
  const alerts = createPaymentAlerts(notifiers);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", createAdminCardAutoConfirmRouter({
    pool, hitFn: okHit, notifiers,
    superAdmin: (req, res, next) => {
      if (req.header("x-test-super") !== "1") { res.status(403).json({ error: "Super admin only" }); return; }
      req.userId = req.header("x-test-admin") || "root";
      next();
    },
    audit: async (a) => { audits.push(a); },
  }));
  app.use("/api", createWalletTopupRouter({
    pool, hitFn: okHit, alerts, profile: (_q, _s, n) => n(), notifyAdmins: async (m) => { adminNotes.push(m); },
    auth: (req, res, next) => { const u = req.header("x-test-user"); if (!u) { res.status(401).json({}); return; } req.userId = u; next(); },
  }));
  app.use("/api", createPaymentSmsRouter({ pool, hitFn: okHit, matcher: (p, id) => matchSms(p, id, { alerts }) }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}/api`;

  const admin_ = async (method, path, { body, admin: as = true, adminId } = {}) => {
    const res = await fetch(`${origin}/admin/card-autoconfirm${path}`, {
      method,
      headers: { "content-type": "application/json", ...(as ? { "x-test-super": "1" } : {}), ...(adminId ? { "x-test-admin": adminId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const user = async (method, path, { body, user: u = "u1" } = {}) => {
    const res = await fetch(`${origin}${path}`, {
      method, headers: { "content-type": "application/json", "x-test-user": u }, body: body === undefined ? undefined : JSON.stringify(body),
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
  const mkPlatform = (fields = {}) => createChannel(pool, {
    owner: PLATFORM_OWNER, maxChannels: 5,
    fields: validateNewChannel({ cardNumber: CARD, holderName: "صاحبِ سایت", bankName: "بلو", ...fields }),
  });
  const mkBotChannel = async (id = "botch", card = CARD2) => {
    await pool.query(
      `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, holder_name, bank_name, sms_secret_hash, min_amount_rial)
       VALUES ($1,'bot','bot_A','card_manual',$2,'فروشنده','ملت',$3,1000000)`, [id, encryptToken(card), hashSmsSecret(`secret-${id}`)]);
    return { id, secret: `secret-${id}` };
  };
  const balance = async (uid = "u1") => Number((await pool.query("SELECT balance FROM wallets WHERE user_id = $1", [uid])).rows[0]?.balance ?? 0);
  const events = async (kind) => (await pool.query("SELECT * FROM payment_events WHERE kind = $1", [kind])).rows;
  const bankSms = (rial) => `بلو\nواریز پول\n فاطمه عزیز، ${Number(rial).toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;
  try {
    await fn({ pool, admin: admin_, user, postSms, mkPlatform, mkBotChannel, balance, events, bankSms, audits, userNotes, adminNotes, origin });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

// ─── ایستا ──────────────────────────────────────────────────────────────────

test("هر route ی فایلِ ادمین پشتِ superAdmin و نوشتن‌ها پشتِ blockWhileImpersonating + rate-limit است", () => {
  const src = fs.readFileSync(new URL("../src/routes/adminCardAutoConfirm.ts", import.meta.url), "utf8");
  assert.equal((src.match(/router(\.(get|post|patch|delete|put)|\[method\])\(/g) ?? []).length, 2, "route مستقیم ثبت شده؛ باید از get()/write() عبور کند");
  assert.match(src, /router\.get\(`\$\{base\}\$\{path\}`, superAdmin,/);
  assert.match(src, /superAdmin, blockWhileImpersonating, writeLimit,/);
  const gets = (src.match(/^\s*get\("/gm) ?? []).length, writes = (src.match(/^\s*write\("/gm) ?? []).length;
  assert.ok(gets >= 8 && writes >= 8, `${gets} get / ${writes} write`);
});

// ─── زنده ───────────────────────────────────────────────────────────────────

test("فقط سوپرادمین: همه‌ی endpointها بدونِ آن ۴۰۳ می‌دهند", live, () => withEnv(async (t) => {
  const paths = [
    ["GET", "/overview"], ["GET", "/channels"], ["POST", "/channels/x/active"], ["GET", "/platform-channels"], ["POST", "/platform-channels"],
    ["PATCH", "/platform-channels/x"], ["DELETE", "/platform-channels/x"], ["POST", "/platform-channels/x/rotate-secret"],
    ["POST", "/platform-channels/x/test-sms"], ["GET", "/platform-channels/x/sms-log"], ["GET", "/requests"], ["GET", "/requests/x"],
    ["GET", "/requests/x/receipt"], ["POST", "/requests/x/decide"], ["GET", "/sms"], ["POST", "/sms/x/assign"], ["GET", "/events"],
    ["POST", "/sweep"], ["POST", "/migration/run"],
  ];
  for (const [m, p] of paths) {
    const r = await t.admin(m, p, { admin: false, body: m === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal(t.audits.length, 0);
}));

test("کانال‌های پلتفرم: ساخت (secret یک‌بار) → لیست بدونِ راز → rotate کلیدِ قبلی را می‌کشد → test-sms سلامت را جعل نمی‌کند → حذف/سقف", live, () => withEnv(async (t) => {
  const made = await t.admin("POST", "/platform-channels", { body: { cardNumber: "6037 9970 0000 0001", holderName: "صاحبِ سایت", bankName: "بلو" } });
  assert.equal(made.status, 201);
  const { channel, smsSecret } = made.json;
  assert.ok(smsSecret.startsWith("irfsms_"));
  assert.equal(channel.cardMasked, "6037-****-****-0001");
  assert.equal(channel.webhookUrl, `https://irforge.example/api/payments/sms/${channel.id}`);
  assert.equal(channel.health.status, "never");

  const list = await t.admin("GET", "/platform-channels");
  assert.equal(list.json.channels.length, 1);
  assert.equal(list.json.legacyWebhookEnabled, false);
  const blob = JSON.stringify(list.json);
  assert.ok(!blob.includes(smsSecret) && !blob.includes(CARD));

  // secret درست کار می‌کند، بعد از rotate نه
  assert.equal((await t.postSms(channel.id, smsSecret, t.bankSms(1_234_560))).status, 201);
  const rot = await t.admin("POST", `/platform-channels/${channel.id}/rotate-secret`);
  assert.equal(rot.status, 200);
  assert.notEqual(rot.json.smsSecret, smsSecret);
  assert.equal(rot.json.channel.cardMasked, "6037-****-****-0001");        // تنظیمات دست‌نخورده
  assert.equal((await t.postSms(channel.id, smsSecret, t.bankSms(2_234_560))).status, 401);
  assert.equal((await t.postSms(channel.id, rot.json.smsSecret, t.bankSms(2_234_560))).status, 201);

  // پیامکِ آزمایشی: پارس می‌شود ولی lastSmsAt را جلو نمی‌برد
  await t.pool.query("UPDATE payment_channels SET last_sms_at = NULL WHERE id = $1", [channel.id]);
  const test = await t.admin("POST", `/platform-channels/${channel.id}/test-sms`);
  assert.equal(test.json.result.matchesExpected, true);
  assert.equal((await t.pool.query("SELECT last_sms_at FROM payment_channels WHERE id = $1", [channel.id])).rows[0].last_sms_at, null);
  const log = await t.admin("GET", `/platform-channels/${channel.id}/sms-log`);
  assert.equal(log.json.entries.some((e) => e.isTest), true);

  // ویرایش (کارتِ نو) + سقفِ ۵
  const upd = await t.admin("PATCH", `/platform-channels/${channel.id}`, { body: { cardNumber: CARD2, minAmountToman: 200_000 } });
  assert.equal(upd.json.channel.cardMasked, "6104-****-****-0008");
  assert.equal(upd.json.channel.minAmountToman, 200_000);
  for (let i = 0; i < 4; i++) assert.equal((await t.admin("POST", "/platform-channels", { body: { cardNumber: CARD, holderName: `x${i}` } })).status, 201);
  const over = await t.admin("POST", "/platform-channels", { body: { cardNumber: CARD, holderName: "y" } });
  assert.deepEqual([over.status, over.json.code], [409, "channel_limit"]);
  // حذف: کانالِ بدونِ سابقه می‌رود، کانالِ دارایِ پیامکِ واقعی نه
  const fresh = (await t.admin("GET", "/platform-channels")).json.channels.find((c) => c.id !== channel.id);
  assert.equal((await t.admin("DELETE", `/platform-channels/${fresh.id}`)).status, 200);
  const del = await t.admin("DELETE", `/platform-channels/${channel.id}`);
  assert.deepEqual([del.status, del.json.code], [409, "channel_has_history"]);
  // ممیزی و لاگ
  assert.ok(t.audits.some((a) => a.action === "payment_channel_created" && a.metadata.scope === "platform"));
  assert.ok(t.audits.some((a) => a.action === "payment_channel_secret_rotated"));
  assert.ok((await t.events("channel_secret_rotated")).length === 1);
  // کانالِ bot از این API دیده/ویرایش نمی‌شود
  await t.mkBotChannel();
  assert.equal((await t.admin("PATCH", "/platform-channels/botch", { body: { holderName: "hack" } })).status, 404);
  assert.equal((await t.admin("POST", "/platform-channels/botch/rotate-secret")).status, 404);
  assert.equal((await t.admin("DELETE", "/platform-channels/botch")).status, 404);
}));

test("نمای کلی و فهرستِ همه‌ی کانال‌ها: بات و پلتفرم، ماسکِ کارت، سلامتِ گوشی، شمارنده‌ها", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkPlatform();
  const bot = await t.mkBotChannel();
  const r1 = await t.user("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  await t.postSms(channel.id, smsSecret, t.bankSms(r1.json.finalAmount));
  await t.user("POST", "/wallet/topup/request", { user: "u2", body: { amount: 100_000 } });                     // باز
  const { payment } = await createBotPayment(t.pool, { botId: "bot_A", userId: "cust1", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  await t.pool.query("UPDATE payment_channels SET last_sms_at = NOW() - interval '30 hours' WHERE id = $1", [bot.id]);   // گوشیِ فروشنده ساکت

  const ov = (await t.admin("GET", "/overview")).json;
  assert.deepEqual([ov.open.platform.pending, ov.open.bot.pending], [1, 1]);
  assert.deepEqual([ov.last24h.created, ov.last24h.confirmed, ov.last24h.confirmedBySms], [3, 1, 1]);
  assert.equal(ov.last24h.confirmedAmountToman, 200_000);
  assert.deepEqual([ov.channels.total, ov.channels.platform, ov.channels.bot], [2, 1, 1]);
  assert.equal(ov.channels.silent, 1);
  assert.equal(ov.sms24h.matched, 1);
  assert.ok(ov.attention.problemEvents24h >= 0);

  const ch = (await t.admin("GET", "/channels")).json.channels;
  assert.equal(ch[0].scope, "platform");                                          // پلتفرم اول
  const b = ch.find((c) => c.id === bot.id);
  assert.deepEqual([b.botName, b.ownerEmail, b.cardMasked, b.health.status], ["فروشگاه A", "sellerA@x.io", "6104-****-****-0008", "stale"]);
  assert.equal(b.counts.open, 1);
  assert.ok(!JSON.stringify(ch).includes(CARD) && !JSON.stringify(ch).includes(CARD2) && !JSON.stringify(ch).includes("secret-botch"));
  assert.equal((await t.admin("GET", "/channels?silent=1")).json.channels.length, 1);
  assert.equal((await t.admin("GET", "/channels?scope=bot")).json.channels.length, 1);
  assert.equal((await t.admin("GET", "/channels?q=sellerA")).json.channels.length, 1);
  assert.equal((await t.admin("GET", "/channels?q=%25")).json.channels.length, 0);   // wildcard escape می‌شود
  void payment;
}));

test("خاموشیِ اضطراریِ هر کانال: درخواستِ جدید رد می‌شود، برگشت‌پذیر، ثبت در audit و لاگ", live, () => withEnv(async (t) => {
  await t.mkBotChannel();
  const off = await t.admin("POST", "/channels/botch/active", { body: { active: false, reason: "کلاهبرداری" } });
  assert.deepEqual([off.status, off.json.active, off.json.scope], [200, false, "bot"]);
  await assert.rejects(() => createBotPayment(t.pool, { botId: "bot_A", userId: "c", purpose: "wallet_topup", baseAmountRial: 2_000_000 }), /no_channel|فعال/);
  assert.equal((await t.admin("POST", "/channels/botch/active", { body: { active: "yes" } })).status, 400);
  assert.equal((await t.admin("POST", "/channels/nope/active", { body: { active: true } })).status, 404);
  assert.equal((await t.admin("POST", "/channels/botch/active", { body: { active: true } })).json.active, true);
  await createBotPayment(t.pool, { botId: "bot_A", userId: "c", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  assert.equal((await t.events("channel_disabled_by_admin")).length, 1);
  assert.equal(t.audits.filter((a) => a.action === "card_autoconfirm_channel_active").length, 2);
}));

test("درخواست‌ها: فیلتر/جستجو/جزئیات/فیش؛ ماسکِ کارت؛ فیشِ bot فقط file_id", live, () => withEnv(async (t) => {
  const { channel } = await t.mkPlatform();
  const bot = await t.mkBotChannel();
  const a = await t.user("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  await t.user("POST", `/wallet/topup/${a.json.id}/receipt`, { body: { receiptUrl: PNG } });
  const b = await t.user("POST", "/wallet/topup/request", { user: "u2", body: { amount: 300_000 } });
  const { payment } = await createBotPayment(t.pool, { botId: "bot_A", userId: "cust1", purpose: "order", orderId: "ORD1", baseAmountRial: 2_500_000 });
  await t.pool.query("UPDATE payment_requests SET receipt_file_id = 'AgACtelegramfileid', receipt_uploaded_at = NOW(), status = 'awaiting_review' WHERE id = $1", [payment.id]);

  const all = (await t.admin("GET", "/requests")).json.requests;
  assert.equal(all.length, 3);
  const row = all.find((x) => x.id === a.json.id);
  assert.deepEqual([row.scope, row.userName, row.userEmail, row.status, row.hasReceipt, row.baseAmountToman, row.cardMasked],
    ["platform", "علی", "ali@x.io", "awaiting_review", true, 200_000, "6037-****-****-0001"]);
  const brow = all.find((x) => x.id === payment.id);
  assert.deepEqual([brow.scope, brow.botName, brow.orderId, brow.cardMasked], ["bot", "فروشگاه A", "ORD1", "6104-****-****-0008"]);
  assert.equal(JSON.stringify(all).includes(PNG), false, "فیشِ base64 در لیست نمی‌آید");
  assert.equal((await t.admin("GET", "/requests?scope=bot")).json.requests.length, 1);
  assert.equal((await t.admin("GET", "/requests?status=open")).json.requests.length, 3);
  assert.equal((await t.admin("GET", "/requests?status=awaiting_review")).json.requests.length, 2);
  assert.equal((await t.admin("GET", `/requests?q=${encodeURIComponent("reza@")}`)).json.requests[0].id, b.json.id);
  assert.equal((await t.admin("GET", `/requests?q=ORD1`)).json.requests.length, 1);
  assert.equal((await t.admin("GET", `/requests?q=${b.json.finalAmount}`)).json.requests[0].id, b.json.id);
  assert.equal((await t.admin("GET", `/requests?channelId=${channel.id}`)).json.requests.length, 2);
  assert.equal((await t.admin("GET", "/requests?limit=1")).json.requests.length, 1);

  const det = (await t.admin("GET", `/requests/${a.json.id}`)).json;
  assert.equal(det.request.id, a.json.id);
  assert.equal(det.channel.cardMasked, "6037-****-****-0001");
  assert.ok(det.events.some((e) => e.kind === "receipt_uploaded"));
  assert.ok(!JSON.stringify(det).includes(CARD));
  assert.equal((await t.admin("GET", "/requests/nope")).status, 404);

  const rc = (await t.admin("GET", `/requests/${a.json.id}/receipt`)).json;
  assert.deepEqual([rc.kind, rc.value], ["image", PNG]);
  const rb = (await t.admin("GET", `/requests/${payment.id}/receipt`)).json;
  assert.deepEqual([rb.kind, rb.value], ["telegram_file_id", null]);
  assert.equal((await t.admin("GET", `/requests/${b.json.id}/receipt`)).json.kind, "none");
  assert.equal((await t.admin("GET", "/requests/nope/receipt")).status, 404);
  void bot;
}));

test("تأیید/ردِ دستی: platform کیف‌پول را یک‌بار شارژ می‌کند و کاربر خبردار می‌شود؛ دو ادمینِ هم‌زمان → یک تصمیم؛ bot فقط وضعیت", live, () => withEnv(async (t) => {
  await t.mkPlatform();
  const a = await t.user("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  const [x, y] = await Promise.all([
    t.admin("POST", `/requests/${a.json.id}/decide`, { body: { decision: "approve" }, adminId: "adm1" }),
    t.admin("POST", `/requests/${a.json.id}/decide`, { body: { decision: "approve" }, adminId: "adm2" }),
  ]);
  assert.deepEqual([x.status, y.status], [200, 200]);
  assert.deepEqual([x.json.decided, y.json.decided].sort(), [false, true]);
  assert.equal(await t.balance(), 2_000_000);
  assert.equal((await t.pool.query("SELECT COUNT(*)::int AS n FROM wallet_transactions WHERE user_id = 'u1'")).rows[0].n, 1);
  assert.equal(t.userNotes.length, 1);
  assert.equal(t.audits.filter((x2) => x2.action === "card_autoconfirm_decision").length, 1);
  // ردِ بعدی اثری ندارد (اولین تصمیم برنده)
  const late = await t.admin("POST", `/requests/${a.json.id}/decide`, { body: { decision: "reject", reason: "دیر" } });
  assert.equal(late.json.decided, false);
  assert.equal(late.json.request.status, "confirmed");

  // رد با دلیل → هیچ شارژی؛ دلیل به کاربر می‌رسد
  const b = await t.user("POST", "/wallet/topup/request", { user: "u2", body: { amount: 100_000 } });
  const rej = await t.admin("POST", `/requests/${b.json.id}/decide`, { body: { decision: "reject", reason: "فیش جعلی" } });
  assert.deepEqual([rej.json.decided, rej.json.request.status], [true, "rejected"]);
  assert.equal(await t.balance("u2"), 0);
  assert.equal((await t.user("GET", `/wallet/topup/${b.json.id}/status`, { user: "u2" })).json.rejectReason, "فیش جعلی");
  assert.equal((await t.events("rejected_by_admin")).length, 1);
  assert.equal((await t.admin("POST", `/requests/${b.json.id}/decide`, { body: { decision: "maybe" } })).status, 400);
  assert.equal((await t.admin("POST", "/requests/nope/decide", { body: { decision: "approve" } })).status, 404);

  // bot-scope: تأییدِ سایت فقط وضعیت است؛ اثرِ تجاری را بات با claim برمی‌دارد
  await t.mkBotChannel();
  const { payment } = await createBotPayment(t.pool, { botId: "bot_A", userId: "cust1", purpose: "wallet_topup", baseAmountRial: 2_000_000 });
  const d = await t.admin("POST", `/requests/${payment.id}/decide`, { body: { decision: "approve" } });
  assert.equal(d.json.decided, true);
  const row = (await t.pool.query("SELECT status, effect_claimed_at FROM payment_requests WHERE id = $1", [payment.id])).rows[0];
  assert.deepEqual([row.status, row.effect_claimed_at], ["confirmed", null]);
  assert.equal(await t.balance("cust1"), 0);
}));

test("تخصیصِ دستیِ پیامک: مبلغِ دقیق، همان کانال، یک‌بار؛ ناسازگار → ۴۰۹ و هیچ اثری", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkPlatform();
  const c2 = await t.mkPlatform({ cardNumber: CARD2 });
  // پیامکی که ۱۰ دقیقه پیش از ساختِ درخواست رسیده → موتورِ خودکار نمی‌تواند match کند (پنجره‌ی -۲ دقیقه)
  const r = await t.user("POST", "/wallet/topup/request", { body: { amount: 200_000, channelId: channel.id } });
  const early = new Date(Date.now() - 10 * 60_000).toISOString();
  const sent = await t.postSms(channel.id, smsSecret, t.bankSms(r.json.finalAmount), { time: early });
  assert.equal(sent.json.matched, false);
  const sms = (await t.admin("GET", "/sms?status=attention")).json.sms;
  assert.equal(sms.length, 1);
  assert.equal(sms[0].amountToman, Math.round(r.json.finalAmount / 10));
  assert.ok(!JSON.stringify(sms).includes("فاطمه عزیز") || sms[0].preview.length <= 200);

  const detail = (await t.admin("GET", `/requests/${r.json.id}`)).json;
  assert.equal(detail.candidateSms.length, 1);                       // ادمین کاندیدِ درست را می‌بیند

  // مبلغِ نادقیق / کانالِ دیگر / درخواستِ ناموجود
  const wrong = await t.user("POST", "/wallet/topup/request", { user: "u2", body: { amount: 100_000, channelId: channel.id } });
  const mismatch = await t.admin("POST", `/sms/${sms[0].id}/assign`, { body: { requestId: wrong.json.id } });
  assert.deepEqual([mismatch.status, mismatch.json.code], [409, "amount_mismatch"]);
  const other = await t.user("POST", "/wallet/topup/request", { user: "u2", body: { amount: 300_000, channelId: c2.channel.id } });
  const cross = await t.admin("POST", `/sms/${sms[0].id}/assign`, { body: { requestId: other.json.id } });
  assert.deepEqual([cross.status, cross.json.code], [409, "channel_mismatch"]);
  assert.equal((await t.admin("POST", `/sms/${sms[0].id}/assign`, { body: { requestId: "nope" } })).status, 404);
  assert.equal((await t.admin("POST", `/sms/${sms[0].id}/assign`, { body: {} })).status, 400);
  assert.equal(await t.balance("u1"), 0);

  // دو ادمینِ هم‌زمان: فقط یکی
  const [p, q] = await Promise.all([1, 2].map(() => t.admin("POST", `/sms/${sms[0].id}/assign`, { body: { requestId: r.json.id } })));
  assert.deepEqual([p.status, q.status].sort(), [200, 409]);
  assert.equal(await t.balance("u1"), 2_000_000);
  assert.equal((await t.pool.query("SELECT COUNT(*)::int AS n FROM wallet_transactions WHERE user_id = 'u1'")).rows[0].n, 1);
  const row = (await t.pool.query("SELECT status, confirmed_by, confirmed_by_admin_id, matched_sms_id FROM payment_requests WHERE id = $1", [r.json.id])).rows[0];
  assert.deepEqual([row.status, row.confirmed_by, row.confirmed_by_admin_id, row.matched_sms_id], ["confirmed", "admin", "root", sms[0].id]);
  assert.equal((await t.pool.query("SELECT status FROM sms_inbox WHERE id = $1", [sms[0].id])).rows[0].status, "matched");
  assert.equal((await t.events("sms_assigned_by_admin")).length, 1);
  assert.equal(t.userNotes.length, 1);
  // پیامکِ مصرف‌شده دوباره قابلِ تخصیص نیست
  const again = await t.admin("POST", `/sms/${sms[0].id}/assign`, { body: { requestId: wrong.json.id } });
  assert.equal(again.status, 409);
}));

test("صندوقِ پیامک و لاگ: ماسکِ ارقامِ بلند، فیلتر، بدونِ متنِ خام در events", live, () => withEnv(async (t) => {
  const { channel, smsSecret } = await t.mkPlatform({ senderAllowlist: ["Blubank"] });
  await t.postSms(channel.id, smsSecret, `واریز 1,234,560 ریال به حساب شما نشست. کارت 6037997000001234 و موبایل 09123456789`);
  await t.postSms(channel.id, smsSecret, t.bankSms(5_000_000), { sender: "Scammer" });
  await t.postSms(channel.id, "wrong", "x");
  const sms = (await t.admin("GET", "/sms")).json.sms;
  assert.equal(sms.length, 2);
  const legit = sms.find((s) => s.sender === "Blubank");
  assert.ok(!legit.preview.includes("6037997000001234") && !legit.preview.includes("09123456789"));
  assert.ok(legit.preview.includes(`60${"*".repeat(12)}34`));
  const ignored = sms.find((s) => s.sender === "Scammer");
  assert.equal(ignored.status, "ignored");
  assert.ok(!ignored.preview.includes("فاطمه"), "متنِ فرستنده‌ی غیرمجاز ذخیره نمی‌شود");
  assert.equal((await t.admin("GET", "/sms?status=ignored")).json.sms.length, 1);
  assert.equal((await t.admin("GET", `/sms?channelId=${channel.id}&scope=platform`)).json.sms.length, 2);

  const evs = (await t.admin("GET", "/events")).json.events;
  assert.ok(evs.length >= 3);
  const all = JSON.stringify(evs);
  assert.ok(!all.includes("فاطمه") && !all.includes("6037997000001234") && !all.includes("09123456789") && !all.includes(smsSecret));
  assert.equal((await t.admin("GET", "/events?level=problems")).json.events.every((e) => e.level !== "info"), true);
  assert.ok((await t.admin("GET", "/events?kind=sms_auth_failed")).json.events.length === 1);
  assert.equal((await t.admin("GET", `/events?channelId=${channel.id}&limit=1`)).json.events.length, 1);
  assert.equal((await t.admin("GET", "/events?scope=bot")).json.events.length, 0);
}));

test("sweep و مهاجرت از پنل: sweep گزارش می‌دهد؛ مهاجرت پیش‌فرض dry-run است و اجرای واقعی audit می‌شود", live, () => withEnv(async (t) => {
  await t.mkPlatform();
  const r = await t.user("POST", "/wallet/topup/request", { body: { amount: 200_000 } });
  await t.pool.query("UPDATE payment_requests SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [r.json.id]);
  const sw = await t.admin("POST", "/sweep");
  assert.equal(sw.json.report.expired, 1);
  assert.equal((await t.pool.query("SELECT status FROM payment_requests WHERE id = $1", [r.json.id])).rows[0].status, "expired");
  assert.equal(t.audits.filter((a) => a.action === "card_autoconfirm_sweep").length, 1);
  const dry = await t.admin("POST", "/migration/run", { body: {} });
  assert.equal(dry.json.report.dryRun, true);
  assert.match(dry.json.markdown, /گزارشِ مهاجرت/);
  assert.equal(t.audits.filter((a) => a.action === "card_autoconfirm_migration").length, 0);
  const real = await t.admin("POST", "/migration/run", { body: { dryRun: false } });
  assert.equal(real.json.report.dryRun, false);
  assert.equal(t.audits.filter((a) => a.action === "card_autoconfirm_migration").length, 1);
}));
