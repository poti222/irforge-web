/**
 * test/paymentSweeper.test.mjs — فاز ۹: sweeper هر دقیقه + لاگِ رویدادها (`lib/paymentSweeper.ts`، `lib/paymentEvents.ts`).
 *
 * معیار: انقضایِ pending/queued و ارتقایِ صف، پاک‌سازیِ ignoredِ قدیمی (۳۰ روز) و لاگِ قدیمی (۹۰ روز)، هشدارِ گوشیِ ساکت /
 * فیشِ بی‌جواب / اثرِ گیرکرده (هر کدام dedupe)، یک‌نمونه‌ای بودن (advisory lock)، و اینکه خطای یک مرحله بقیه را نمی‌خواباند.
 * لاگ: ماسکِ کارت/ارقامِ بلند، حذفِ کلیدهای حساس، و «هرگز throw نکردن».
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);

import { test } from "node:test";
import assert from "node:assert/strict";
import { DDL_ALL, SITE_TABLES_DDL } from "./helpers/cardPayDdl.mjs";

const S = await import("../src/lib/paymentSweeper.ts");
const E = await import("../src/lib/paymentEvents.ts");
const { createPaymentRequest } = await import("../src/lib/paymentRequests.ts");
const { hashSmsSecret } = await import("../src/lib/smsChannelSecret.ts");

// ─── لاگ: خالص ──────────────────────────────────────────────────────────────

test("لاگ: ماسکِ کارت و ارقامِ بلند، حذفِ کلیدهای حساس، سقفِ اندازه", () => {
  assert.equal(E.maskCardLike("کارت 6037997000001234 و 6037-9970-0000-1234 و 6037 9970 0000 1234"),
    "کارت 6037-****-****-1234 و 6037-****-****-1234 و 6037-****-****-1234");
  assert.equal(E.maskCardLike("مبلغ 2,000,050 ریال"), "مبلغ 2,000,050 ریال");            // مبلغ‌ها دست‌نخورده
  assert.equal(E.maskCardLike("موبایل 09123456789"), "موبایل 09123456789");             // فقط الگوی کارت (۱۳–۱۹ رقم)
  const clean = E.sanitizeEventData({
    text: "متنِ خام", rawText: "x", card: "6037997000001234", cardNumber: "6037997000001234", secret: "s", smsSecret: "s", token: "t",
    ok: 5, note: "کارتِ 6037997000001234", nested: { raw: "no", keep: "yes", deep: { a: { b: { c: 1 } } } }, list: [1, "6037997000001234"],
  });
  assert.deepEqual(Object.keys(clean).sort(), ["list", "nested", "note", "ok"]);
  assert.equal(clean.note, "کارتِ 6037-****-****-1234");
  assert.deepEqual(clean.nested.keep, "yes");
  assert.equal("raw" in clean.nested, false);
  assert.deepEqual(clean.list, [1, "6037-****-****-1234"]);
  assert.deepEqual(E.sanitizeEventData({ big: "x".repeat(5000).split("").map(() => "aaaaaaaaaa").join(",") }), { big: "aaaaaaaaaa,".repeat(28).slice(0, 300) });
  assert.deepEqual(E.sanitizeEventData({ a: Array.from({ length: 400 }, (_, i) => "item-number-" + i) }).a.length, 20);      // آرایه سقف ۲۰
  assert.deepEqual(E.sanitizeEventData(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "y".repeat(100)]))), { truncated: true });
});

test("لاگ: logPaymentEvent هرگز throw نمی‌کند (جدولِ ناموجود/اتصالِ خراب)", async () => {
  const brokenPool = { connect: async () => { throw new Error("db down"); } };
  await E.logPaymentEvent(brokenPool, { kind: "x" });
  const badTable = { connect: async () => ({ query: async () => { throw new Error('relation "payment_events" does not exist'); }, release() {} }) };
  await E.logPaymentEvent(badTable, { kind: "x" });
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const NOW = new Date("2026-09-29T12:00:00Z");
const min = (m) => new Date(NOW.getTime() + m * 60_000);
const hr = (h) => new Date(NOW.getTime() + h * 3_600_000);
const day = (d) => new Date(NOW.getTime() + d * 86_400_000);

async function withDb(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_s9_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 20, options: `-c search_path=${schema}` });
  await pool.query(DDL_ALL);
  await pool.query(SITE_TABLES_DDL);
  const alerts = [];
  const notifiers = {
    notifyAdmins: async (m) => { alerts.push({ to: "admins", ...m }); },
    notifyBotOwner: async (botId, m) => { alerts.push({ to: `owner:${botId}`, ...m }); },
    record: (ev) => E.logPaymentEvent(pool, ev),
  };
  const ch = async (id, { scope = "platform", botId = null, kind = "card_manual", lastSms = null, active = true } = {}) => {
    await pool.query(
      `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, payment_url, sms_secret_hash, last_sms_at, active, min_amount_rial)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1000000)`,
      [id, scope, botId, kind, kind === "card_manual" ? "x:y:z" : null, kind === "card_manual" ? null : "https://pay.example/x", hashSmsSecret("s"), lastSms, active]);
  };
  const req = (channelId, user, base, over = {}) => createPaymentRequest(pool, {
    channelId, channelScope: over.botId ? { scope: "bot", botId: over.botId } : { scope: "platform" }, userId: user, purpose: "wallet_topup",
    baseAmountRial: base, now: over.now ?? NOW, expiryMs: over.expiryMs, queueTtlMs: over.queueTtlMs,
  });
  const status = async (id) => (await pool.query("SELECT status FROM payment_requests WHERE id = $1", [id])).rows[0].status;
  const events = async (kind) => (await pool.query("SELECT * FROM payment_events WHERE kind = $1 ORDER BY at", [kind])).rows;
  try { await fn({ pool, notifiers, alerts, ch, req, status, events }); } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test("انقضا + ارتقایِ صف: pending سررسیدشده expired، نفرِ بعدیِ صفِ لینکِ ثابت pending می‌شود؛ اجرای دوم بی‌اثر", live, () => withDb(async (t) => {
  await t.ch("fx", { kind: "fixed_link" });
  const a = (await t.req("fx", "u1", 2_000_000, { expiryMs: 10 * 60_000, queueTtlMs: 60 * 60_000 })).request;
  const b = (await t.req("fx", "u2", 2_000_000, { expiryMs: 10 * 60_000, queueTtlMs: 60 * 60_000 })).request;
  assert.deepEqual([a.status, b.status], ["pending", "queued"]);
  const r = await S.sweepPaymentRequests(t.pool, { now: min(11), notifiers: t.notifiers });
  assert.deepEqual([r.expired, r.promoted, r.errors.length], [1, 1, 0]);
  assert.equal(await t.status(a.id), "expired");
  assert.equal(await t.status(b.id), "pending");
  assert.equal((await t.events("request_expired")).length, 1);
  assert.equal((await t.events("queue_promoted")).length, 1);
  assert.equal((await t.events("sweep")).length, 1);
  const again = await S.sweepPaymentRequests(t.pool, { now: min(11), notifiers: t.notifiers });
  assert.deepEqual([again.expired, again.promoted], [0, 0]);
  assert.equal((await t.events("sweep")).length, 1);                      // کارِ بیهوده لاگ نمی‌شود
  assert.ok(S.getLastSweepReport());
}));

test("queued که خودش مهلتش تمام شده هرگز ارتقا نمی‌یابد؛ awaiting_review خودکار منقضی نمی‌شود", live, () => withDb(async (t) => {
  await t.ch("fx", { kind: "fixed_link" });
  const a = (await t.req("fx", "u1", 2_000_000, { expiryMs: 10 * 60_000, queueTtlMs: 5 * 60_000 })).request;
  const q = (await t.req("fx", "u2", 2_000_000, { expiryMs: 10 * 60_000, queueTtlMs: 5 * 60_000 })).request;
  const rev = (await t.req("fx", "u3", 3_000_000, { expiryMs: 10 * 60_000 })).request;
  await t.pool.query("UPDATE payment_requests SET status = 'awaiting_review', receipt_file_id = 'f', receipt_uploaded_at = $2, expires_at = $3 WHERE id = $1", [rev.id, NOW, min(1)]);
  const r = await S.sweepPaymentRequests(t.pool, { now: min(30), notifiers: t.notifiers });
  assert.equal(await t.status(a.id), "expired");
  assert.equal(await t.status(q.id), "expired");                        // منتظرِ صف بود و مهلتش هم رفت
  assert.equal(await t.status(rev.id), "awaiting_review");              // پولِ احتمالاً واریزشده: فقط ادمین تصمیم می‌گیرد
  assert.equal(r.promoted, 0);
}));

test("پاک‌سازی: ignoredِ >۳۰ روز پاک می‌شود، ignoredِ جوان و unmatched/matchedِ قدیمی نه؛ لاگِ >۹۰ روز پاک", live, () => withDb(async (t) => {
  await t.ch("c1");
  const sms = (id, status, ingested, extra = {}) => t.pool.query(
    `INSERT INTO sms_inbox (id, channel_id, raw_text, sender, received_at, ingested_at, content_hash, direction, amount_rial, parsed_ok, status)
     VALUES ($1,'c1','t','b',$2,$2,$3,$4,$5,$6,$7)`,
    [id, ingested, `h_${id}`, extra.direction ?? "unknown", extra.amount ?? null, extra.parsed ?? false, status]);
  await sms("old_ign", "ignored", day(-31));
  await sms("young_ign", "ignored", day(-29));
  await sms("old_unm", "unmatched", day(-100), { direction: "deposit", amount: 5_000_000, parsed: true });
  const oldEv = (id, at) => t.pool.query("INSERT INTO payment_events (id, kind, at) VALUES ($1,'old',$2)", [id, at]);
  await oldEv("e_old", day(-91));
  await oldEv("e_new", day(-89));
  const r = await S.sweepPaymentRequests(t.pool, { now: NOW, notifiers: t.notifiers });
  assert.equal(r.purgedIgnoredSms, 1);
  assert.deepEqual((await t.pool.query("SELECT id FROM sms_inbox ORDER BY id")).rows.map((x) => x.id), ["old_unm", "young_ign"]);
  assert.equal(r.purgedEvents, 1);
  assert.deepEqual((await t.pool.query("SELECT id FROM payment_events WHERE kind = 'old'")).rows.map((x) => x.id), ["e_new"]);
}));

test("فیشِ بی‌جوابِ بیش از ۶ ساعت: یک‌بار هشدار (platform → سوپرادمین، bot → صاحبِ بات)؛ فیشِ تازه نه", live, () => withDb(async (t) => {
  await t.ch("cp");
  await t.ch("cb", { scope: "bot", botId: "bot_A" });
  const mk = async (channelId, user, base, uploaded, over = {}) => {
    const r = (await t.req(channelId, user, base, over)).request;
    await t.pool.query("UPDATE payment_requests SET status = 'awaiting_review', receipt_file_id = 'f', receipt_uploaded_at = $2 WHERE id = $1", [r.id, uploaded]);
    return r;
  };
  const p = await mk("cp", "u1", 2_000_000, hr(-7));
  const b = await mk("cb", "u2", 3_000_000, hr(-8), { botId: "bot_A" });
  await mk("cp", "u3", 4_000_000, hr(-1));
  const r = await S.sweepPaymentRequests(t.pool, { now: NOW, notifiers: t.notifiers });
  assert.equal(r.staleReviewAlerts, 2);
  const stale = t.alerts.filter((a) => a.type === "payment_review_stale");
  assert.deepEqual(stale.map((a) => a.to).sort(), ["admins", "admins", "owner:bot_A"]);
  assert.deepEqual((await t.events("stale_review_alert")).map((e) => e.request_id).sort(), [b.id, p.id].sort());
  const again = await S.sweepPaymentRequests(t.pool, { now: hr(1), notifiers: t.notifiers });
  assert.equal(again.staleReviewAlerts, 0);                              // dedupe
  assert.equal(t.alerts.filter((a) => a.type === "payment_review_stale").length, 3);
}));

test("گوشیِ ساکت: فقط کانالِ فعالِ دارایِ ترافیک؛ حداکثر هر ۱۲ ساعت یک هشدار؛ سالم/بی‌ترافیک/غیرفعال نه", live, () => withDb(async (t) => {
  await t.ch("silent", { scope: "bot", botId: "bot_A", lastSms: hr(-13) });
  await t.ch("never", { lastSms: null });
  await t.ch("healthy", { scope: "bot", botId: "bot_B", lastSms: hr(-1) });
  await t.ch("idle", { scope: "bot", botId: "bot_C", lastSms: hr(-40) });        // بی‌ترافیک
  await t.ch("off", { scope: "bot", botId: "bot_D", lastSms: hr(-40) });
  await t.req("silent", "u1", 2_000_000, { botId: "bot_A", now: NOW });
  await t.req("never", "u2", 2_000_000, { now: NOW });
  await t.req("healthy", "u3", 2_000_000, { botId: "bot_B", now: NOW });
  await t.req("off", "u4", 2_000_000, { botId: "bot_D", now: NOW });
  await t.pool.query("UPDATE payment_channels SET active = false WHERE id = 'off'");           // خاموش‌شده با درخواستِ باز
  const r1 = await S.sweepPaymentRequests(t.pool, { now: NOW, notifiers: t.notifiers });
  assert.equal(r1.silentPhoneAlerts, 2);
  assert.deepEqual(t.alerts.filter((a) => a.type === "payment_phone_silent").map((a) => a.to).sort(), ["admins", "admins", "owner:bot_A"]);     // platform→سوپرادمین؛ bot→سوپرادمین+صاحبِ بات
  const r2 = await S.sweepPaymentRequests(t.pool, { now: hr(6), notifiers: t.notifiers });
  assert.equal(r2.silentPhoneAlerts, 0);                                 // زیرِ ۱۲ ساعت تکرار نمی‌شود
  const r3 = await S.sweepPaymentRequests(t.pool, { now: hr(13), notifiers: t.notifiers });
  // بعد از ۱۲ ساعت دوباره یادآوری؛ و کانالِ «سالم» هم حالا که ۱۴ ساعت ساکت شده (با ترافیکِ اخیر) به‌درستی وارد شد
  assert.equal(r3.silentPhoneAlerts, 3);
  assert.equal((await t.events("phone_silent_alert")).length, 5);
  assert.equal((await t.pool.query("SELECT COUNT(*)::int AS n FROM payment_events WHERE kind = 'phone_silent_alert' AND channel_id IN ('idle','off')")).rows[0].n, 0);
}));

test("اثرِ گیرکرده (bot: claim شده ولی done نشده >۱۵ دقیقه): یک‌بار هشدار critical؛ هرگز خودکار retry نمی‌شود", live, () => withDb(async (t) => {
  await t.ch("cb", { scope: "bot", botId: "bot_A" });
  const r = (await t.req("cb", "u1", 2_000_000, { botId: "bot_A" })).request;
  await t.pool.query(
    "UPDATE payment_requests SET status='confirmed', confirmed_by='sms', confirmed_at=$2, effect_claimed_at=$3 WHERE id=$1", [r.id, NOW, min(-20)]);
  const ok = (await t.req("cb", "u2", 3_000_000, { botId: "bot_A" })).request;
  await t.pool.query(
    "UPDATE payment_requests SET status='confirmed', confirmed_by='sms', confirmed_at=$2, effect_claimed_at=$3, effect_done_at=$3 WHERE id=$1", [ok.id, NOW, min(-20)]);
  const before = (await t.pool.query("SELECT id, effect_claimed_at, effect_done_at FROM payment_requests ORDER BY id")).rows;
  const s = await S.sweepPaymentRequests(t.pool, { now: NOW, notifiers: t.notifiers });
  assert.equal(s.stuckEffectAlerts, 1);
  const stuck = t.alerts.filter((x) => x.type === "payment_effect_stuck");
  assert.deepEqual(stuck.map((x) => x.to).sort(), ["admins", "owner:bot_A"]);          // هم سوپرادمین هم صاحبِ بات
  assert.ok(stuck.every((x) => x.severity === "critical"));
  assert.deepEqual((await t.pool.query("SELECT id, effect_claimed_at, effect_done_at FROM payment_requests ORDER BY id")).rows, before);   // چیزی تغییر نکرد
  assert.equal((await S.sweepPaymentRequests(t.pool, { now: NOW, notifiers: t.notifiers })).stuckEffectAlerts, 0);
}));

test("یک‌نمونه‌ای: وقتی lock دستِ پروسه‌ی دیگر است جاروب رد می‌شود؛ بعد از آزاد شدن کار می‌کند", live, () => withDb(async (t) => {
  await t.ch("c1");
  const r = (await t.req("c1", "u1", 2_000_000, { expiryMs: 60_000 })).request;
  const holder = await t.pool.connect();
  try {
    const got = (await holder.query("SELECT pg_try_advisory_lock(hashtextextended('payment_sweeper', 0)) AS ok")).rows[0].ok;
    assert.equal(got, true);
    const skipped = await S.sweepPaymentRequests(t.pool, { now: min(5), notifiers: t.notifiers });
    assert.equal(skipped.skipped, "lock_held");
    assert.equal(await t.status(r.id), "pending");
  } finally {
    await holder.query("SELECT pg_advisory_unlock_all()");
    holder.release();
  }
  const done = await S.sweepPaymentRequests(t.pool, { now: min(5), notifiers: t.notifiers });
  assert.equal(done.skipped, undefined);
  assert.equal(await t.status(r.id), "expired");
  // اجرای هم‌زمان: دقیقاً یکی کار می‌کند و مجموع منقضی‌ها درست است
  const r2 = (await t.req("c1", "u2", 3_000_000, { expiryMs: 60_000 })).request;
  const all = await Promise.all([1, 2, 3, 4].map(() => S.sweepPaymentRequests(t.pool, { now: min(10), notifiers: t.notifiers })));
  assert.equal(all.reduce((n, x) => n + x.expired, 0), 1);
  assert.equal(await t.status(r2.id), "expired");
}));

test("خطای یک مرحله بقیه را نمی‌خواباند و در report.errors می‌آید", live, () => withDb(async (t) => {
  await t.ch("c1");
  const r = (await t.req("c1", "u1", 2_000_000, { expiryMs: 60_000 })).request;
  await t.pool.query("ALTER TABLE sms_inbox RENAME TO sms_inbox_broken");            // مرحله‌ی purge می‌شکند
  const rep = await S.sweepPaymentRequests(t.pool, { now: min(5), notifiers: t.notifiers });
  assert.equal(rep.expired, 1);                                                      // انقضا اجرا شد
  assert.equal(await t.status(r.id), "expired");
  assert.ok(rep.errors.some((e) => e.startsWith("purge_ignored_sms")));
  assert.equal((await t.events("sweep"))[0].level, "error");
  await t.pool.query("ALTER TABLE sms_inbox_broken RENAME TO sms_inbox");
}));

test("startPaymentSweeper: تیکِ دوره‌ای اجرا می‌شود و stop() متوقفش می‌کند", live, () => withDb(async (t) => {
  await t.ch("c1");
  const r = (await t.req("c1", "u1", 2_000_000, { now: new Date(Date.now() - 3_600_000), expiryMs: 60_000 })).request;
  const stop = S.startPaymentSweeper(t.pool, t.notifiers, { intervalMs: 40 });
  await new Promise((res) => setTimeout(res, 400));
  stop();
  assert.equal(await t.status(r.id), "expired");
  const n = (await t.events("sweep")).length;
  await new Promise((res) => setTimeout(res, 200));
  assert.equal((await t.events("sweep")).length, n);
}));

test("listPaymentEvents: فیلترها و ترتیبِ جدید→قدیم؛ lastEventAt", live, () => withDb(async (t) => {
  await E.logPaymentEvent(t.pool, { kind: "a", level: "info", scope: "platform", channelId: "c1", requestId: "r1" });
  await E.logPaymentEvent(t.pool, { kind: "b", level: "error", scope: "bot", botId: "bot_A", channelId: "c2", message: "خطا با کارت 6037997000001234" });
  await E.logPaymentEvent(t.pool, { kind: "b", level: "warn", scope: "bot", botId: "bot_A", channelId: "c2" });
  const all = await E.listPaymentEvents(t.pool, {});
  assert.equal(all.length, 3);
  assert.equal(all[0].kind, "b");
  assert.equal((await E.listPaymentEvents(t.pool, { level: "problems" })).length, 2);
  assert.equal((await E.listPaymentEvents(t.pool, { kind: "a" })).length, 1);
  assert.equal((await E.listPaymentEvents(t.pool, { botId: "bot_A", scope: "bot" })).length, 2);
  assert.equal((await E.listPaymentEvents(t.pool, { requestId: "r1" })).length, 1);
  assert.equal((await E.listPaymentEvents(t.pool, { limit: 1 })).length, 1);
  assert.ok(!JSON.stringify(all).includes("6037997000001234"));                    // ماسک حتی در message
  assert.ok((await E.lastEventAt(t.pool, "b", "c2")) instanceof Date);
  assert.equal(await E.lastEventAt(t.pool, "b", "nope"), null);
}));
