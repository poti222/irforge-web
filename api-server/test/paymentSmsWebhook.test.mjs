/**
 * test/paymentSmsWebhook.test.mjs — فاز ۳ کارت‌به‌کارتِ خودکار: وبهوکِ پیامک
 * (`routes/paymentSmsWebhook.ts` + `lib/smsIngest.ts`).
 *
 * معیارِ اتمامِ فاز ۳: تست‌های parser پاس؛ ارسالِ دوبارِ یک پیامک فقط یک ردیف
 * می‌سازد؛ secretِ اشتباه = ۴۰۱.
 *
 * بخشِ خالص همیشه اجرا می‌شود؛ بخشِ زنده (express واقعی + Postgres واقعی) فقط با
 * `CARD_TEST_PG_URL` — هر تست schemaِ موقتِ خودش را می‌سازد و می‌اندازد.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";

const ingest = await import("../src/lib/smsIngest.ts");
const { canonSender, senderAllowed, parseSmsTime, smsContentHash, hasEmbeddedTimestamp, ingestSms, IGNORED_TEXT_PLACEHOLDER, HASH_BUCKET_MS } = ingest;
const { createPaymentRequest } = await import("../src/lib/paymentRequests.ts");
const effects = await import("../src/lib/paymentEffects.ts");
const { createPaymentSmsRouter, SMS_IP_LIMIT_PER_MIN } = await import("../src/routes/paymentSmsWebhook.ts");
const { generateSmsSecret, hashSmsSecret } = await import("../src/lib/smsChannelSecret.ts");

const NOW = new Date("2026-09-29T12:00:00.000Z");

// ─── خالص ───────────────────────────────────────────────────────────────────

test("canonSender: شماره‌ها یکسان‌سازی می‌شوند، نام‌ها lower-case", () => {
  assert.equal(canonSender("+98 912 000 0000"), "9120000000");
  assert.equal(canonSender("09120000000"), "9120000000");
  assert.equal(canonSender("۰۹۱۲۰۰۰۰۰۰۰"), "9120000000");
  assert.equal(canonSender("0098-912-000-0000"), "9120000000");
  assert.equal(canonSender("Blubank"), "blubank");
  assert.equal(canonSender(null), "");
});

test("senderAllowed: allowlistِ خالی = همه؛ غیرِ خالی = فقط اعضا (و فرستنده‌ی خالی رد می‌شود)", () => {
  assert.equal(senderAllowed([], "anyone"), true);
  assert.equal(senderAllowed([], null), true);
  assert.equal(senderAllowed(["+98100011"], "0100011"), true, "+98 و 0 ابتدایی یکسان‌اند");
  assert.equal(senderAllowed(["Blubank"], "BLUBANK"), true);
  assert.equal(senderAllowed(["Blubank"], "other"), false);
  assert.equal(senderAllowed(["Blubank"], null), false);
  assert.equal(senderAllowed(["Blubank"], ""), false);
});

test("parseSmsTime: ISO/epoch معتبر؛ آینده‌ی دور، گذشته‌ی دور و آشغال → null", () => {
  assert.equal(parseSmsTime("2026-09-29T11:58:00Z", NOW)?.toISOString(), "2026-09-29T11:58:00.000Z");
  assert.equal(parseSmsTime(Math.floor(NOW.getTime() / 1000) - 60, NOW)?.getTime(), NOW.getTime() - 60_000);
  assert.equal(parseSmsTime(String(NOW.getTime() - 1000), NOW)?.getTime(), NOW.getTime() - 1000);
  assert.equal(parseSmsTime("2026-09-29T13:00:00Z", NOW), null, "یک ساعت در آینده");
  assert.equal(parseSmsTime("2026-09-01T00:00:00Z", NOW), null, "بیش از ۷ روز قبل");
  assert.equal(parseSmsTime("garbage", NOW), null);
  assert.equal(parseSmsTime(undefined, NOW), null);
  assert.equal(parseSmsTime("", NOW), null);
});

test("smsContentHash: کانال/فرستنده/متن/زمان هرکدام در هش اثر دارند؛ سطلِ ۵دقیقه‌ای بدونِ زمانِ ارائه‌شده", () => {
  const t = new Date("2026-09-29T11:58:00Z");
  const base = smsContentHash("ch1", "متن", "bank", t, NOW);
  assert.equal(base, smsContentHash("ch1", "متن", "BANK", t, new Date(NOW.getTime() + 999_999_999)), "با زمانِ ارائه‌شده، زمانِ ورود بی‌اثر است");
  assert.notEqual(base, smsContentHash("ch2", "متن", "bank", t, NOW));
  assert.notEqual(base, smsContentHash("ch1", "متن۲", "bank", t, NOW));
  assert.notEqual(base, smsContentHash("ch1", "متن", "other", t, NOW));
  assert.notEqual(base, smsContentHash("ch1", "متن", "bank", new Date(t.getTime() + 1000), NOW));
  const bucketStart = Math.floor(NOW.getTime() / HASH_BUCKET_MS) * HASH_BUCKET_MS;
  const a = smsContentHash("ch1", "متن", "bank", null, new Date(bucketStart + 1000));
  const b = smsContentHash("ch1", "متن", "bank", null, new Date(bucketStart + HASH_BUCKET_MS - 1000));
  const c = smsContentHash("ch1", "متن", "bank", null, new Date(bucketStart + HASH_BUCKET_MS + 1000));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("hasEmbeddedTimestamp: فقط وقتی هم ساعت هم تاریخ در متن باشد (بلوبانک آری؛ متنِ ساده نه)", () => {
  assert.equal(hasEmbeddedTimestamp("واریز 100 ریال\n21:11\n1405.06.08"), true);
  assert.equal(hasEmbeddedTimestamp("واریز 100 ریال 21:11 1405/06/08"), true);
  assert.equal(hasEmbeddedTimestamp("واریز 100 ریال 21:11"), false, "فقط ساعت");
  assert.equal(hasEmbeddedTimestamp("واریز 100 ریال 1405.06.08"), false, "فقط تاریخ");
  assert.equal(hasEmbeddedTimestamp("واریز 1,000,000 ریال موجودی 2,500,000 ریال"), false, "مبلغ‌ها تاریخ نیستند");
  assert.equal(hasEmbeddedTimestamp(""), false);
});

test("smsContentHash: متنِ دارای ساعت+تاریخ و بدونِ زمانِ forwarder → مستقل از زمانِ ورود؛ متنِ ساده هنوز سطل‌دار", () => {
  const withTs = "واریز 100 ریال\n21:11\n1405.06.08";
  const a = smsContentHash("c", withTs, "b", null, NOW);
  const b = smsContentHash("c", withTs, "b", null, new Date(NOW.getTime() + 3 * 3600_000));
  assert.equal(a, b);
  const plain = "واریز 100 ریال";
  assert.notEqual(smsContentHash("c", plain, "b", null, NOW), smsContentHash("c", plain, "b", null, new Date(NOW.getTime() + 3 * 3600_000)));
  // زمانِ ارائه‌شده‌ی forwarder همچنان اولویت دارد
  const t1 = new Date(NOW.getTime() - 60_000), t2 = new Date(NOW.getTime() - 120_000);
  assert.notEqual(smsContentHash("c", withTs, "b", t1, NOW), smsContentHash("c", withTs, "b", t2, NOW));
});

test("مسیرِ قدیمیِ /internal/wallet-topup/sms-webhook دست‌نخورده و مسیرِ جدید ثبت شده است", () => {
  const routes = fs.readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  assert.match(routes, /paymentSmsWebhookRouter/);
  const legacy = fs.readFileSync(new URL("../src/routes/walletTopupSmsWebhook.ts", import.meta.url), "utf8");
  assert.match(legacy, /sms-webhook/);
});

test("منبعِ وبهوک: متنِ پیامک و secret هرگز وارِدِ لاگ نمی‌شوند", () => {
  const src = fs.readFileSync(new URL("../src/routes/paymentSmsWebhook.ts", import.meta.url), "utf8");
  const logCalls = [...src.matchAll(/logger\.(?:info|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(logCalls.length >= 2);
  for (const c of logCalls) {
    assert.doesNotMatch(c, /\btext\b|\bsecret\b|\bbody\b|rawText/, c);
  }
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };

let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const mirror = fs.readFileSync(new URL("../../lib/db/migrations/0029_card_autoconfirm.sql", import.meta.url), "utf8");
const ddl = mirror.slice(mirror.indexOf("-- ─── CARD_AUTOCONFIRM"));

async function withEnv(fn, { hitFn } = {}) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p3_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 10, options: `-c search_path=${schema}` });
  await pool.query(ddl);

  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true, limit: "256kb" }));
  app.use("/api", createPaymentSmsRouter({ pool, hitFn: hitFn ?? (async () => ({ allowed: true, retryAfterSeconds: 0 })) }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/payments/sms`;

  try {
    await fn({ pool, base });
  } finally {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

let n = 0;
async function channel(pool, { active = true, allowlist = [], parser = "blubank", secret = generateSmsSecret() } = {}) {
  const id = `ch_${++n}`;
  await pool.query(
    `INSERT INTO payment_channels (id, scope, kind, card_number_enc, sms_secret_hash, active, sender_allowlist, bank_parser)
     VALUES ($1,'platform','card_manual','enc',$2,$3,$4,$5)`,
    [id, hashSmsSecret(secret), active, allowlist, parser],
  );
  return { id, secret };
}

const DEPOSIT = "بلو\nواریز پول\n فاطمه عزیز، 2,768,654 ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸";
const WITHDRAW = "بلو\nبرداشت پول\n فاطمه عزیز، 500,000 ریال از حساب شما برداشت شد.\n موجودی: 100,000 ریال";

async function post(base, ch, body, { secret, headers = {}, contentType = "application/json", raw = false } = {}) {
  const res = await fetch(`${base}/${ch}`, {
    method: "POST",
    headers: { "content-type": contentType, ...(secret === undefined ? {} : { "x-sms-secret": secret }), ...headers },
    body: raw ? body : contentType.includes("json") ? JSON.stringify(body) : body,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const inbox = (pool) => pool.query("SELECT * FROM sms_inbox ORDER BY ingested_at").then((r) => r.rows);

test("secretِ اشتباه = ۴۰۱ و چیزی ذخیره نمی‌شود؛ پاسخِ کانالِ ناموجود عیناً همان است", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const wrong = await post(base, id, { text: DEPOSIT }, { secret: secret + "x" });
    const unknownCh = await post(base, "ch_nope", { text: DEPOSIT }, { secret });
    const noSecret = await post(base, id, { text: DEPOSIT });
    assert.equal(wrong.status, 401);
    assert.equal(unknownCh.status, 401);
    assert.equal(noSecret.status, 401);
    assert.deepEqual(wrong.json, unknownCh.json);
    assert.deepEqual(wrong.json, noSecret.json);
    assert.equal((await inbox(pool)).length, 0);
    assert.equal((await pool.query("SELECT last_sms_at FROM payment_channels WHERE id=$1", [id])).rows[0].last_sms_at, null);
  }));

test("secretِ کانالِ دیگر در این کانال کار نمی‌کند (secret به‌ازای کانال)", live, () =>
  withEnv(async ({ pool, base }) => {
    const a = await channel(pool);
    const b = await channel(pool);
    assert.equal((await post(base, a.id, { text: DEPOSIT }, { secret: b.secret })).status, 401);
    assert.equal((await post(base, a.id, { text: DEPOSIT }, { secret: a.secret })).status, 201);
  }));

test("Authorization: Bearer هم پذیرفته می‌شود", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const r = await post(base, id, { text: DEPOSIT }, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(r.status, 201);
  }));

test("ارسالِ دوبارِ یک پیامک فقط یک ردیف می‌سازد (۲۰۱ سپس ۲۰۰ duplicate)", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const time = new Date(Date.now() - 60_000).toISOString();
    const r1 = await post(base, id, { text: DEPOSIT, sender: "Blubank", time }, { secret });
    const r2 = await post(base, id, { text: DEPOSIT, sender: "Blubank", time }, { secret });
    assert.equal(r1.status, 201);
    assert.equal(r1.json.duplicate, false);
    assert.equal(r2.status, 200);
    assert.equal(r2.json.duplicate, true);
    const rows = await inbox(pool);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].direction, "deposit");
    assert.equal(Number(rows[0].amount_rial), 2_768_654);
    assert.equal(Number(rows[0].balance_rial), 9_999_999);
    assert.equal(rows[0].parsed_ok, true);
    assert.equal(rows[0].status, "unmatched");
  }));

test("۱۰ ارسالِ هم‌زمانِ همان پیامک → دقیقاً یک ردیف", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const time = new Date(Date.now() - 30_000).toISOString();
    const rs = await Promise.all(Array.from({ length: 10 }, () => post(base, id, { text: DEPOSIT, time }, { secret })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal(rs.filter((r) => r.status === 200).length, 9);
    assert.equal((await inbox(pool)).length, 1);
  }));

test("همان متن با زمانِ متفاوت = دو واریزِ جدا (گم نمی‌شود)", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const t1 = new Date(Date.now() - 3_600_000).toISOString();
    const t2 = new Date(Date.now() - 60_000).toISOString();
    assert.equal((await post(base, id, { text: DEPOSIT, time: t1 }, { secret })).status, 201);
    assert.equal((await post(base, id, { text: DEPOSIT, time: t2 }, { secret })).status, 201);
    assert.equal((await inbox(pool)).length, 2);
  }));

test("همان پیامک در دو کانالِ مختلف: دو ردیفِ مستقل (یکتایی به‌ازای کانال)", live, () =>
  withEnv(async ({ pool, base }) => {
    const a = await channel(pool);
    const b = await channel(pool);
    const time = new Date(Date.now() - 60_000).toISOString();
    assert.equal((await post(base, a.id, { text: DEPOSIT, time }, { secret: a.secret })).status, 201);
    assert.equal((await post(base, b.id, { text: DEPOSIT, time }, { secret: b.secret })).status, 201);
    assert.equal((await inbox(pool)).length, 2);
  }));

test("allowlist: فرستنده‌ی غیرمجاز → ignored و متنِ پیامک ذخیره نمی‌شود", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool, { allowlist: ["Blubank"] });
    const priv = "سلام، کارت من 6037-1234-5678-9012 است؛ رمز 55667788";
    const r = await post(base, id, { text: priv, sender: "+989121234567" }, { secret });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "ignored");
    const rows = await inbox(pool);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "ignored");
    assert.equal(rows[0].raw_text, IGNORED_TEXT_PLACEHOLDER);
    assert.ok(!rows[0].raw_text.includes("6037"));
    assert.equal(rows[0].parsed_ok, false);
    // فرستنده‌ی مجاز → پارس و ذخیره‌ی متن
    const ok = await post(base, id, { text: DEPOSIT, sender: "blubank" }, { secret });
    assert.equal(ok.json.status, "unmatched");
    assert.equal(ok.json.parsed, true);
    // واریزِ ظاهراً معتبر از فرستنده‌ی غیرمجاز هرگز deposit/parsed نمی‌شود
    const spoof = await post(base, id, { text: DEPOSIT, sender: "+989000000000" }, { secret });
    assert.equal(spoof.json.status, "ignored");
    assert.equal(spoof.json.parsed, false);
    const spoofRow = (await inbox(pool)).find((x) => x.sender === "+989000000000");
    assert.equal(spoofRow.direction, "unknown");
    assert.equal(spoofRow.amount_rial, null);
  }));

test("برداشت → ignored؛ پیامکِ نامفهوم → unmatched با parsed_ok=false", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const w = await post(base, id, { text: WITHDRAW }, { secret });
    assert.equal(w.status, 201);
    assert.equal(w.json.status, "ignored");
    assert.equal(w.json.direction, "withdraw");
    const u = await post(base, id, { text: "کد ورود شما: 123456" }, { secret });
    assert.equal(u.json.status, "unmatched");
    assert.equal(u.json.parsed, false);
    const rows = await inbox(pool);
    const unk = rows.find((r) => r.raw_text.includes("123456"));
    assert.equal(unk.parsed_ok, false);
    assert.equal(unk.direction, "unknown");
    assert.equal(unk.matched_request_id, null);
  }));

test("کانالِ غیرفعال (با secretِ درست) → ۴۰۳ و ذخیره نمی‌شود", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool, { active: false });
    const r = await post(base, id, { text: DEPOSIT }, { secret });
    assert.equal(r.status, 403);
    assert.equal((await inbox(pool)).length, 0);
    // secretِ غلط روی کانالِ غیرفعال هنوز ۴۰۱ است (وضعیتِ کانال لو نمی‌رود)
    assert.equal((await post(base, id, { text: DEPOSIT }, { secret: "x" })).status, 401);
  }));

test("متنِ خالی/بدونِ متن → ۴۰۰", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    assert.equal((await post(base, id, {}, { secret })).status, 400);
    assert.equal((await post(base, id, { text: "   " }, { secret })).status, 400);
    assert.equal((await post(base, id, { text: "" }, { secret })).status, 400);
    assert.equal((await inbox(pool)).length, 0);
  }));

test("قالب‌های بدنه: text/plain، x-www-form-urlencoded و نام‌های معادل (message/from/timestamp)", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const plain = await post(base, id, DEPOSIT, { secret, contentType: "text/plain; charset=utf-8" });
    assert.equal(plain.status, 201);
    assert.equal(plain.json.parsed, true);

    const form = new URLSearchParams({ message: WITHDRAW, from: "Blubank" }).toString();
    const f = await post(base, id, form, { secret, contentType: "application/x-www-form-urlencoded" });
    assert.equal(f.status, 201);
    assert.equal(f.json.direction, "withdraw");

    const alias = await post(base, id, { sms: DEPOSIT.replace("2,768,654", "1,111,110"), address: "Blubank", timestamp: Math.floor(Date.now() / 1000) - 5 }, { secret });
    assert.equal(alias.status, 201);
    const rows = await inbox(pool);
    assert.equal(rows.length, 3);
    assert.ok(rows.some((r) => Number(r.amount_rial) === 1_111_110 && r.sender === "Blubank"));
  }));

test("زمانِ ارائه‌شده ذخیره می‌شود؛ زمانِ نامعتبر/آینده‌ی دور به زمانِ ورود برمی‌گردد", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const t = new Date(Date.now() - 120_000);
    await post(base, id, { text: DEPOSIT, time: t.toISOString() }, { secret });
    const far = new Date(Date.now() + 86_400_000).toISOString();
    await post(base, id, { text: WITHDRAW, time: far }, { secret });
    const rows = await inbox(pool);
    const dep = rows.find((r) => r.direction === "deposit");
    assert.equal(new Date(dep.received_at).getTime(), t.getTime());
    const wd = rows.find((r) => r.direction === "withdraw");
    assert.ok(Math.abs(new Date(wd.received_at).getTime() - Date.now()) < 30_000, "آینده‌ی دور نباید received_at شود");
  }));

test("last_sms_at با هر پستِ احرازشده به‌روز می‌شود (حتی تکراری) و عقب نمی‌رود", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const time = new Date(Date.now() - 60_000).toISOString();
    await post(base, id, { text: DEPOSIT, time }, { secret });
    const a = (await pool.query("SELECT last_sms_at FROM payment_channels WHERE id=$1", [id])).rows[0].last_sms_at;
    assert.ok(a);
    await new Promise((r) => setTimeout(r, 30));
    await post(base, id, { text: DEPOSIT, time }, { secret });
    const b = (await pool.query("SELECT last_sms_at FROM payment_channels WHERE id=$1", [id])).rows[0].last_sms_at;
    assert.ok(new Date(b) > new Date(a));
  }));

test("rate limit: به‌ازای IP پیش از احراز و به‌ازای کانال پس از آن → ۴۲۹", live, async () => {
  const seen = [];
  let denyPrefix = null;
  const hitFn = async (key) => {
    seen.push(key);
    return denyPrefix && key.startsWith(denyPrefix) ? { allowed: false, retryAfterSeconds: 7 } : { allowed: true, retryAfterSeconds: 0 };
  };
  await withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    denyPrefix = "sms-ip:";
    const a = await post(base, id, { text: DEPOSIT }, { secret });
    assert.equal(a.status, 429);
    assert.ok(!seen.some((k) => k.startsWith("sms-ch:")), "کانال پیش از عبور از IP-limit نباید شمرده شود");
    assert.equal((await inbox(pool)).length, 0);

    denyPrefix = "sms-ch:";
    const b = await post(base, id, { text: DEPOSIT }, { secret });
    assert.equal(b.status, 429);
    assert.equal((await inbox(pool)).length, 0);

    // secretِ غلط فقط IP-limit را مصرف می‌کند نه سهمیه‌ی کانال (وگرنه مهاجم می‌تواند کانال را قفل کند)
    seen.length = 0;
    denyPrefix = null;
    const c = await post(base, id, { text: DEPOSIT }, { secret: "wrong" });
    assert.equal(c.status, 401);
    assert.ok(seen.every((k) => k.startsWith("sms-ip:")));
  }, { hitFn });
  assert.ok(SMS_IP_LIMIT_PER_MIN > 0);
});

test("ورودی‌های بدشکل: شناسه‌ی کانالِ عجیب → ۴۰۱؛ متنِ بسیار بلند بریده می‌شود", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    const weird = await fetch(`${base}/${encodeURIComponent("x' OR 1=1 --")}`, {
      method: "POST", headers: { "content-type": "application/json", "x-sms-secret": secret }, body: JSON.stringify({ text: DEPOSIT }),
    });
    assert.equal(weird.status, 401);
    const long = "واریز ".repeat(2000);
    const r = await post(base, id, { text: long }, { secret });
    assert.equal(r.status, 201);
    const row = (await inbox(pool))[0];
    assert.ok(row.raw_text.length <= 2000);
  }));

test("retryِ دیرهنگامِ همان پیامکِ بلوبانک بدونِ زمانِ forwarder → تکراری (نه ردیفِ تازه)؛ متنِ بی‌ساعت → ردیفِ تازه", live, () =>
  withEnv(async ({ pool }) => {
    const { id } = await channel(pool);
    const ch = { id, scope: "platform", botId: null, active: true, senderAllowlist: [], bankParser: "blubank" };
    const t1 = new Date();
    const t2 = new Date(t1.getTime() + 3 * 3600_000);
    const first = await ingestSms(pool, ch, { text: DEPOSIT }, t1);
    const retry = await ingestSms(pool, ch, { text: DEPOSIT }, t2);
    assert.equal(first.inserted, true);
    assert.equal(retry.inserted, false);
    const plain = "واریز 1,000,000 ریال";
    assert.equal((await ingestSms(pool, ch, { text: plain }, t1)).inserted, true);
    assert.equal((await ingestSms(pool, ch, { text: plain }, t2)).inserted, true);
    assert.equal((await inbox(pool)).length, 3);
  }));

test("وبهوک ← موتورِ تطبیق: واریزِ هم‌مبلغ → matched:true و درخواست confirmed؛ ارسالِ تکراری بی‌اثر", live, () =>
  withEnv(async ({ pool, base }) => {
    const calls = [];
    effects.clearPaymentEffects();
    effects.registerPaymentEffect("platform", "wallet_topup", async (_c, req) => { calls.push(req.id); });
    try {
      const { id, secret } = await channel(pool);
      const { request } = await createPaymentRequest(pool, {
        channelId: id, channelScope: { scope: "platform" }, userId: "u1", purpose: "wallet_topup", baseAmountRial: 2_000_000,
      });
      const text = DEPOSIT.replace("2,768,654", request.finalAmountRial.toLocaleString("en-US"));
      const time = new Date().toISOString();
      const r1 = await post(base, id, { text, sender: "Blubank", time }, { secret });
      assert.equal(r1.status, 201);
      assert.equal(r1.json.matched, true);
      const req = (await pool.query("SELECT status, confirmed_by, matched_sms_id FROM payment_requests WHERE id=$1", [request.id])).rows[0];
      assert.deepEqual([req.status, req.confirmed_by], ["confirmed", "sms"]);
      assert.ok(req.matched_sms_id);
      const r2 = await post(base, id, { text, sender: "Blubank", time }, { secret });
      assert.equal(r2.status, 200);
      assert.equal(r2.json.matched, false);
      assert.deepEqual(calls, [request.id], "effect دقیقاً یک‌بار");
      // پیامکِ بی‌ربط (مبلغِ دیگر) matched:false و چیزی تأیید نمی‌شود
      const other = await post(base, id, { text: DEPOSIT, sender: "Blubank", time: new Date(Date.now() - 1000).toISOString() }, { secret });
      assert.equal(other.status, 201);
      assert.equal(other.json.matched, false);
      assert.equal(calls.length, 1);
    } finally {
      effects.clearPaymentEffects();
    }
  }));

test("خطای موتورِ تطبیق پاسخِ وبهوک را خراب نمی‌کند: ۲۰۱ با matched:false و پیامک unmatched می‌ماند", live, () =>
  withEnv(async ({ pool, base }) => {
    const { id, secret } = await channel(pool);
    // روتِ جداگانه با matcherِ خراب
    const app = express();
    app.use(express.json());
    app.use("/api", createPaymentSmsRouter({ pool, hitFn: async () => ({ allowed: true, retryAfterSeconds: 0 }), matcher: async () => { throw new Error("db down"); } }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/payments/sms/${id}`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-sms-secret": secret }, body: JSON.stringify({ text: DEPOSIT }) });
      assert.equal(res.status, 201);
      assert.equal((await res.json()).matched, false);
      const rows = await inbox(pool);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "unmatched");
    } finally {
      await new Promise((r) => server.close(r));
    }
  }));

test("وبهوک: برداشت/ignored هرگز به موتورِ تطبیق نمی‌رسد", live, () =>
  withEnv(async ({ pool }) => {
    const { id, secret } = await channel(pool, { allowlist: ["Blubank"] });
    const seen = [];
    const app = express();
    app.use(express.json());
    app.use("/api", createPaymentSmsRouter({ pool, hitFn: async () => ({ allowed: true, retryAfterSeconds: 0 }), matcher: async (_p, smsId) => { seen.push(smsId); return { outcome: "no_candidate" }; } }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/payments/sms/${id}`;
      const send = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-sms-secret": secret }, body: JSON.stringify(body) });
      await send({ text: WITHDRAW, sender: "Blubank" });
      await send({ text: DEPOSIT, sender: "+989121234567" });
      await send({ text: "کد ورود 1234", sender: "Blubank" });
      assert.deepEqual(seen, []);
      await send({ text: DEPOSIT, sender: "Blubank" });
      assert.equal(seen.length, 1);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }));
