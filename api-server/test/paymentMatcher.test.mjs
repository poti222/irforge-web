/**
 * test/paymentMatcher.test.mjs — فاز ۴ کارت‌به‌کارتِ خودکار: موتورِ تطبیق و تأییدِ
 * خودکار (`lib/paymentMatcher.ts`، `paymentEffects.ts`، `paymentAlerts.ts`).
 *
 * معیارِ اتمامِ فاز ۴: تأییدِ دوباره هیچ اثری ندارد؛ پیامکِ کانالِ دیگر هرگز match
 * نمی‌شود؛ پیامکِ خارج از پنجره‌ی زمانی match نمی‌شود؛ effect و تأیید یک‌تراکنش‌اند.
 *
 * بخشِ خالص همیشه اجرا می‌شود؛ بخشِ زنده فقط با `CARD_TEST_PG_URL` (Postgres واقعی).
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { createPaymentRequest, closePaymentRequest } = await import("../src/lib/paymentRequests.ts");
const { ingestSms } = await import("../src/lib/smsIngest.ts");
const M = await import("../src/lib/paymentMatcher.ts");
const { matchSms, retestUnmatchedForRequest, MATCH_BEFORE_CREATED_MS, MATCH_AFTER_EXPIRY_MS } = M;
const E = await import("../src/lib/paymentEffects.ts");
const { createPaymentAlerts } = await import("../src/lib/paymentAlerts.ts");

const MIN = 60_000;

// ─── خالص ───────────────────────────────────────────────────────────────────

test("ثبتِ effect: تکراریِ متفاوت خطا، همان تابع idempotent، ثبت‌نشده undefined (fail-closed)", () => {
  E.clearPaymentEffects();
  const f = async () => {};
  E.registerPaymentEffect("platform", "wallet_topup", f);
  E.registerPaymentEffect("platform", "wallet_topup", f);
  assert.throws(() => E.registerPaymentEffect("platform", "wallet_topup", async () => {}), /already registered/);
  assert.equal(E.getPaymentEffect("platform", "wallet_topup"), f);
  assert.equal(E.getPaymentEffect("bot", "order"), undefined);
  E.clearPaymentEffects();
});

test("ثابت‌های پنجره: ۲ دقیقه قبل از ساخت، ۱۰ دقیقه بعد از انقضا", () => {
  assert.equal(MATCH_BEFORE_CREATED_MS, 2 * MIN);
  assert.equal(MATCH_AFTER_EXPIRY_MS, 10 * MIN);
});

test("alerts: onAmbiguous به ادمین و (برایِ بات) به صاحبِ بات می‌رسد؛ پیام شماره‌کارت/متنِ پیامک ندارد؛ خطای notifier قورت داده می‌شود", async () => {
  const sent = [];
  const alerts = createPaymentAlerts({
    notifyAdmins: async (m) => { sent.push(["admin", m]); },
    notifyBotOwner: async (botId, m) => { sent.push(["owner", botId, m]); throw new Error("boom"); },
  });
  await alerts.onAmbiguous({ channelId: "c1", scope: "bot", botId: "b1", smsId: "s1", amountRial: 1_234_560, requestIds: ["r1", "r2"] });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((x) => x[0]).sort(), ["admin", "owner"]);
  const msg = sent[0][1];
  assert.equal(msg.severity, "critical");
  assert.equal(msg.dedupeKey, "payment_sms_ambiguous:s1");
  assert.match(msg.message, /1,234,560/);
  assert.doesNotMatch(JSON.stringify(sent), /\d{16}/);

  const platform = [];
  const a2 = createPaymentAlerts({ notifyAdmins: async (m) => { platform.push(m); }, notifyBotOwner: async () => { throw new Error("must not be called"); } });
  await a2.onProblem({ kind: "no_effect", channelId: "c", scope: "platform", botId: null, smsId: "s", requestId: "r", message: "x" });
  assert.equal(platform.length, 1);
  assert.equal(platform[0].dedupeKey, "payment_confirm_failed:r:no_effect");
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };

let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const mirror = fs.readFileSync(new URL("../../lib/db/migrations/0029_card_autoconfirm.sql", import.meta.url), "utf8");
const ddl = mirror.slice(mirror.indexOf("-- ─── CARD_AUTOCONFIRM"));

async function withPool(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p4_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 40, options: `-c search_path=${schema}` });
  try {
    await pool.query(ddl);
    await pool.query("CREATE TABLE credits (request_id text PRIMARY KEY, amount bigint NOT NULL)");
    await fn(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

let n = 0;
async function channel(pool, { kind = "card_manual", scope = "platform", botId = null, active = true } = {}) {
  const id = `ch_${++n}`;
  await pool.query(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, payment_url, sms_secret_hash, active)
     VALUES ($1,$2,$3,$4,$5,$6,'h',$7)`,
    [id, scope, botId, kind, kind === "card_manual" ? "enc" : null, kind === "card_manual" ? null : "https://pay.example/x", active],
  );
  return { id, scope, botId, active, senderAllowlist: [], bankParser: "blubank" };
}

const T0 = new Date(Date.now() - 3 * 60 * MIN); // ساختِ درخواست‌ها: سه ساعت پیش
async function request(pool, ch, over = {}) {
  const scope = ch.scope === "bot" ? { scope: "bot", botId: ch.botId } : { scope: "platform" };
  const r = await createPaymentRequest(pool, {
    channelId: ch.id, channelScope: scope, userId: `u${++n}`, purpose: "wallet_topup",
    baseAmountRial: 2_000_000, now: T0, expiryMs: 30 * MIN, ...over,
  });
  return r.request;
}

const fmt = (x) => x.toLocaleString("en-US");
const bluText = (amount) =>
  `بلو\nواریز پول\n فاطمه عزیز، ${fmt(amount)} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;

/** پیامکِ واریز با زمانِ مشخص (received_at) ذخیره می‌کند. */
async function sms(pool, ch, amount, at, over = {}) {
  const r = await ingestSms(pool, ch, { text: over.text ?? bluText(amount), sender: over.sender ?? "Blubank", time: at.toISOString() }, new Date());
  assert.equal(r.inserted, true, "sms باید تازه ذخیره شود");
  return r.id;
}

const at = (mins) => new Date(T0.getTime() + mins * MIN);
const row = (pool, table, id) => pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]).then((r) => r.rows[0]);

/** effectِ شمارنده که همان client را برایِ یک INSERT به‌کار می‌برد (اثباتِ هم‌تراکنشی). */
function creditEffect(log = []) {
  const fn = async (c, req) => {
    log.push(req.id);
    await c.query("INSERT INTO credits (request_id, amount) VALUES ($1, $2::bigint)", [req.id, req.baseAmountRial]);
  };
  return { fn, log, getEffect: () => fn };
}

test("مسیرِ شاد: پیامکِ هم‌مبلغ در پنجره → تأیید؛ request/sms/effect یک‌جا و hook صدا زده می‌شود", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const smsId = await sms(pool, ch, req.finalAmountRial, at(5));
    const eff = creditEffect();
    const events = [];
    const out = await matchSms(pool, smsId, { getEffect: eff.getEffect, alerts: { onConfirmed: (e) => events.push(e) } });
    assert.equal(out.outcome, "confirmed");
    assert.equal(out.request.id, req.id);
    assert.equal(out.request.status, "confirmed");
    const r = await row(pool, "payment_requests", req.id);
    assert.equal(r.status, "confirmed");
    assert.equal(r.confirmed_by, "sms");
    assert.equal(r.matched_sms_id, smsId);
    assert.ok(r.confirmed_at);
    const s = await row(pool, "sms_inbox", smsId);
    assert.equal(s.status, "matched");
    assert.equal(s.matched_request_id, req.id);
    assert.deepEqual(eff.log, [req.id]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM credits")).rows[0].n, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].smsId, smsId);
  }));

test("مبلغِ نزدیک ولی نه دقیق (±۱۰ ریال، ±۱ ریال) هرگز match نمی‌شود", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const eff = creditEffect();
    for (const delta of [-10, -1, 1, 10, 1000]) {
      const id = await sms(pool, ch, req.finalAmountRial + delta, at(5 + Math.abs(delta) % 7 + (delta > 0 ? 1 : 0)), { text: bluText(req.finalAmountRial + delta) + ` ${delta}` });
      const out = await matchSms(pool, id, { getEffect: eff.getEffect });
      assert.equal(out.outcome, "no_candidate", `delta=${delta}`);
      assert.equal((await row(pool, "sms_inbox", id)).status, "unmatched");
    }
    assert.equal((await row(pool, "payment_requests", req.id)).status, "pending");
    assert.equal(eff.log.length, 0);
  }));

test("ایزولاسیون: پیامکِ کانالِ دیگر (حتی هم‌مبلغ) هرگز درخواستِ این کانال را تأیید نمی‌کند", live, () =>
  withPool(async (pool) => {
    const a = await channel(pool, { scope: "bot", botId: "bot_A" });
    const b = await channel(pool, { scope: "bot", botId: "bot_B" });
    const p = await channel(pool);
    const reqA = await request(pool, a);
    const smsB = await sms(pool, b, reqA.finalAmountRial, at(5));
    const smsP = await sms(pool, p, reqA.finalAmountRial, at(6));
    const eff = creditEffect();
    assert.equal((await matchSms(pool, smsB, { getEffect: eff.getEffect })).outcome, "no_candidate");
    assert.equal((await matchSms(pool, smsP, { getEffect: eff.getEffect })).outcome, "no_candidate");
    assert.equal((await row(pool, "payment_requests", reqA.id)).status, "pending");
    // و برعکس: پیامکِ خودِ کانالِ A تأیید می‌کند
    const smsA = await sms(pool, a, reqA.finalAmountRial, at(7));
    assert.equal((await matchSms(pool, smsA, { getEffect: eff.getEffect })).outcome, "confirmed");
  }));

test("پنجره‌ی زمانی: [created−۲د, expires+۱۰د] — لبه‌ها و بیرونِ آن", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const eff = creditEffect();
    const cases = [
      // [دقیقه نسبت به created, انتظار]
      [-3, "no_candidate"],     // بیش از ۲ دقیقه قبل از ساختِ درخواست (پیامکِ قدیمی)
      [-120, "no_candidate"],   // خیلی قدیمی
      [30 + 11, "no_candidate"], // بعد از expires + ۱۰د
      [30 + 60, "no_candidate"],
      [-1, "confirmed"],        // داخلِ تلرانسِ ساعتِ گوشی
      [30 + 9, "confirmed"],    // بعد از انقضا ولی داخلِ ۱۰ دقیقه‌ی مهلت
      [15, "confirmed"],        // وسطِ پنجره
    ];
    for (const [mins, expected] of cases) {
      const req = await request(pool, ch);
      const id = await sms(pool, ch, req.finalAmountRial, at(mins), { text: bluText(req.finalAmountRial) + ` m${mins}` });
      const out = await matchSms(pool, id, { getEffect: eff.getEffect });
      assert.equal(out.outcome, expected, `پیامک ${mins} دقیقه نسبت به created`);
      // پاک‌سازیِ اسلات برای دور بعد
      if (expected === "no_candidate") await closePaymentRequest(pool, { requestId: req.id, to: "canceled" });
    }
  }));

test("awaiting_review: سقفِ بالا برداشته می‌شود (مبلغ رزرو است) ولی کفِ پایین می‌ماند", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const eff = creditEffect();
    const r1 = await request(pool, ch);
    await pool.query("UPDATE payment_requests SET status = 'awaiting_review' WHERE id = $1", [r1.id]);
    const old = await sms(pool, ch, r1.finalAmountRial, at(-30));
    assert.equal((await matchSms(pool, old, { getEffect: eff.getEffect })).outcome, "no_candidate");
    const late = await sms(pool, ch, r1.finalAmountRial, at(60 * 2), { text: bluText(r1.finalAmountRial) + " late" });
    const out = await matchSms(pool, late, { getEffect: eff.getEffect });
    assert.equal(out.outcome, "confirmed");
    assert.equal(out.request.id, r1.id);
  }));

test("وضعیتِ درخواست: expired/canceled/rejected/confirmed/queued هرگز match نمی‌شوند", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const eff = creditEffect();
    for (const status of ["expired", "canceled", "rejected"]) {
      const r = await request(pool, ch);
      await pool.query("UPDATE payment_requests SET status = $2 WHERE id = $1", [r.id, status]);
      const id = await sms(pool, ch, r.finalAmountRial, at(5), { text: bluText(r.finalAmountRial) + status });
      assert.equal((await matchSms(pool, id, { getEffect: eff.getEffect })).outcome, "no_candidate", status);
      assert.equal((await row(pool, "payment_requests", r.id)).status, status);
    }
    // confirmed
    const done = await request(pool, ch);
    const first = await sms(pool, ch, done.finalAmountRial, at(4), { text: bluText(done.finalAmountRial) + " first" });
    assert.equal((await matchSms(pool, first, { getEffect: eff.getEffect })).outcome, "confirmed");
    const dup = await sms(pool, ch, done.finalAmountRial, at(6), { text: bluText(done.finalAmountRial) + " dup" });
    assert.equal((await matchSms(pool, dup, { getEffect: eff.getEffect })).outcome, "no_candidate");
    assert.equal(eff.log.length, 1, "پولِ دومی (تکراری) نباید اثرِ دوم بسازد");
    // queued (fixed_link: دومی در صف)
    const fx = await channel(pool, { kind: "fixed_link" });
    await request(pool, fx, { baseAmountRial: 1_500_000 });
    const q = await request(pool, fx, { baseAmountRial: 1_500_000 });
    assert.equal(q.status, "queued");
    const qs = await sms(pool, fx, 1_500_000, at(1));
    const out = await matchSms(pool, qs, { getEffect: eff.getEffect });
    assert.equal(out.outcome, "confirmed");
    assert.notEqual(out.request.id, q.id, "صف‌شده هرگز مستقیم تأیید نمی‌شود");
  }));

test("پیامکِ برداشت / نامفهوم / ignored هرگز match نمی‌شود (حتی با مبلغِ برابر)", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const eff = creditEffect();
    const wd = await ingestSms(pool, ch, {
      text: `بلو\nبرداشت پول\n فاطمه عزیز، ${fmt(req.finalAmountRial)} ریال از حساب شما برداشت شد.`, sender: "Blubank", time: at(5).toISOString(),
    }, new Date());
    const junk = await ingestSms(pool, ch, { text: `چیز نامفهوم ${req.finalAmountRial}`, sender: "Blubank", time: at(6).toISOString() }, new Date());
    const restricted = { ...ch, senderAllowlist: ["OnlyThisBank"] };
    const ign = await ingestSms(pool, restricted, { text: bluText(req.finalAmountRial), sender: "+989121234567", time: at(7).toISOString() }, new Date());
    for (const r of [wd, junk, ign]) {
      const out = await matchSms(pool, r.id, { getEffect: eff.getEffect });
      assert.equal(out.outcome, "skipped", r.id);
    }
    assert.equal((await row(pool, "payment_requests", req.id)).status, "pending");
    assert.equal(eff.log.length, 0);
    assert.equal((await matchSms(pool, "sms_nope", { getEffect: eff.getEffect })).outcome, "skipped");
  }));

test("تأییدِ دوباره بی‌اثر: ۱۰ matchِ هم‌زمانِ یک پیامک → دقیقاً یک confirmed و یک effect", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const smsId = await sms(pool, ch, req.finalAmountRial, at(5));
    const eff = creditEffect();
    const outs = await Promise.all(Array.from({ length: 10 }, () => matchSms(pool, smsId, { getEffect: eff.getEffect })));
    assert.equal(outs.filter((o) => o.outcome === "confirmed").length, 1);
    assert.ok(outs.filter((o) => o.outcome !== "confirmed").every((o) => o.outcome === "skipped" && o.reason === "already_processed"));
    assert.equal(eff.log.length, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM credits")).rows[0].n, 1);
    // بعد از آن هم بی‌اثر
    assert.equal((await matchSms(pool, smsId, { getEffect: eff.getEffect })).outcome, "skipped");
    assert.equal(eff.log.length, 1);
  }));

test("دو ردیفِ پیامکِ هم‌مبلغ (واریزِ تکراری) هم‌زمان: فقط یکی تأیید می‌کند، دومی unmatched می‌ماند", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const s1 = await sms(pool, ch, req.finalAmountRial, at(5), { text: bluText(req.finalAmountRial) + " a" });
    const s2 = await sms(pool, ch, req.finalAmountRial, at(6), { text: bluText(req.finalAmountRial) + " b" });
    const eff = creditEffect();
    const outs = await Promise.all([matchSms(pool, s1, { getEffect: eff.getEffect }), matchSms(pool, s2, { getEffect: eff.getEffect })]);
    assert.equal(outs.filter((o) => o.outcome === "confirmed").length, 1);
    assert.equal(outs.filter((o) => o.outcome === "no_candidate").length, 1);
    assert.equal(eff.log.length, 1);
    const st = (await pool.query("SELECT status FROM sms_inbox ORDER BY status")).rows.map((r) => r.status);
    assert.deepEqual(st, ["matched", "unmatched"]);
  }));

test("ابهام: اگر ایندکسِ یکتا نبود و دو درخواستِ فعال هم‌مبلغ‌اند → ambiguous، هیچ‌کدام تأیید نمی‌شود و هشدار می‌رود", live, () =>
  withPool(async (pool) => {
    await pool.query("DROP INDEX payment_requests_active_final_uk");
    const ch = await channel(pool);
    const mk = async (id) => pool.query(
      `INSERT INTO payment_requests (id, channel_id, channel_kind, scope, bot_id, user_id, purpose, base_amount_rial, suffix_rial,
         final_amount_rial, status, expires_at, created_at)
       VALUES ($1,$2,'card_manual','platform',NULL,$3,'wallet_topup',2000000,50,2000050,'pending',$4,$5)`,
      [id, ch.id, `u_${id}`, new Date(T0.getTime() + 30 * MIN), T0]);
    await mk("dup_1"); await mk("dup_2");
    const smsId = await sms(pool, ch, 2_000_050, at(5));
    const eff = creditEffect();
    const amb = [];
    const out = await matchSms(pool, smsId, { getEffect: eff.getEffect, alerts: { onAmbiguous: (e) => amb.push(e) } });
    assert.equal(out.outcome, "ambiguous");
    assert.deepEqual([...out.requestIds].sort(), ["dup_1", "dup_2"]);
    assert.equal((await row(pool, "sms_inbox", smsId)).status, "ambiguous");
    assert.equal((await row(pool, "payment_requests", "dup_1")).status, "pending");
    assert.equal((await row(pool, "payment_requests", "dup_2")).status, "pending");
    assert.equal(eff.log.length, 0);
    assert.equal(amb.length, 1);
    assert.equal(amb[0].smsId, smsId);
    // ambiguous دوباره خودکار match نمی‌شود
    assert.equal((await matchSms(pool, smsId, { getEffect: eff.getEffect })).outcome, "skipped");
  }));

test("effect و تأیید یک تراکنش‌اند: خطای effect → rollbackِ کامل (request pending، sms unmatched، effectِ نیمه‌کاره پاک)", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const smsId = await sms(pool, ch, req.finalAmountRial, at(5));
    const problems = [];
    const failing = async (c, r) => {
      await c.query("INSERT INTO credits (request_id, amount) VALUES ($1, 1)", [r.id]); // نیمه‌کاره
      throw new Error("wallet down");
    };
    const out = await matchSms(pool, smsId, { getEffect: () => failing, alerts: { onProblem: (e) => problems.push(e) } });
    assert.deepEqual([out.outcome, out.reason], ["blocked", "effect_failed"]);
    assert.equal((await row(pool, "payment_requests", req.id)).status, "pending");
    assert.equal((await row(pool, "sms_inbox", smsId)).status, "unmatched");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM credits")).rows[0].n, 0, "effectِ نیمه‌کاره باید rollback شود");
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, "effect_failed");
    assert.equal(problems[0].requestId, req.id);
    assert.match(problems[0].message, /wallet down/);
    // بعد از رفعِ مشکل، همان پیامک با یک retry تأیید می‌شود
    const eff = creditEffect();
    assert.equal((await matchSms(pool, smsId, { getEffect: eff.getEffect })).outcome, "confirmed");
    assert.equal(eff.log.length, 1);
  }));

test("fail-closed: effect ثبت‌نشده → تأیید نمی‌شود، چیزی عوض نمی‌شود، هشدارِ no_effect", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const smsId = await sms(pool, ch, req.finalAmountRial, at(5));
    const problems = [];
    const out = await matchSms(pool, smsId, { getEffect: () => undefined, alerts: { onProblem: (e) => problems.push(e) } });
    assert.deepEqual([out.outcome, out.reason], ["blocked", "no_effect"]);
    assert.equal((await row(pool, "payment_requests", req.id)).status, "pending");
    assert.equal((await row(pool, "sms_inbox", smsId)).status, "unmatched");
    assert.equal(problems[0].kind, "no_effect");
    // registry سراسری (پیش‌فرض) هم خالی است
    E.clearPaymentEffects();
    assert.equal((await matchSms(pool, smsId)).outcome, "blocked");
  }));

test("hookِ خراب (onConfirmed throw می‌کند) نتیجه‌ی commitشده را عوض نمی‌کند", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const req = await request(pool, ch);
    const smsId = await sms(pool, ch, req.finalAmountRial, at(5));
    const eff = creditEffect();
    const out = await matchSms(pool, smsId, { getEffect: eff.getEffect, alerts: { onConfirmed: () => { throw new Error("notify down"); } } });
    assert.equal(out.outcome, "confirmed");
    assert.equal((await row(pool, "payment_requests", req.id)).status, "confirmed");
  }));

test("صفِ fixed_link: تأیید نفرِ بعدیِ صف را در همان تراکنش pending می‌کند؛ effect خراب → صف دست‌نخورده", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const now = new Date(); // صف TTL دارد؛ با T0ِ سه‌ساعت‌پیش، queued از قبل منقضی می‌شد
    const r1 = await request(pool, ch, { baseAmountRial: 1_700_000, now });
    const r2 = await request(pool, ch, { baseAmountRial: 1_700_000, now });
    assert.equal(r1.status, "pending");
    assert.equal(r2.status, "queued");
    const smsId = await sms(pool, ch, 1_700_000, new Date(now.getTime() + 3 * MIN));

    const bad = await matchSms(pool, smsId, { getEffect: () => async () => { throw new Error("x"); } });
    assert.equal(bad.outcome, "blocked");
    assert.equal((await row(pool, "payment_requests", r2.id)).status, "queued", "شکستِ effect نباید صف را جلو ببرد");
    assert.equal((await row(pool, "payment_requests", r1.id)).status, "pending");

    const eff = creditEffect();
    const out = await matchSms(pool, smsId, { getEffect: eff.getEffect });
    assert.equal(out.outcome, "confirmed");
    assert.equal(out.request.id, r1.id);
    assert.deepEqual(out.promoted.map((p) => p.id), [r2.id]);
    const after = await row(pool, "payment_requests", r2.id);
    assert.equal(after.status, "pending");
    assert.equal(after.queue_position, null);
    assert.ok(after.expires_at);
  }));

test("retest: پیامکِ unmatched که پیش از ساختِ درخواست رسیده، با ساختِ درخواست تأیید می‌شود؛ قدیمی‌تر از ۱۵ دقیقه نه", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const eff = creditEffect();
    const now = new Date();
    // درخواستی می‌سازیم و بعد پیامکش را «پیش از commit» شبیه‌سازی می‌کنیم: اول پیامک، بعد درخواست
    const base = 3_000_000;
    // نخست درخواست (برای دانستنِ final)، سپس پیامک را به‌عنوانِ رسیده‌پیشاز-تطبیق ذخیره می‌کنیم
    const req = await request(pool, ch, { baseAmountRial: base, now });
    const smsId = await sms(pool, ch, req.finalAmountRial, new Date(now.getTime() + 1 * MIN));
    assert.equal((await row(pool, "sms_inbox", smsId)).status, "unmatched");
    const outs = await retestUnmatchedForRequest(pool, req.id, { getEffect: eff.getEffect, now: new Date(now.getTime() + 2 * MIN) });
    assert.deepEqual(outs.map((o) => o.outcome), ["confirmed"]);
    assert.equal((await row(pool, "payment_requests", req.id)).status, "confirmed");

    // پیامکِ ingest شده ۲۰ دقیقه‌ی پیش → در retest نیست
    const req2 = await request(pool, ch, { baseAmountRial: base + 100_000, now });
    const s2 = await sms(pool, ch, req2.finalAmountRial, new Date(now.getTime() + 1 * MIN));
    await pool.query("UPDATE sms_inbox SET ingested_at = $2 WHERE id = $1", [s2, new Date(now.getTime() - 20 * MIN)]);
    const outs2 = await retestUnmatchedForRequest(pool, req2.id, { getEffect: eff.getEffect, now });
    assert.deepEqual(outs2, []);

    // ingestِ اخیر ولی received_atِ خیلی قدیمی → retest می‌کند ولی پنجره‌ی زمانی رد می‌کند
    const req3 = await request(pool, ch, { baseAmountRial: base + 200_000, now });
    const s3 = await sms(pool, ch, req3.finalAmountRial, new Date(now.getTime() - 60 * MIN));
    const outs3 = await retestUnmatchedForRequest(pool, req3.id, { getEffect: eff.getEffect, now });
    assert.deepEqual(outs3.map((o) => o.outcome), ["no_candidate"]);
    assert.equal((await row(pool, "sms_inbox", s3)).status, "unmatched");
    assert.equal(eff.log.length, 1);
  }));

test("رقابتِ cancel با match روی یک درخواست (۴۰ دور): یا confirmed+یک effect، یا canceled+بدونِ effect؛ بدونِ deadlock", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    let confirmed = 0, canceled = 0;
    for (let i = 0; i < 40; i++) {
      const req = await request(pool, ch, { baseAmountRial: 1_000_000 + i * 100_000 });
      const smsId = await sms(pool, ch, req.finalAmountRial, at(5), { text: bluText(req.finalAmountRial) + ` r${i}` });
      const eff = creditEffect();
      const [m, c] = await Promise.all([
        matchSms(pool, smsId, { getEffect: eff.getEffect }),
        closePaymentRequest(pool, { requestId: req.id, to: "canceled" }),
      ]);
      const final = (await row(pool, "payment_requests", req.id)).status;
      if (final === "confirmed") {
        confirmed++;
        assert.equal(m.outcome, "confirmed");
        assert.equal(c.closed, null, "cancelِ بعد از تأیید بی‌اثر است");
        assert.equal(eff.log.length, 1);
        assert.equal((await row(pool, "sms_inbox", smsId)).status, "matched");
      } else {
        canceled++;
        assert.equal(final, "canceled");
        assert.equal(m.outcome, "no_candidate");
        assert.ok(c.closed);
        assert.equal(eff.log.length, 0, "درخواستِ لغوشده هرگز effect نمی‌گیرد");
        assert.equal((await row(pool, "sms_inbox", smsId)).status, "unmatched");
      }
    }
    assert.equal(confirmed + canceled, 40);
  }));

test("۳۰ پیامک برای ۳۰ درخواستِ یک کانال هم‌زمان (به‌علاوه‌ی ساختِ درخواستِ هم‌زمان) → همه تأیید، بدونِ deadlock", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const reqs = await Promise.all(Array.from({ length: 30 }, () => request(pool, ch)));
    const ids = await Promise.all(reqs.map((r, i) => sms(pool, ch, r.finalAmountRial, at(4), { text: bluText(r.finalAmountRial) + ` k${i}` })));
    const eff = creditEffect();
    const noise = Promise.all(Array.from({ length: 10 }, () => request(pool, ch, { baseAmountRial: 9_000_000 })));
    const outs = await Promise.all(ids.map((id) => matchSms(pool, id, { getEffect: eff.getEffect })));
    await noise;
    assert.ok(outs.every((o) => o.outcome === "confirmed"), JSON.stringify(outs.filter((o) => o.outcome !== "confirmed")));
    assert.equal(eff.log.length, 30);
    assert.equal(new Set(eff.log).size, 30);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM credits")).rows[0].n, 30);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM sms_inbox WHERE status = 'matched'")).rows[0].n, 30);
  }));

test("منبعِ موتور: ترتیبِ قفل (کانال ← ردیف)، effect داخلِ تراکنش، و لاگ بدونِ متنِ پیامک", () => {
  const src = fs.readFileSync(new URL("../src/lib/paymentMatcher.ts", import.meta.url), "utf8");
  assert.match(src, /withChannelLock\(pool, channelId/);
  assert.ok(src.indexOf("FROM sms_inbox WHERE id = $1 FOR UPDATE") < src.indexOf("FROM payment_requests"), "sms قبل از request قفل شود");
  assert.match(src, /FOR UPDATE/);
  const eIdx = src.indexOf("await effect(c, confirmed)");
  assert.ok(eIdx > src.indexOf("confirmRequestTx(c,") && eIdx < src.indexOf("after.run = () => safely(\"onConfirmed\""));
  assert.doesNotMatch(src, /raw_text|rawText/);
});
