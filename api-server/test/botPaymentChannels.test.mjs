/**
 * test/botPaymentChannels.test.mjs — فاز ۷ کارت‌به‌کارتِ خودکار (سمتِ سایت): تنظیماتِ فروشنده
 * (`routes/botPaymentChannels.ts` + `lib/paymentChannelAdmin.ts`).
 *
 * معیارِ اتمامِ فاز ۷: فروشنده از پنل وب کانال بسازد، پیامکِ آزمایشی بفرستد و یک خریدِ آزمایشی را
 * خودکار تأیید‌شده ببیند — اینجا سرتاسری روی Postgres و routeهای واقعی تست می‌شود (auth و resolveBot
 * تزریق شده‌اند چون به دیتابیسِ اپلیکیشن وصل‌اند؛ خودِ منطقِ فروشنده/کانال واقعی است).
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.PAYMENT_INTERNAL_SECRET = "test-internal-secret-value";
process.env.PUBLIC_SITE_URL = "https://irforge.example";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";

const { decryptToken } = await import("../src/lib/tokenCrypto.ts");
const { createBotPaymentChannelsRouter } = await import("../src/routes/botPaymentChannels.ts");
const { createPaymentSmsRouter } = await import("../src/routes/paymentSmsWebhook.ts");
const { createInternalBotPaymentsRouter } = await import("../src/routes/internalBotPayments.ts");
const A = await import("../src/lib/paymentChannelAdmin.ts");
const { hashSmsSecret } = await import("../src/lib/smsChannelSecret.ts");
const { createBotPayment } = await import("../src/lib/paymentBotApi.ts");
const { getPaymentChannelLimits, FREE_MAX_CHANNELS } = await import("../src/lib/paymentProGate.ts");
const { DEFAULT_CARD_GUIDE } = await import("../src/lib/platformSettings.ts");

const CARD = "6037997000000001";      // Luhn-معتبر
const CARD2 = "6104337000000008";
const MIN = 60_000;
const INTERNAL = process.env.PAYMENT_INTERNAL_SECRET;

// ─── خالص ───────────────────────────────────────────────────────────────────

test("validateNewChannel: ماتریسِ ورودی‌های معتبر/نامعتبر", () => {
  const ok = A.validateNewChannel({ cardNumber: "6037-9970-0000-0001", holderName: " علی احمدی ", bankName: "بلوبانک" });
  assert.deepEqual([ok.kind, ok.cardNumber, ok.holderName, ok.minAmountRial, ok.bankParser, ok.active], ["card_manual", CARD, "علی احمدی", 1_000_000, "blubank", true]);
  assert.equal(A.validateNewChannel({ cardNumber: "۶۰۳۷۹۹۷۰۰۰۰۰۰۰۰۱", holderName: "x" }).cardNumber, CARD);
  assert.equal(A.validateNewChannel({ cardNumber: CARD, holderName: "x", minAmountToman: 250_000 }).minAmountRial, 2_500_000);
  const link = A.validateNewChannel({ kind: "fixed_link", paymentUrl: "https://pay.example/x" });
  assert.deepEqual([link.kind, link.cardNumber, link.paymentUrl], ["fixed_link", null, "https://pay.example/x"]);

  const bad = [
    [{ holderName: "x" }, "invalid_card"],
    [{ cardNumber: "6037997000000002", holderName: "x" }, "invalid_card"],          // Luhn
    [{ cardNumber: "603799700000000", holderName: "x" }, "invalid_card"],           // ۱۵ رقم
    [{ cardNumber: CARD }, "holder_required"],
    [{ cardNumber: CARD, holderName: "   " }, "holder_required"],
    [{ kind: "crypto", cardNumber: CARD, holderName: "x" }, "invalid_kind"],
    [{ kind: "fixed_link", paymentUrl: "http://pay.example/x" }, "invalid_url"],
    [{ kind: "open_link", paymentUrl: "javascript:alert(1)" }, "invalid_url"],
    [{ kind: "open_link" }, "invalid_url"],
    [{ cardNumber: CARD, holderName: "x", minAmountToman: 5_000 }, "invalid_min_amount"],
    [{ cardNumber: CARD, holderName: "x", minAmountToman: 1e12 }, "invalid_min_amount"],
    [{ cardNumber: CARD, holderName: "x", minAmountToman: 100_000.5 }, "invalid_min_amount"],
    [{ cardNumber: CARD, holderName: "x", bankParser: "nope" }, "invalid_parser"],
    [{ cardNumber: CARD, holderName: "x", senderAllowlist: Array.from({ length: 11 }, (_, i) => `S${i}`) }, "invalid_allowlist"],
    [{ cardNumber: CARD, holderName: "x", senderAllowlist: 5 }, "invalid_allowlist"],
  ];
  for (const [input, code] of bad) {
    assert.throws(() => A.validateNewChannel(input), (e) => e.code === code, JSON.stringify(input));
  }
  assert.deepEqual(A.validateNewChannel({ cardNumber: CARD, holderName: "x", senderAllowlist: "Blubank, +98 912 1234567\n0912-123-4567; blubank" }).senderAllowlist,
    ["Blubank", "+98 912 1234567"], "تکراری‌ها (بعد از canonical) حذف می‌شوند");
});

test("channelHealth / webhookUrlFor / maskLongDigits / sampleDepositText", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  assert.deepEqual(A.channelHealth(null, now), { status: "never", lastSmsAt: null });
  assert.equal(A.channelHealth(new Date(now.getTime() - 3 * 3600_000), now).status, "ok");
  assert.equal(A.channelHealth(new Date(now.getTime() - 13 * 3600_000), now).status, "stale");
  assert.equal(A.channelHealth(new Date(now.getTime() - A.SMS_STALE_HOURS * 3600_000), now).status, "ok");
  assert.equal(A.webhookUrlFor("pch_1", "https://x.example/"), "https://x.example/api/payments/sms/pch_1");
  assert.equal(A.maskLongDigits("کارت 6037997000000001 مبلغ 1,234,560 تماس 09121234567"), "کارت 60************01 مبلغ 1,234,560 تماس 09*******67");
  assert.match(A.sampleDepositText("blubank"), /1,234,560 ریال به حساب شما نشست/);
});

test("قلابِ payment_pro: امروز رایگان با سقفِ ثابت", async () => {
  assert.deepEqual(await getPaymentChannelLimits("any"), { maxChannels: FREE_MAX_CHANNELS, pro: false });
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
const ddl = ["0038_card_autoconfirm.sql", "0039_card_autoconfirm_effects.sql", "0040_card_autoconfirm_reject.sql"].map(readSql).join("\n");

// کاربر → باتی که مجاز است. سوپرادمین همه‌چیز را می‌بیند.
const ACCESS = { owner_A: "bot_A", owner_B: "bot_B" };
const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });

async function withEnv(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p7_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 40, options: `-c search_path=${schema}` });
  await pool.query(ddl);
  await pool.query("CREATE TABLE bots (id text PRIMARY KEY, sheet_id text)");
  await pool.query("INSERT INTO bots (id, sheet_id) VALUES ('bot_A','sheet_A_12345'),('bot_B','sheet_B_12345')");

  const audits = [];
  let guideStore = null;
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: "text/plain" }));
  app.use("/api", createBotPaymentChannelsRouter({
    pool, hitFn: okHit,
    auth: (req, res, next) => {
      const u = req.header("x-test-user");
      if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
      req.userId = u;
      next();
    },
    superAdmin: (req, res, next) => {
      if (req.header("x-test-super") !== "1") { res.status(403).json({ error: "Forbidden" }); return; }
      req.userId = "root";
      next();
    },
    resolveBot: async (userId, botId) => {
      if (ACCESS[userId] === botId) return { botId };
      throw { status: 404, error: "این بات پیدا نشد یا مال شما نیست." };
    },
    audit: async (a) => { audits.push(a); },
    guide: {
      get: async () => guideStore ?? { ...DEFAULT_CARD_GUIDE },
      set: async (input, by) => {
        const raw = input && typeof input === "object" ? input : {};
        guideStore = { title: String(raw.title || DEFAULT_CARD_GUIDE.title).slice(0, 120), text: String(raw.text || DEFAULT_CARD_GUIDE.text).slice(0, 8000),
          tutorialUrl: /^https:\/\//.test(String(raw.tutorialUrl || "")) ? String(raw.tutorialUrl) : "", isDefault: false, by };
        return guideStore;
      },
    },
  }));
  app.use("/api", createPaymentSmsRouter({ pool, hitFn: okHit }));
  app.use("/api", createInternalBotPaymentsRouter({
    pool, hitFn: okHit,
    resolveBot: async (sid) => ({ sheet_A_12345: { botId: "bot_A" }, sheet_B_12345: { botId: "bot_B" } })[sid] ?? null,
  }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}/api`;
  const call = async (method, path, { body, user = "owner_A", superAdmin = false, headers = {} } = {}) => {
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}), ...(superAdmin ? { "x-test-super": "1" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const internal = async (path, body) => {
    const res = await fetch(`${origin}/internal/payments${path}`, {
      method: "POST", headers: { "content-type": "application/json", "x-payment-internal-secret": INTERNAL }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const postSms = async (channelId, secret, body) => {
    const res = await fetch(`${origin}/payments/sms/${channelId}`, {
      method: "POST", headers: { "content-type": "application/json", "x-sms-secret": secret }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    await fn({ pool, call, internal, postSms, audits });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

const NEW = { kind: "card_manual", cardNumber: CARD, holderName: "علی احمدی", bankName: "بلوبانک" };
const makeChannel = async (call, over = {}, opts) => (await call("POST", "/bots/bot_A/payment-channels", { body: { ...NEW, ...over }, ...opts }));
const bluText = (amount, tag = "") =>
  `بلو\nواریز پول\n فاطمه عزیز، ${amount.toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸${tag}`;

test("ساختِ کانال: secret فقط یک‌بار، هش ذخیره می‌شود، کارت رمزنگاری و در پاسخ فقط ماسک، آدرسِ وبهوک آماده", live, () =>
  withEnv(async ({ pool, call, audits }) => {
    const r = await makeChannel(call);
    assert.equal(r.status, 201);
    const { channel, smsSecret } = r.json;
    assert.match(smsSecret, /^irfsms_[A-Za-z0-9_-]{40,}$/);
    assert.equal(channel.cardMasked, "6037-****-****-0001");
    assert.equal(channel.webhookUrl, `https://irforge.example/api/payments/sms/${channel.id}`);
    assert.equal(channel.minAmountToman, 100_000);
    assert.equal(channel.health.status, "never");
    assert.doesNotMatch(JSON.stringify(r.json), /6037997000000001/, "شماره‌کارتِ کامل در پاسخ نیست");
    const db = (await pool.query("SELECT * FROM payment_channels WHERE id=$1", [channel.id])).rows[0];
    assert.equal(db.sms_secret_hash, hashSmsSecret(smsSecret));
    assert.notEqual(db.sms_secret_hash, smsSecret);
    assert.match(db.card_number_enc, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    assert.equal(decryptToken(db.card_number_enc), CARD);
    assert.deepEqual([db.scope, db.bot_id, db.active, Number(db.min_amount_rial)], ["bot", "bot_A", true, 1_000_000]);
    // خواندنِ بعدی هرگز secret/کارت را نشان نمی‌دهد
    const list = await call("GET", "/bots/bot_A/payment-channels");
    assert.equal(list.status, 200);
    assert.doesNotMatch(JSON.stringify(list.json), /irfsms_|6037997000000001|sms_secret|card_number_enc/);
    assert.equal(list.json.channels.length, 1);
    assert.deepEqual(list.json.limits, { maxChannels: 3, pro: false });
    assert.equal(list.json.publicUrlConfigured, true);
    // ردپا: فقط شناسه‌ها
    assert.equal(audits[0].action, "payment_channel_created");
    assert.doesNotMatch(JSON.stringify(audits), /irfsms_|6037997000000001/);
  }));

test("اعتبارسنجیِ route: ورودی‌های بد ۴۰۰ با کد؛ چیزی ذخیره نمی‌شود", live, () =>
  withEnv(async ({ pool, call }) => {
    for (const [over, code] of [
      [{ cardNumber: "6037997000000002" }, "invalid_card"], [{ holderName: "" }, "holder_required"],
      [{ kind: "open_link", cardNumber: undefined, paymentUrl: "http://x.example" }, "invalid_url"],
      [{ minAmountToman: 10 }, "invalid_min_amount"], [{ bankParser: "zzz" }, "invalid_parser"],
    ]) {
      const r = await makeChannel(call, over);
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.equal(r.json.code, code);
    }
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_channels")).rows[0].n, 0);
  }));

test("سقفِ کانال: سومی مجاز، چهارمی ۴۰۹؛ ۶ ساختِ هم‌زمان فقط تا سقف", live, () =>
  withEnv(async ({ pool, call }) => {
    const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => makeChannel(call, { holderName: `h${i}` })));
    assert.equal(outs.filter((o) => o.status === 201).length, 3);
    assert.ok(outs.filter((o) => o.status !== 201).every((o) => o.status === 409 && o.json.code === "channel_limit"));
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_channels")).rows[0].n, 3);
  }));

test("ایزولاسیون: مالکِ باتِ B (یا بی‌دسترسی/بی‌ورود) هیچ‌چیزِ کانالِ باتِ A را نمی‌بیند یا تغییر نمی‌دهد", live, () =>
  withEnv(async ({ pool, call, postSms }) => {
    const { channel, smsSecret } = (await makeChannel(call)).json;
    const base = "/bots/bot_A/payment-channels";
    for (const [m, p, body] of [
      ["GET", base], ["POST", base, NEW], ["PATCH", `${base}/${channel.id}`, { holderName: "hack" }],
      ["POST", `${base}/${channel.id}/rotate-secret`], ["DELETE", `${base}/${channel.id}`],
      ["POST", `${base}/${channel.id}/test-sms`], ["GET", `${base}/${channel.id}/sms-log`],
    ]) {
      assert.equal((await call(m, p, { body, user: "owner_B" })).status, 404, `${m} ${p}`);
      assert.equal((await call(m, p, { body, user: "stranger" })).status, 404, `${m} ${p} stranger`);
      assert.equal((await call(m, p, { body, user: null })).status, 401, `${m} ${p} anon`);
    }
    // باتِ B با شناسه‌ی کانالِ A: کانال «پیدا نشد» (نه فقط بات)
    const cB = (await makeChannel(call, {}, { user: "owner_B" }));
    assert.equal(cB.status, 404, "owner_B فقط به bot_B دسترسی دارد؛ مسیرِ bot_A را می‌زند");
    const own = await call("PATCH", `/bots/bot_B/payment-channels/${channel.id}`, { body: { holderName: "hack" }, user: "owner_B" });
    assert.equal(own.status, 404);
    for (const p of [`/bots/bot_B/payment-channels/${channel.id}/rotate-secret`, `/bots/bot_B/payment-channels/${channel.id}/test-sms`]) {
      assert.equal((await call("POST", p, { user: "owner_B" })).status, 404, p);
    }
    assert.equal((await call("DELETE", `/bots/bot_B/payment-channels/${channel.id}`, { user: "owner_B" })).status, 404);
    assert.equal((await call("GET", `/bots/bot_B/payment-channels/${channel.id}/sms-log`, { user: "owner_B" })).status, 404);
    const db = (await pool.query("SELECT holder_name, sms_secret_hash FROM payment_channels WHERE id=$1", [channel.id])).rows[0];
    assert.equal(db.holder_name, "علی احمدی");
    assert.equal(db.sms_secret_hash, hashSmsSecret(smsSecret));
    assert.equal((await call("GET", "/bots/bot_B/payment-channels", { user: "owner_B" })).json.channels.length, 0);
  }));

test("ویرایش: فیلدهای عادی عوض می‌شود، secret و کارت دست‌نخورده؛ کارتِ خالی = همان کارتِ قبلی", live, () =>
  withEnv(async ({ pool, call }) => {
    const { channel, smsSecret } = (await makeChannel(call)).json;
    const url = `/bots/bot_A/payment-channels/${channel.id}`;
    const r = await call("PATCH", url, { body: { holderName: "  نامِ تازه ", bankName: "ملت", minAmountToman: 300_000, senderAllowlist: ["Blubank", "+98100011"], bankParser: "generic", cardNumber: "" } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.channel.holderName, r.json.channel.bankName, r.json.channel.minAmountToman, r.json.channel.bankParser],
      ["نامِ تازه", "ملت", 300_000, "generic"]);
    assert.deepEqual(r.json.channel.senderAllowlist, ["Blubank", "+98100011"]);
    const db = (await pool.query("SELECT * FROM payment_channels WHERE id=$1", [channel.id])).rows[0];
    assert.equal(decryptToken(db.card_number_enc), CARD);
    assert.equal(db.sms_secret_hash, hashSmsSecret(smsSecret));
    assert.equal((await call("PATCH", url, { body: { cardNumber: "6037997000000002" } })).json.code, "invalid_card");
    assert.equal((await call("PATCH", url, { body: { holderName: "" } })).json.code, "holder_required");
    assert.equal((await call("PATCH", url, { body: {} })).status, 200);
    // تغییرِ کارت
    const ch = await call("PATCH", url, { body: { cardNumber: CARD2 } });
    assert.equal(ch.json.channel.cardMasked, "6104-****-****-0008");
    assert.equal(decryptToken((await pool.query("SELECT card_number_enc FROM payment_channels WHERE id=$1", [channel.id])).rows[0].card_number_enc), CARD2);
  }));

test("وقتی درخواستِ فعال هست: تغییرِ کارت/نوع/لینک و غیرفعال‌سازی/حذف ممنوع؛ ویرایشِ بی‌خطر مجاز؛ بعد از پایان آزاد", live, () =>
  withEnv(async ({ pool, call, internal }) => {
    const { channel } = (await makeChannel(call)).json;
    const url = `/bots/bot_A/payment-channels/${channel.id}`;
    const p = (await internal("/requests/create", { spreadsheetId: "sheet_A_12345", userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000 })).json.payment;
    assert.equal((await call("GET", "/bots/bot_A/payment-channels")).json.channels[0].activeRequests, 1);
    for (const body of [{ cardNumber: CARD2 }, { active: false }, { kind: "fixed_link", paymentUrl: "https://pay.example/x" }]) {
      const r = await call("PATCH", url, { body });
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.equal(r.json.code, "channel_has_active_requests");
    }
    assert.equal((await call("DELETE", url)).json.code, "channel_has_history");
    assert.equal((await call("PATCH", url, { body: { holderName: "نامِ دیگر", minAmountToman: 200_000, bankName: "x" } })).status, 200);
    // لغوِ درخواست → آزاد
    await internal("/requests/cancel", { spreadsheetId: "sheet_A_12345", userId: "1001", requestId: p.id });
    assert.equal((await call("PATCH", url, { body: { cardNumber: CARD2 } })).status, 200);
    assert.equal((await call("PATCH", url, { body: { active: false } })).json.channel.active, false);
    // بعد از غیرفعال‌سازی وبهوک ۴۰۳ می‌دهد و کانال در فهرستِ بات نیست
    assert.equal((await internal("/channel", { spreadsheetId: "sheet_A_12345" })).json.channels.length, 0);
  }));

test("چرخشِ secret: قدیمی همان لحظه ۴۰۱، جدید کار می‌کند؛ بقیه‌ی تنظیمات و کارت سالم", live, () =>
  withEnv(async ({ pool, call, postSms, audits }) => {
    const { channel, smsSecret: s1 } = (await makeChannel(call, { senderAllowlist: ["Blubank"], minAmountToman: 200_000 })).json;
    assert.equal((await postSms(channel.id, s1, { text: bluText(1_500_000), sender: "Blubank" })).status, 201);
    const rot = await call("POST", `/bots/bot_A/payment-channels/${channel.id}/rotate-secret`);
    assert.equal(rot.status, 200);
    const s2 = rot.json.smsSecret;
    assert.notEqual(s2, s1);
    assert.equal((await postSms(channel.id, s1, { text: bluText(1_500_000, " x"), sender: "Blubank" })).status, 401);
    assert.equal((await postSms(channel.id, s2, { text: bluText(1_500_000, " y"), sender: "Blubank" })).status, 201);
    assert.deepEqual([rot.json.channel.senderAllowlist, rot.json.channel.minAmountToman, rot.json.channel.cardMasked],
      [["Blubank"], 200_000, "6037-****-****-0001"]);
    assert.doesNotMatch(JSON.stringify(rot.json.channel), /irfsms_/);
    const audit = audits.find((a) => a.action === "payment_channel_secret_rotated");
    assert.ok(audit && !JSON.stringify(audit).includes(s2) && !JSON.stringify(audit).includes(s1));
    assert.equal(decryptToken((await pool.query("SELECT card_number_enc FROM payment_channels WHERE id=$1", [channel.id])).rows[0].card_number_enc), CARD);
  }));

test("سرتاسر (معیارِ اتمامِ فاز ۷): ساختِ کانال از پنل → پیامکِ آزمایشی → خریدِ آزمایشی خودکار تأیید می‌شود", live, () =>
  withEnv(async ({ pool, call, internal, postSms }) => {
    // ۱) ساخت
    const { channel, smsSecret } = (await makeChannel(call)).json;
    const url = new URL(channel.webhookUrl);
    assert.equal(url.pathname, `/api/payments/sms/${channel.id}`);

    // ۲) پیامکِ آزمایشیِ سمتِ سرور: پارسر درست می‌فهمد و هرگز قابلِ match نیست، سلامتِ کانال را جعل نمی‌کند
    const t = await call("POST", `/bots/bot_A/payment-channels/${channel.id}/test-sms`);
    assert.equal(t.status, 200);
    assert.equal(t.json.result.matchesExpected, true);
    assert.deepEqual([t.json.result.direction, t.json.result.amountRial, t.json.result.parsedOk], ["deposit", 1_234_560, true]);
    const testRow = (await pool.query("SELECT status, sender, raw_text FROM sms_inbox WHERE channel_id=$1", [channel.id])).rows[0];
    assert.deepEqual([testRow.status, testRow.sender], ["ignored", "IRFORGE-TEST"]);
    assert.match(testRow.raw_text, /^\[TEST\]/);
    assert.equal((await call("GET", "/bots/bot_A/payment-channels")).json.channels[0].health.status, "never");

    // ۳) «گوشی» متصل می‌شود: اولین پیامکِ واقعی → سلامت ok و لاگ
    const hello = await postSms(channel.id, smsSecret, { text: bluText(1_111_110, " hello"), sender: "Blubank", time: new Date().toISOString() });
    assert.equal(hello.status, 201);
    const list = await call("GET", "/bots/bot_A/payment-channels");
    assert.equal(list.json.channels[0].health.status, "ok");
    const log = await call("GET", `/bots/bot_A/payment-channels/${channel.id}/sms-log`);
    assert.equal(log.json.entries.length, 2);
    assert.ok(log.json.entries.some((e) => e.isTest && e.status === "ignored"));
    const real = log.json.entries.find((e) => !e.isTest);
    assert.deepEqual([real.direction, real.amountToman, real.parsedOk, real.status], ["deposit", 111_111, true, "unmatched"]);

    // ۴) خریدِ آزمایشی: مشتریِ بات درخواست می‌سازد، «بانک» دقیقاً همان مبلغ را پیامک می‌کند → تأیید خودکار
    const chList = await internal("/channel", { spreadsheetId: "sheet_A_12345" });
    assert.equal(chList.json.channels[0].id, channel.id);
    assert.equal(chList.json.channels[0].cardLast4, "0001");
    assert.doesNotMatch(JSON.stringify(chList.json), /6037997000000001/);
    const pay = (await internal("/requests/create", { spreadsheetId: "sheet_A_12345", userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000 })).json.payment;
    assert.equal(pay.channel.cardNumber, CARD);
    const paid = await postSms(channel.id, smsSecret, { text: bluText(pay.finalAmountRial, " pay"), sender: "Blubank", time: new Date().toISOString() });
    assert.equal(paid.json.matched, true);
    const done = (await internal("/requests/get", { spreadsheetId: "sheet_A_12345", requestId: pay.id })).json.payment;
    assert.deepEqual([done.status, done.confirmedBy], ["confirmed", "sms"]);
    // snapshotِ حسابِ مقصد روی درخواست
    assert.equal((await pool.query("SELECT account_id_snapshot FROM payment_requests WHERE id=$1", [pay.id])).rows[0].account_id_snapshot, channel.id);
  }));

test("پیامکِ آزمایشی هرگز درخواستِ واقعیِ هم‌مبلغ را تأیید نمی‌کند و لاگ «آزمایشی» علامت می‌خورد", live, () =>
  withEnv(async ({ pool, call }) => {
    const { channel } = (await makeChannel(call)).json;
    // درخواستی با مبلغِ نهایی دقیقاً ۱٬۲۳۴٬۵۶۰ (همان مبلغِ پیامکِ آزمایشی)
    const r = await createBotPayment(pool, { botId: "bot_A", userId: "1", purpose: "wallet_topup", baseAmountRial: 1_234_500, randomInt: () => 5 });
    assert.equal(r.payment.finalAmountRial, 1_234_560);
    for (let i = 0; i < 3; i++) await call("POST", `/bots/bot_A/payment-channels/${channel.id}/test-sms`);
    assert.equal((await pool.query("SELECT status FROM payment_requests WHERE id=$1", [r.payment.id])).rows[0].status, "pending");
    const { matchSms, retestUnmatchedForRequest } = await import("../src/lib/paymentMatcher.ts");
    const ids = (await pool.query("SELECT id FROM sms_inbox WHERE channel_id=$1", [channel.id])).rows.map((x) => x.id);
    assert.equal(ids.length, 3);
    for (const id of ids) assert.equal((await matchSms(pool, id)).outcome, "skipped");
    assert.deepEqual(await retestUnmatchedForRequest(pool, r.payment.id), []);
    assert.equal((await pool.query("SELECT last_sms_at FROM payment_channels WHERE id=$1", [channel.id])).rows[0].last_sms_at, null);
  }));

test("سلامتِ کانال: never → ok → stale (بیش از ۱۲ ساعت)", live, () =>
  withEnv(async ({ pool, call, postSms }) => {
    const { channel, smsSecret } = (await makeChannel(call)).json;
    const health = async () => (await call("GET", "/bots/bot_A/payment-channels")).json.channels[0].health;
    assert.equal((await health()).status, "never");
    await postSms(channel.id, smsSecret, { text: bluText(1_500_000, " h"), sender: "Blubank" });
    assert.equal((await health()).status, "ok");
    await pool.query("UPDATE payment_channels SET last_sms_at = now() - interval '13 hours' WHERE id=$1", [channel.id]);
    const h = await health();
    assert.equal(h.status, "stale");
    assert.ok(h.hoursSince > 12);
    const log = await call("GET", `/bots/bot_A/payment-channels/${channel.id}/sms-log`);
    assert.equal(log.json.health.status, "stale");
    assert.equal(log.json.staleHours, 12);
  }));

test("لاگِ پیامک: شماره‌کارت/موبایلِ بلند در پیش‌نمایش ماسک می‌شود؛ فرستنده‌ی غیرمجاز فقط placeholder دارد", live, () =>
  withEnv(async ({ call, postSms }) => {
    const { channel, smsSecret } = (await makeChannel(call, { senderAllowlist: ["Blubank"] })).json;
    await postSms(channel.id, smsSecret, { text: bluText(1_500_000, " کارت 6037997000000001 تماس 09121234567"), sender: "Blubank" });
    await postSms(channel.id, smsSecret, { text: "پیامِ شخصی با شماره 6104337000000008", sender: "+989121234567" });
    const { entries } = (await call("GET", `/bots/bot_A/payment-channels/${channel.id}/sms-log`)).json;
    const text = JSON.stringify(entries);
    assert.doesNotMatch(text, /6037997000000001|09121234567|6104337000000008/);
    assert.match(text, /60\*+01/);
    const ign = entries.find((e) => e.status === "ignored");
    assert.match(ign.preview, /ذخیره نشد/);
  }));

test("حذف: کانالِ بدونِ سابقه (حتی با پیامکِ آزمایشی) حذف می‌شود؛ با سابقه ۴۰۹", live, () =>
  withEnv(async ({ pool, call, postSms }) => {
    const a = (await makeChannel(call)).json;
    await call("POST", `/bots/bot_A/payment-channels/${a.channel.id}/test-sms`);
    assert.equal((await call("DELETE", `/bots/bot_A/payment-channels/${a.channel.id}`)).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_channels")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM sms_inbox")).rows[0].n, 0);
    const b = (await makeChannel(call)).json;
    await postSms(b.channel.id, b.smsSecret, { text: bluText(1_500_000, " real"), sender: "Blubank" });
    const r = await call("DELETE", `/bots/bot_A/payment-channels/${b.channel.id}`);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "channel_has_history");
    assert.equal((await call("DELETE", `/bots/bot_A/payment-channels/pch_nope`)).status, 404);
  }));

test("راهنما: همه‌ی واردشده‌ها می‌خوانند؛ فقط سوپرادمین می‌نویسد؛ پیش‌فرضِ داخلِ کد کامل است", live, () =>
  withEnv(async ({ call }) => {
    const g = await call("GET", "/card-autoconfirm-guide", { user: "owner_A" });
    assert.equal(g.status, 200);
    assert.equal(g.json.isDefault, true);
    assert.match(g.json.text, /MacroDroid/);
    assert.match(g.json.text, /X-Sms-Secret/);
    assert.match(g.json.text, /CVV2/);
    assert.equal((await call("GET", "/card-autoconfirm-guide", { user: null })).status, 401);
    assert.equal((await call("PUT", "/admin/card-autoconfirm-guide", { body: { text: "hack" }, user: "owner_A" })).status, 403);
    const s = await call("PUT", "/admin/card-autoconfirm-guide", { body: { title: "T", text: "گام ۱\nگام ۲", tutorialUrl: "https://video.example/x" }, superAdmin: true });
    assert.equal(s.status, 200);
    const after = await call("GET", "/card-autoconfirm-guide", { user: "owner_B" });
    assert.deepEqual([after.json.title, after.json.text, after.json.tutorialUrl, after.json.isDefault], ["T", "گام ۱\nگام ۲", "https://video.example/x", false]);
  }));

test("منبع: هیچ لاگ/ردپا/پاسخی شماره‌کارت یا secret نمی‌دهد؛ botId فقط از resolveBot؛ نوشتن‌ها rate-limit و impersonation-guard دارند", () => {
  const route = fs.readFileSync(new URL("../src/routes/botPaymentChannels.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /req\.body\.botId|req\.body\.bot_id|req\.query\.botId/);
  assert.match(route, /resolveBot\(req\.userId, req\.params\.botId\)/);
  const logs = [...route.matchAll(/logger\.(?:info|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(logs.length >= 3);
  for (const l of logs) assert.doesNotMatch(l.split('"')[0], /smsSecret|secret|cardNumber|card_number/i, l);
  for (const verb of ["post", "patch", "delete"]) {
    for (const m of route.matchAll(new RegExp(`router\\.${verb}\\("[^"]+", auth, ([^\\n]*?)async`, "g"))) {
      assert.match(m[1], /blockWhileImpersonating/);
      assert.match(m[1], /writeLimit/);
    }
  }
  const lib = fs.readFileSync(new URL("../src/lib/paymentChannelAdmin.ts", import.meta.url), "utf8");
  for (const m of lib.matchAll(/(?:FROM|UPDATE) payment_channels/g)) {
    const window = lib.slice(m.index, m.index + 260);
    assert.match(window, /bot_id/, "query بدونِ فیلترِ بات: " + window.slice(0, 90));
  }
  assert.doesNotMatch(lib, /logger\./);
});
