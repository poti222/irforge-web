/**
 * test/paymentDecisions.test.mjs — فاز ۶ کارت‌به‌کارتِ خودکار: تأیید/ردِ دستیِ ادمین
 * (`lib/paymentDecisions.ts` + `POST /internal/payments/requests/decide`).
 *
 * معیارِ اتمامِ فاز ۶: «اولین تصمیم برنده است» — دو ادمینِ هم‌زمان (یا ادمین و پیامکِ بانک) → فقط
 * یک تصمیم اثر می‌گذارد؛ تأیید از همان تابعِ تأییدِ فاز ۴ می‌گذرد (`confirmed_by=admin`)؛ ردِ دستی
 * دلیل/ادمین را ثبت می‌کند و اسلات را آزاد می‌کند؛ باتِ دیگر نمی‌تواند تصمیم بگیرد.
 * (مجوزِ ادمین در خودِ بات سنجیده می‌شود؛ تستش در irforge-app است.)
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL`.
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
const { decideRequestByAdmin, MAX_REJECT_REASON } = await import("../src/lib/paymentDecisions.ts");
const { createBotPayment } = await import("../src/lib/paymentBotApi.ts");
const { ingestSms } = await import("../src/lib/smsIngest.ts");
const { matchSms } = await import("../src/lib/paymentMatcher.ts");

const SECRET = process.env.PAYMENT_INTERNAL_SECRET;
const CARD = "6037997000000001";

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const readSql = (f) => {
  const t = fs.readFileSync(new URL(`../../lib/db/migrations/${f}`, import.meta.url), "utf8");
  return t.slice(t.indexOf("-- ───"));
};
const ddl = ["0029_card_autoconfirm.sql", "0030_card_autoconfirm_effects.sql", "0031_card_autoconfirm_reject.sql"]
  .map(readSql).join("\n");

const SHEETS = { sheet_A_12345: "bot_A", sheet_B_12345: "bot_B" };
const A = "sheet_A_12345";
const B = "sheet_B_12345";

async function withEnv(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p6_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 40, options: `-c search_path=${schema}` });
  await pool.query(ddl);
  const app = express();
  app.use(express.json());
  app.use("/api", createInternalBotPaymentsRouter({
    pool, hitFn: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    resolveBot: async (sid) => (SHEETS[sid] ? { botId: SHEETS[sid] } : null),
  }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/internal/payments`;
  const call = async (path, body, secret = SECRET) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment-internal-secret": secret },
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
async function channel(pool, { botId = "bot_A", kind = "card_manual" } = {}) {
  const id = `ch_${++n}`;
  await pool.query(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, payment_url, sms_secret_hash, active)
     VALUES ($1,'bot',$2,$3,$4,$5,'h',true)`,
    [id, botId, kind, kind === "card_manual" ? encryptToken(CARD) : null, kind === "card_manual" ? null : "https://pay.example/x"]);
  return { id, scope: "bot", botId, active: true, senderAllowlist: [], bankParser: "blubank" };
}

const bluText = (amount) =>
  `بلو\nواریز پول\n فاطمه عزیز، ${amount.toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,999,999 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;

const create = (call, over = {}) => call("/requests/create", {
  spreadsheetId: A, userId: "1001", purpose: "wallet_topup", baseAmountRial: 2_000_000, ...over,
}).then((r) => r.json.payment);
const receipt = (call, p, userId = "1001") =>
  call("/requests/receipt", { spreadsheetId: A, userId, requestId: p.id, receiptFileId: "AgAC" });
const decide = (call, p, decision, adminId = "9001", over = {}) =>
  call("/requests/decide", { spreadsheetId: A, requestId: p.id, decision, adminId, ...over });
const row = (pool, id) => pool.query("SELECT * FROM payment_requests WHERE id=$1", [id]).then((r) => r.rows[0]);

test("تأییدِ دستی از awaiting_review: confirmed(admin) با شناسه‌ی ادمین، unclaimed می‌شود و claim/done ادامه دارد", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const p = await create(call);
    await receipt(call, p);
    const r = await decide(call, p, "approve", "9001");
    assert.equal(r.status, 200);
    assert.equal(r.json.decided, true);
    assert.equal(r.json.payment.status, "confirmed");
    assert.equal(r.json.payment.confirmedBy, "admin");
    assert.equal(r.json.payment.decidedByAdminId, "9001");
    const db = await row(pool, p.id);
    assert.deepEqual([db.status, db.confirmed_by, db.confirmed_by_admin_id, db.matched_sms_id], ["confirmed", "admin", "9001", null]);
    assert.ok(db.confirmed_at);
    assert.deepEqual((await call("/requests/unclaimed", { spreadsheetId: A })).json.payments.map((x) => x.id), [p.id]);
    assert.equal((await call("/requests/claim", { spreadsheetId: A, requestId: p.id })).json.claimed, true);
    assert.equal((await call("/requests/effect-done", { spreadsheetId: A, requestId: p.id })).json.done, true);
  }));

test("ردِ دستی: rejected با ادمین/دلیل/زمان؛ کاربر بعدش نمی‌تواند لغو کند؛ دلیلِ بلند بریده می‌شود", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const p = await create(call);
    await receipt(call, p);
    const r = await decide(call, p, "reject", "9002", { reason: "  عکس ناخوانا  " });
    assert.equal(r.json.decided, true);
    assert.equal(r.json.payment.status, "rejected");
    assert.equal(r.json.payment.decidedByAdminId, "9002");
    assert.equal(r.json.payment.rejectReason, "عکس ناخوانا");
    const db = await row(pool, p.id);
    assert.deepEqual([db.rejected_by_admin_id, db.reject_reason], ["9002", "عکس ناخوانا"]);
    assert.ok(db.rejected_at);
    assert.equal((await call("/requests/cancel", { spreadsheetId: A, userId: "1001", requestId: p.id })).json.code, "wrong_state");
    assert.equal((await call("/requests/claim", { spreadsheetId: A, requestId: p.id })).json.claimed, false);

    const p2 = await create(call, { userId: "1002" });
    await receipt(call, p2, "1002");
    const long = await decide(call, p2, "reject", "9002", { reason: "x".repeat(5000) });
    assert.equal(long.json.payment.rejectReason.length, MAX_REJECT_REASON);
    const noReason = await create(call, { userId: "1003" });
    assert.equal((await decide(call, noReason, "reject", "9002")).json.payment.rejectReason, null);
  }));

test("اولین تصمیم برنده است: تصمیمِ دوم (تأیید/رد/تکراری) decided:false و وضعیتِ اولی را نشان می‌دهد", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const p = await create(call);
    await receipt(call, p);
    assert.equal((await decide(call, p, "approve", "9001")).json.decided, true);
    for (const [d, admin] of [["approve", "9002"], ["reject", "9002"], ["approve", "9001"]]) {
      const r = await decide(call, p, d, admin, { reason: "late" });
      assert.equal(r.status, 200);
      assert.equal(r.json.decided, false, `${d} by ${admin}`);
      assert.equal(r.json.payment.status, "confirmed");
      assert.equal(r.json.payment.decidedByAdminId, "9001", "تصمیم‌گیرنده‌ی اول نمایش داده شود");
    }
    const db = await row(pool, p.id);
    assert.deepEqual([db.confirmed_by_admin_id, db.rejected_by_admin_id, db.reject_reason], ["9001", null, null]);

    const q = await create(call, { userId: "1002" });
    await receipt(call, q, "1002");
    assert.equal((await decide(call, q, "reject", "9003")).json.decided, true);
    const late = await decide(call, q, "approve", "9004");
    assert.equal(late.json.decided, false);
    assert.equal(late.json.payment.status, "rejected");
    assert.equal(late.json.payment.decidedByAdminId, "9003");
    assert.equal((await row(pool, q.id)).confirmed_by, null);
  }));

test("۲۰ ادمینِ هم‌زمان (تأیید و ردِ مخلوط): دقیقاً یک تصمیم اثر می‌گذارد و وضعیتِ نهایی با همان سازگار است", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    for (let round = 0; round < 6; round++) {
      const p = await create(call, { userId: `20${round}` });
      await receipt(call, p, `20${round}`);
      const outs = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        decide(call, p, i % 2 ? "approve" : "reject", `90${i}`.padStart(4, "9"))));
      assert.ok(outs.every((o) => o.status === 200));
      const winners = outs.filter((o) => o.json.decided === true);
      assert.equal(winners.length, 1, `round ${round}`);
      const w = winners[0].json.payment;
      const db = await row(pool, p.id);
      assert.equal(db.status, w.status);
      assert.ok(["confirmed", "rejected"].includes(db.status));
      if (db.status === "confirmed") {
        assert.equal(db.confirmed_by, "admin");
        assert.equal(db.confirmed_by_admin_id, w.decidedByAdminId);
        assert.equal(db.rejected_by_admin_id, null);
      } else {
        assert.equal(db.rejected_by_admin_id, w.decidedByAdminId);
        assert.equal(db.confirmed_by_admin_id, null);
      }
      // همه‌ی بازنده‌ها همان تصمیمِ برنده را می‌بینند
      assert.ok(outs.filter((o) => !o.json.decided).every((o) => o.json.payment.decidedByAdminId === w.decidedByAdminId));
    }
  }));

test("رقابتِ ادمین با پیامکِ بانک: دقیقاً یکی تأیید می‌کند (یا sms یا admin) و پیامک دوبار مصرف نمی‌شود", live, () =>
  withEnv(async ({ pool, call }) => {
    const ch = await channel(pool);
    let smsWins = 0, adminWins = 0;
    for (let i = 0; i < 25; i++) {
      const p = await create(call, { userId: `30${i}`, baseAmountRial: 1_000_000 + i * 100_000 });
      await receipt(call, p, `30${i}`);
      const sms = await ingestSms(pool, ch, { text: bluText(p.finalAmountRial) + ` r${i}`, sender: "Blubank", time: new Date().toISOString() });
      const [m, d] = await Promise.all([matchSms(pool, sms.id), decide(call, p, "approve", "9001")]);
      const db = await row(pool, p.id);
      assert.equal(db.status, "confirmed");
      const smsRow = (await pool.query("SELECT status, matched_request_id FROM sms_inbox WHERE id=$1", [sms.id])).rows[0];
      if (db.confirmed_by === "sms") {
        smsWins++;
        assert.equal(m.outcome, "confirmed");
        assert.equal(d.json.decided, false);
        assert.equal(d.json.payment.confirmedBy, "sms");
        assert.equal(smsRow.status, "matched");
      } else {
        adminWins++;
        assert.equal(db.confirmed_by, "admin");
        assert.equal(d.json.decided, true);
        assert.equal(m.outcome, "no_candidate");
        assert.equal(smsRow.status, "unmatched", "پیامکِ مصرف‌نشده باید برایِ رسیدگی بماند");
      }
    }
    assert.equal(smsWins + adminWins, 25);
  }));

test("رد اسلات را آزاد می‌کند: نفرِ بعدیِ صفِ fixed_link در همان تراکنش pending می‌شود", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool, { kind: "fixed_link" });
    const first = await create(call, { userId: "1001", baseAmountRial: 1_500_000 });
    const second = await create(call, { userId: "1002", baseAmountRial: 1_500_000 });
    assert.equal(second.status, "queued");
    await receipt(call, first);
    const r = await decide(call, first, "reject", "9001", { reason: "x" });
    assert.deepEqual(r.json.promotedIds, [second.id]);
    assert.equal((await row(pool, second.id)).status, "pending");
    // و تأیید هم صف را جلو می‌برد
    const third = await create(call, { userId: "1003", baseAmountRial: 1_500_000 });
    assert.equal(third.status, "queued");
    await receipt(call, second, "1002");
    const ok = await decide(call, second, "approve", "9001");
    assert.deepEqual(ok.json.promotedIds, [third.id]);
  }));

test("تصمیم روی pending هم ممکن است؛ روی queued/expired/canceled/نامعلوم نه", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool, { kind: "fixed_link" });
    const a = await create(call, { userId: "1001", baseAmountRial: 1_500_000 });
    const q = await create(call, { userId: "1002", baseAmountRial: 1_500_000 });
    const rq = await decide(call, q, "approve");
    assert.equal(rq.json.decided, false);
    assert.equal(rq.json.payment.status, "queued");
    assert.equal((await decide(call, { id: "pr_nope" }, "approve")).status, 404);
    await call("/requests/cancel", { spreadsheetId: A, userId: "1001", requestId: a.id });
    assert.equal((await decide(call, a, "approve")).json.decided, false);
    // pending (بدونِ فیش) قابلِ تأیید است
    const c = await create(call, { userId: "1004", baseAmountRial: 1_800_000 });
    assert.equal((await decide(call, c, "approve")).json.decided, true);
    const status = (await row(pool, q.id)).status;
    assert.ok(["pending", "queued"].includes(status));
  }));

test("ایزولاسیون: باتِ B نمی‌تواند روی درخواستِ باتِ A تصمیم بگیرد", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool, { botId: "bot_A" });
    await channel(pool, { botId: "bot_B" });
    const p = await create(call);
    await receipt(call, p);
    for (const d of ["approve", "reject"]) {
      const r = await call("/requests/decide", { spreadsheetId: B, requestId: p.id, decision: d, adminId: "9001" });
      assert.equal(r.status, 404, d);
    }
    assert.equal((await row(pool, p.id)).status, "awaiting_review");
  }));

test("ورودی‌های نامعتبر و secret غلط", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const p = await create(call);
    for (const bad of [
      { decision: "delete" }, { decision: undefined }, { adminId: "abc" }, { adminId: "" }, { adminId: undefined },
      { requestId: "bad id!" },
    ]) {
      const body = { spreadsheetId: A, requestId: p.id, decision: "approve", adminId: "9001", ...bad };
      const r = await call("/requests/decide", body);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal((await call("/requests/decide", { spreadsheetId: A, requestId: p.id, decision: "approve", adminId: "9001" }, "nope")).status, 403);
    assert.equal((await row(pool, p.id)).status, "pending");
  }));

test("fail-closed: effectِ ثبت‌نشده → تأیید رد می‌شود و چیزی عوض نمی‌شود؛ ردِ بی‌effect مجاز است", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const p = await create(call);
    await receipt(call, p);
    await assert.rejects(
      decideRequestByAdmin(pool, { requestId: p.id, decision: "approve", adminId: "9001", getEffect: () => undefined }),
      (e) => e.code === "no_effect");
    assert.equal((await row(pool, p.id)).status, "awaiting_review");
    // effectِ خراب → rollbackِ کامل
    await assert.rejects(
      decideRequestByAdmin(pool, { requestId: p.id, decision: "approve", adminId: "9001", getEffect: () => async () => { throw new Error("boom"); } }),
      /boom/);
    const db = await row(pool, p.id);
    assert.deepEqual([db.status, db.confirmed_by, db.confirmed_by_admin_id], ["awaiting_review", null, null]);
    const rej = await decideRequestByAdmin(pool, { requestId: p.id, decision: "reject", adminId: "9001", getEffect: () => undefined });
    assert.equal(rej.decided, true);
  }));

test("CHECKِ دیتابیس: ستون‌های رد فقط برایِ status=rejected", live, () =>
  withEnv(async ({ pool, call }) => {
    await channel(pool);
    const p = await create(call);
    await assert.rejects(
      pool.query("UPDATE payment_requests SET rejected_by_admin_id = '1' WHERE id=$1", [p.id]), /payment_requests_reject_chk/);
    await assert.rejects(
      pool.query("UPDATE payment_requests SET reject_reason = 'x' WHERE id=$1", [p.id]), /payment_requests_reject_chk/);
  }));

test("منبع: مسیرِ decide از confirmRequestTx (تابعِ تأییدِ فاز ۴) می‌گذرد و لاگ دلیلِ ردِ ادمین را ندارد", () => {
  const lib = fs.readFileSync(new URL("../src/lib/paymentDecisions.ts", import.meta.url), "utf8");
  assert.match(lib, /confirmRequestTx\(c,/);
  assert.match(lib, /withChannelLock\(pool, channelId/);
  assert.ok(lib.indexOf("FOR UPDATE") > lib.indexOf("withChannelLock(pool, channelId"), "قفلِ ردیف بعد از قفلِ کانال");
  const route = fs.readFileSync(new URL("../src/routes/internalBotPayments.ts", import.meta.url), "utf8");
  const logs = [...route.matchAll(/logger\.(?:info|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[1]);
  for (const l of logs) assert.doesNotMatch(l.split('"')[0], /reason|cardNumber|secret/i, l);
  const mig = fs.readFileSync(new URL("../migrate.mjs", import.meta.url), "utf8");
  const m31 = readSql("0031_card_autoconfirm_reject.sql");
  assert.ok(mig.includes(m31.trimEnd()), "migrate.mjs و 0031 از هم جدا شده‌اند");
  assert.ok(!m31.includes("`") && !m31.includes("${"));
});
