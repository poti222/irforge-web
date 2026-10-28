/**
 * test/smsForwarder.test.mjs — «ارسال پیامک به تلگرام» (lib/smsForwarder.ts + routes/smsForwarder.ts).
 *
 * بخشِ خالص همیشه اجرا می‌شود؛ بخشِ زنده (express + Postgres واقعی) فقط با `CARD_TEST_PG_URL`
 * (هر تست schemaِ موقتِ خودش را می‌سازد و می‌اندازد). ارسالِ تلگرام همیشه fake است.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "ab".repeat(32);

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";

const lib = await import("../src/lib/smsForwarder.ts");
const { normalizeChatRef, normalizeSenderFilter, validateRuleInput, matchRules, dispatchToRule, ForwardError,
  generateForwardSecret, hashForwardSecret, verifyForwardSecret, FORWARD_ID_RE, newPublicId } = lib;
const { isRawSmsPath } = await import("../src/lib/smsBody.ts");
const { createSmsForwarderRouter } = await import("../src/routes/smsForwarder.ts");
const { chatIdFor } = await import("../src/lib/smsForwardBot.ts");

// ─── خالص ───────────────────────────────────────────────────────────────────

test("normalizeChatRef: @username، شناسه‌ی عددی، لینک t.me و me", () => {
  assert.equal(normalizeChatRef("@my_channel", "bot"), "@my_channel");
  assert.equal(normalizeChatRef("-1001234567890", "bot"), "-1001234567890");
  assert.equal(normalizeChatRef("https://t.me/my_channel", "bot"), "@my_channel");
  assert.equal(normalizeChatRef("ME", "userbot"), "me");
  assert.equal(normalizeChatRef("me", "both"), "me");
  assert.throws(() => normalizeChatRef("me", "bot"), ForwardError); // بات به «خودِ کاربر» نمی‌تواند پیام بدهد
  assert.throws(() => normalizeChatRef("", "bot"), ForwardError);
  assert.throws(() => normalizeChatRef("abc", "bot"), ForwardError);
  assert.throws(() => normalizeChatRef("@ab", "bot"), ForwardError);
  assert.throws(() => normalizeChatRef("javascript:alert(1)", "bot"), ForwardError);
});

test("chatIdFor: شناسه‌ی عددی عدد می‌شود، username نه", () => {
  assert.equal(chatIdFor("-1001234567890"), -1001234567890);
  assert.equal(chatIdFor("@chan_nel"), "@chan_nel");
});

test("normalizeSenderFilter: جداکننده‌ها، یکتاسازی و سقف", () => {
  assert.deepEqual(normalizeSenderFilter("Blubank, 1000 ،Blubank\n+98100"), ["Blubank", "1000", "+98100"]);
  assert.deepEqual(normalizeSenderFilter(""), []);
  assert.deepEqual(normalizeSenderFilter(undefined), []);
  assert.throws(() => normalizeSenderFilter(Array.from({ length: 11 }, (_, i) => `s${i}`)), ForwardError);
  assert.throws(() => normalizeSenderFilter(["x".repeat(41)]), ForwardError);
});

test("validateRuleInput: ساخت و PATCH روی مقدارِ فعلی", () => {
  const r = validateRuleInput({ name: " بانک ", chatRef: "@bank_chan", via: "both", senderFilter: "Blu", keyword: " واریز " });
  assert.deepEqual(r, { name: "بانک", enabled: true, senderFilter: ["Blu"], keyword: "واریز", via: "both", chatRef: "@bank_chan" });
  const p = validateRuleInput({ enabled: false }, r);
  assert.equal(p.enabled, false);
  assert.equal(p.chatRef, "@bank_chan");
  assert.equal(validateRuleInput({ keyword: "" }, r).keyword, null);
  assert.throws(() => validateRuleInput({ name: "", chatRef: "@abcde" }), ForwardError);
  assert.throws(() => validateRuleInput({ name: "x", chatRef: "@abcde", via: "carrier-pigeon" }), ForwardError);
  // PATCH مسیر به bot با chatRef=me باید رد شود
  assert.throws(() => validateRuleInput({ via: "bot" }, { ...r, chatRef: "me", via: "userbot" }), ForwardError);
});

const R = (o) => ({ id: "r", name: "r", enabled: true, senderFilter: [], keyword: null, via: "bot", chatRef: "@abcde", sortOrder: 0, ...o });

test("matchRules: فیلترِ خالی = همه؛ فرستنده/کلمه بدونِ حساسیت به حروف؛ غیرفعال رد؛ همه‌ی مطابق‌ها", () => {
  const sms = { text: "واریز پول 100 Blubank", sender: "Blubank" };
  assert.equal(matchRules([R({})], sms).length, 1);
  assert.equal(matchRules([R({ senderFilter: ["blubank"] })], sms).length, 1);
  assert.equal(matchRules([R({ senderFilter: ["other"] })], sms).length, 0);
  assert.equal(matchRules([R({ senderFilter: ["other"] })], { text: "x", sender: null }).length, 0);
  assert.equal(matchRules([R({ keyword: "BLUBANK" })], sms).length, 1);
  assert.equal(matchRules([R({ keyword: "برداشت" })], sms).length, 0);
  assert.equal(matchRules([R({ enabled: false })], sms).length, 0);
  assert.equal(matchRules([R({ id: "a" }), R({ id: "b", keyword: "واریز" }), R({ id: "c", keyword: "نه" })], sms).map((x) => x.id).join(), "a,b");
});

test("dispatchToRule: bot / userbot / both(failover) / مسیرِ وصل‌نشده / throw", async () => {
  const ok = async () => ({ ok: true });
  const bad = async () => ({ ok: false, error: "boom" });
  const boom = async () => { throw new Error("net down"); };

  assert.deepEqual(await dispatchToRule(R({ via: "bot" }), "t", { bot: ok, userbot: null }), { rule: R({ via: "bot" }), ok: true, via: "bot", error: null });
  const nb = await dispatchToRule(R({ via: "bot" }), "t", { bot: null, userbot: ok });
  assert.equal(nb.ok, false); assert.equal(nb.error, "bot_not_configured");
  const nu = await dispatchToRule(R({ via: "userbot" }), "t", { bot: ok, userbot: null });
  assert.equal(nu.error, "userbot_not_connected");

  const calls = [];
  const ub = async () => { calls.push("userbot"); return { ok: true }; };
  const bt = async () => { calls.push("bot"); return { ok: true }; };
  const both1 = await dispatchToRule(R({ via: "both" }), "t", { bot: bt, userbot: ub });
  assert.equal(both1.via, "userbot"); assert.deepEqual(calls, ["userbot"], "هرگز دو نسخه نمی‌رود");

  const both2 = await dispatchToRule(R({ via: "both" }), "t", { bot: ok, userbot: bad });
  assert.equal(both2.ok, true); assert.equal(both2.via, "bot");
  const both3 = await dispatchToRule(R({ via: "both" }), "t", { bot: ok, userbot: null });
  assert.equal(both3.via, "bot");
  const both4 = await dispatchToRule(R({ via: "both" }), "t", { bot: bad, userbot: boom });
  assert.equal(both4.ok, false); assert.equal(both4.error, "boom");
  const thrown = await dispatchToRule(R({ via: "bot" }), "t", { bot: boom, userbot: null });
  assert.equal(thrown.ok, false); assert.match(thrown.error, /net down/);
});

test("secret: پیشوند، هش و تأیید؛ publicId با regex می‌خواند؛ مسیرِ وبهوک raw است", () => {
  const s = generateForwardSecret();
  assert.match(s, /^irfsmf_/);
  assert.equal(verifyForwardSecret(s, hashForwardSecret(s)), true);
  assert.equal(verifyForwardSecret("irfsmf_wrong", hashForwardSecret(s)), false);
  assert.equal(verifyForwardSecret(s, null), false);
  assert.match(newPublicId(), FORWARD_ID_RE);
  assert.equal(isRawSmsPath("POST", "/api/sms-forward/hook/smf_0123456789abcdef01"), true);
  assert.equal(isRawSmsPath("POST", "/api/sms-forward/overview"), false);
  assert.equal(isRawSmsPath("GET", "/api/sms-forward/hook/smf_0123456789abcdef01"), false);
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;
const ddl = fs.existsSync(new URL("../../lib/db/migrations/0065_sms_forwarder.sql", import.meta.url))
  ? fs.readFileSync(new URL("../../lib/db/migrations/0065_sms_forwarder.sql", import.meta.url), "utf8") : "";

const allow = async () => ({ allowed: true, retryAfterSeconds: 0 });

async function withEnv(fn, { hitFn, userbot } = {}) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `smsfwd_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 10, options: `-c search_path=${schema}` });
  await pool.query(ddl);

  const sent = []; // { token, chat, text }
  const state = { botFails: 0, botDelay: 0 };
  const botSend = async (token, chat, text) => {
    if (state.botDelay) await new Promise((r) => setTimeout(r, state.botDelay)); // ارسالِ کندِ تلگرام
    if (state.botFails > 0) { state.botFails--; return { ok: false, error: "Forbidden: bot was blocked" }; }
    sent.push({ token, chat, text });
    return { ok: true };
  };
  const ubSent = [];
  const driver = userbot ?? {
    available: () => true,
    startLogin: async () => ({ codeViaApp: true }),
    completeLogin: async (_u, code, password) => {
      if (code === "00000") throw Object.assign(new (await import("../src/lib/smsForwardUserbot.ts")).UserbotError("bad_code", "کد اشتباه است"));
      if (code === "22222" && !password) throw new (await import("../src/lib/smsForwardUserbot.ts")).UserbotError("password_needed", "pw");
      return { session: "SESSION-STRING", label: "@me_user" };
    },
    cancelLogin: async () => {},
    send: async (_u, session, chat, text) => { ubSent.push({ session, chat, text }); return { ok: true }; },
    logout: async () => {},
  };

  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", createSmsForwarderRouter({
    pool, hitFn: hitFn ?? allow, userbot: driver, botSend,
    verifyBot: async (t) => (t.startsWith("111111:") ? { ok: true, username: "my_sms_bot" } : { ok: false, error: "Unauthorized" }),
    gate: (req, res, next) => { req.userId = req.header("x-test-user") || "u1"; next(); },
  }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = `http://127.0.0.1:${server.address().port}/api/sms-forward`;

  const call = async (method, path, body, user = "u1") => {
    const res = await fetch(`${root}${path}`, {
      method, headers: { "content-type": "application/json", "x-test-user": user }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const hook = async (publicId, secret, text, { sender, type = "text/plain; charset=utf-8" } = {}) => {
    const res = await fetch(`${root}/hook/${publicId}`, {
      method: "POST", headers: { "content-type": type, ...(secret ? { "x-sms-secret": secret } : {}), ...(sender ? { "x-sms-sender": sender } : {}) }, body: text,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const logRows = async (n, status) => {
    for (let i = 0; i < 60; i++) {
      const { rows } = await pool.query(`SELECT * FROM sms_forward_log ${status ? "WHERE status = $1" : ""} ORDER BY received_at`, status ? [status] : []);
      if (rows.length >= n) return rows;
      await new Promise((r) => setTimeout(r, 25));
    }
    return (await pool.query(`SELECT * FROM sms_forward_log`)).rows;
  };

  try {
    await fn({ pool, call, hook, sent, ubSent, state, logRows });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

const TOKEN = "111111:" + "A".repeat(35);

async function setup(call) {
  const acc = await call("POST", "/account");
  assert.equal(acc.status, 201);
  assert.match(acc.body.secret, /^irfsmf_/);
  return { publicId: acc.body.account.publicId, secret: acc.body.secret };
}

test("زنده: یک وبهوک برای کلِ اکانت؛ ساخت دوباره ۴۰۹؛ secret فقط یک‌بار", live, async () => {
  await withEnv(async ({ call, pool }) => {
    const { publicId, secret } = await setup(call);
    assert.equal((await call("POST", "/account")).status, 409);
    const ov = await call("GET", "/overview");
    assert.equal(ov.body.account.webhookPath, `/api/sms-forward/hook/${publicId}`);
    assert.equal(JSON.stringify(ov.body).includes(secret), false, "secret در overview نیست");
    const { rows } = await pool.query("SELECT secret_hash FROM sms_forward_accounts");
    assert.equal(rows[0].secret_hash, hashForwardSecret(secret));
    // چرخش: secret قدیمی بی‌اثر
    const rot = await call("POST", "/account/rotate-secret");
    assert.notEqual(rot.body.secret, secret);
  });
});

test("زنده: احراز؛ secret غلط/اکانت ناموجود هر دو ۴۰۱ یکسان", live, async () => {
  await withEnv(async ({ call, hook }) => {
    const { publicId, secret } = await setup(call);
    const a = await hook(publicId, "irfsmf_nope", "hello");
    const b = await hook("smf_000000000000000000", secret, "hello");
    const c = await hook(publicId, "", "hello");
    assert.deepEqual([a.status, b.status, c.status], [401, 401, 401]);
    assert.deepEqual(a.body, b.body);
  });
});

test("زنده: پیام عیناً به مقصد می‌رسد (توکنِ رمزگشایی‌شده)، لاگ بدونِ متن", live, async () => {
  await withEnv(async ({ call, hook, sent, logRows, pool }) => {
    const { publicId, secret } = await setup(call);
    assert.equal((await call("PUT", "/bot", { token: TOKEN })).body.username, "my_sms_bot");
    const { rows: enc } = await pool.query("SELECT bot_token_enc FROM sms_forward_accounts");
    assert.notEqual(enc[0].bot_token_enc, TOKEN, "توکن رمزنگاری شده ذخیره می‌شود");
    assert.equal((await call("POST", "/rules", { name: "همه", chatRef: "@sms_inbox", via: "bot" })).status, 201);

    const text = "بلو\nواریز پول\n۱٬۰۰۰٬۰۰۰ ریال\n<b>x</b> & y";
    const r = await hook(publicId, secret, text, { sender: "Blubank" });
    assert.equal(r.status, 202); assert.equal(r.body.matched, 1);
    const rows = await logRows(1);
    assert.equal(rows[0].status, "sent"); assert.equal(rows[0].via, "bot");
    assert.deepEqual(sent, [{ token: TOKEN, chat: "@sms_inbox", text }]);
    assert.equal(JSON.stringify(rows).includes("واریز"), false, "متنِ پیامک در لاگ ذخیره نمی‌شود");
    assert.equal(rows[0].text_len, text.length);
  });
});

test("زنده: یک وبهوک، چند مقصد (فیلترِ فرستنده/کلمه)", live, async () => {
  await withEnv(async ({ call, hook, sent, logRows }) => {
    const { publicId, secret } = await setup(call);
    await call("PUT", "/bot", { token: TOKEN });
    await call("POST", "/rules", { name: "بانک", chatRef: "@bank_chan", senderFilter: ["Blubank"] });
    await call("POST", "/rules", { name: "کد", chatRef: "-1001111111111", keyword: "کد تایید" });
    await call("POST", "/rules", { name: "همه", chatRef: "@everything" });

    await hook(publicId, secret, "واریز پول", { sender: "Blubank" });
    await logRows(2);
    assert.deepEqual(sent.map((s) => s.chat).sort(), ["@bank_chan", "@everything"]);
    sent.length = 0;
    await hook(publicId, secret, "کد تایید شما 12345", { sender: "Other" });
    await logRows(4);
    assert.deepEqual(sent.map((s) => s.chat).sort(), ["-1001111111111", "@everything"]);
  });
});

test("زنده: retry در ۶۰ ثانیه تکراری نمی‌رود؛ بعد از شکست retry مجاز است", live, async () => {
  await withEnv(async ({ call, hook, sent, state, logRows }) => {
    const { publicId, secret } = await setup(call);
    await call("PUT", "/bot", { token: TOKEN });
    await call("POST", "/rules", { name: "r", chatRef: "@sms_inbox" });

    state.botFails = 1;
    await hook(publicId, secret, "msg-1", { sender: "S" });
    await logRows(1, "failed");
    const retry = await hook(publicId, secret, "msg-1", { sender: "S" });
    assert.equal(retry.status, 202, "ارسالِ قبلی شکست خورده بود → retry مجاز");
    await logRows(1, "sent");
    assert.equal(sent.length, 1);

    const dup = await hook(publicId, secret, "msg-1", { sender: "S" });
    assert.equal(dup.body.duplicate, true);
    assert.equal(sent.length, 1, "تکراری ارسال نشد");
    assert.equal((await logRows(1, "duplicate")).length, 1);
  });
});

test("زنده: ۵ درخواستِ همزمانِ یک پیامک فقط یک‌بار ارسال می‌شود (race)", live, async () => {
  await withEnv(async ({ call, hook, sent, state, logRows }) => {
    const { publicId, secret } = await setup(call);
    await call("PUT", "/bot", { token: TOKEN });
    await call("POST", "/rules", { name: "r", chatRef: "@sms_inbox" });

    state.botDelay = 150; // لاگِ sent دیر نوشته می‌شود؛ همین پنجره باگِ قبلی بود
    const rs = await Promise.all(Array.from({ length: 5 }, () => hook(publicId, secret, "واریز ۱۰۰", { sender: "S" })));
    assert.equal(rs.filter((r) => r.status === 202).length, 1, "فقط یک درخواست ارسال می‌کند");
    assert.equal(rs.filter((r) => r.body?.duplicate === true).length, 4);
    await logRows(1, "sent");
    assert.equal(sent.length, 1, "پیامک یک‌بار رفت");
  });
});

test("زنده: بدونِ قانون → no_rule؛ اکانتِ غیرفعال → ۴۰۳؛ متنِ خالی → ۴۰۰", live, async () => {
  await withEnv(async ({ call, hook, logRows }) => {
    const { publicId, secret } = await setup(call);
    const none = await hook(publicId, secret, "x");
    assert.equal(none.status, 200); assert.equal(none.body.matched, 0);
    assert.equal((await logRows(1))[0].status, "no_rule");
    assert.equal((await hook(publicId, secret, "   ")).status, 400);
    await call("PATCH", "/account", { enabled: false });
    assert.equal((await hook(publicId, secret, "x")).status, 403);
  });
});

test("زنده: مسیر «هر دو» = failover (اول اکانتِ شخصی، بعد بات)", live, async () => {
  const failingUb = { available: () => true, startLogin: async () => ({}), completeLogin: async () => ({ session: "S", label: "@u" }),
    cancelLogin: async () => {}, send: async () => ({ ok: false, error: "نشستِ اکانت منقضی شده" }), logout: async () => {} };
  await withEnv(async ({ call, hook, sent, logRows }) => {
    const { publicId, secret } = await setup(call);
    await call("PUT", "/bot", { token: TOKEN });
    assert.equal((await call("POST", "/userbot/verify", { code: "12345" })).body.label, "@u");
    await call("POST", "/rules", { name: "both", chatRef: "@sms_inbox", via: "both" });
    await hook(publicId, secret, "hello", { sender: "S" });
    const rows = await logRows(1);
    assert.equal(rows[0].status, "sent"); assert.equal(rows[0].via, "bot");
    assert.equal(sent.length, 1);
  }, { userbot: failingUb });
});

test("زنده: اکانتِ شخصی — ورود، رمزِ دومرحله‌ای، کدِ اشتباه، ارسال با سشنِ رمزگشایی‌شده", live, async () => {
  await withEnv(async ({ call, hook, ubSent, logRows, pool }) => {
    const { publicId, secret } = await setup(call);
    assert.equal((await call("POST", "/userbot/send-code", { phone: "+989120000000" })).body.ok, true);
    assert.equal((await call("POST", "/userbot/verify", { code: "00000" })).status, 400);
    const pw = await call("POST", "/userbot/verify", { code: "22222" });
    assert.equal(pw.status, 200); assert.equal(pw.body.passwordNeeded, true);
    assert.equal((await call("POST", "/userbot/verify", { code: "22222", password: "pw" })).body.label, "@me_user");
    const { rows: enc } = await pool.query("SELECT userbot_session_enc FROM sms_forward_accounts");
    assert.notEqual(enc[0].userbot_session_enc, "SESSION-STRING");

    await call("POST", "/rules", { name: "saved", chatRef: "me", via: "userbot" });
    await hook(publicId, secret, "hi", { sender: "S" });
    await logRows(1);
    assert.deepEqual(ubSent, [{ session: "SESSION-STRING", chat: "me", text: "hi" }]);
  });
});

test("زنده: حداقل یک مسیر الزامی است؛ قانون برایِ مسیرِ وصل‌نشده رد می‌شود", live, async () => {
  await withEnv(async ({ call }) => {
    await setup(call);
    assert.equal((await call("POST", "/rules", { name: "r", chatRef: "@abcde", via: "bot" })).body.code, "sender_missing");
    assert.equal((await call("POST", "/rules", { name: "r", chatRef: "@abcde", via: "both" })).body.code, "sender_missing");
    await call("PUT", "/bot", { token: TOKEN });
    assert.equal((await call("POST", "/rules", { name: "r", chatRef: "@abcde", via: "userbot" })).body.code, "sender_missing");
    assert.equal((await call("POST", "/rules", { name: "r", chatRef: "@abcde", via: "bot" })).status, 201);
    // مسیری که یک قانونِ فعالِ bot-only به آن وابسته است برداشته نمی‌شود، حتی اگر مسیرِ دیگر وصل باشد
    const del = await call("DELETE", "/bot");
    assert.equal(del.status, 400); assert.equal(del.body.code, "last_sender");
    await call("POST", "/userbot/verify", { code: "12345" });
    assert.equal((await call("DELETE", "/bot")).status, 400, "bot-only هنوز وابسته است");
    const rules = (await call("GET", "/overview")).body.rules;
    await call("PATCH", `/rules/${rules.find((r) => r.via === "bot").id}`, { enabled: false });
    assert.equal((await call("DELETE", "/bot")).status, 200, "قانونِ وابسته غیرفعال شد → مجاز");
    // قانونِ «هر دو» با وجودِ اکانتِ شخصی به بات وابسته نیست؛ ولی برداشتنِ اکانتِ شخصیِ آخر ممنوع است
    await call("POST", "/rules", { name: "both", chatRef: "me", via: "both" });
    const lastUb = await call("DELETE", "/userbot");
    assert.equal(lastUb.status, 400); assert.equal(lastUb.body.code, "last_sender");
  });
});

test("زنده: توکنِ نامعتبر رد می‌شود؛ تست ارسال؛ سقفِ ۲۰ قانون؛ ایزولاسیونِ کاربرها", live, async () => {
  await withEnv(async ({ call, sent }) => {
    await setup(call);
    assert.equal((await call("PUT", "/bot", { token: "garbage" })).status, 400);
    assert.equal((await call("PUT", "/bot", { token: "222222:" + "B".repeat(35) })).status, 400, "getMe رد کرد");
    await call("PUT", "/bot", { token: TOKEN });
    const rule = (await call("POST", "/rules", { name: "r0", chatRef: "@abcde" })).body.rule;
    const t = await call("POST", `/rules/${rule.id}/test`);
    assert.equal(t.body.ok, true); assert.equal(sent.length, 1); assert.match(sent[0].text, /تست/);
    for (let i = 1; i < 20; i++) assert.equal((await call("POST", "/rules", { name: `r${i}`, chatRef: "@abcde" })).status, 201);
    assert.equal((await call("POST", "/rules", { name: "r20", chatRef: "@abcde" })).body.code, "too_many");

    // کاربرِ دیگر نه قانون‌ها را می‌بیند و نه می‌تواند دست بزند
    const other = await call("GET", "/overview", null, "u2");
    assert.equal(other.body.account, null); assert.deepEqual(other.body.rules, []);
    assert.equal((await call("DELETE", `/rules/${rule.id}`, null, "u2")).status, 404);
    assert.equal((await call("PATCH", `/rules/${rule.id}`, { name: "hack" }, "u2")).status, 404);
  });
});

test("زنده: حذفِ اکانت همه‌چیز را پاک می‌کند", live, async () => {
  await withEnv(async ({ call, hook, pool, logRows }) => {
    const { publicId, secret } = await setup(call);
    await call("PUT", "/bot", { token: TOKEN });
    await call("POST", "/rules", { name: "r", chatRef: "@abcde" });
    await hook(publicId, secret, "x"); await logRows(1);
    assert.equal((await call("DELETE", "/account")).status, 200);
    for (const t of ["sms_forward_accounts", "sms_forward_rules", "sms_forward_log"]) {
      assert.equal((await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n, 0, t);
    }
    assert.equal((await hook(publicId, secret, "x")).status, 401);
  });
});

test("زنده: محدودیتِ نرخِ وبهوک → ۴۲۹", live, async () => {
  // فقط کلیدِ وبهوک (smsfwd-ip) بسته است؛ مدیریت آزاد می‌ماند.
  await withEnv(async ({ call, hook }) => {
    const { publicId, secret } = await setup(call);
    const r = await hook(publicId, secret, "x");
    assert.equal(r.status, 429);
  }, { hitFn: async (key) => (String(key).startsWith("smsfwd-ip") ? { allowed: false, retryAfterSeconds: 7 } : { allowed: true, retryAfterSeconds: 0 }) });
});
