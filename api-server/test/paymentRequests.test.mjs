/**
 * test/paymentRequests.test.mjs — فاز ۲ کارت‌به‌کارتِ خودکار: تخصیصِ مبلغِ یکتا
 * و صفِ رزرو (`lib/paymentRequests.ts`).
 *
 * معیارِ اتمامِ فاز ۲: تستِ هم‌زمانی (۲۰ درخواستِ هم‌زمان برای یک base/کانال) →
 * هیچ دو درخواستِ فعالی `final_amount` برابر ندارند؛ برایِ fixed_link فقط یکی
 * pending و بقیه به ترتیب queued.
 *
 * بخشِ خالص همیشه اجرا می‌شود؛ بخشِ زنده فقط با `CARD_TEST_PG_URL` (یک Postgres
 * واقعیِ خالی) — هر تست schemaِ موقتِ خودش را می‌سازد و می‌اندازد.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const svc = await import("../src/lib/paymentRequests.ts");
const {
  freeSuffixes, pickRandom, createPaymentRequest, closePaymentRequest, expireDueRequests, queueAheadOf,
  SUFFIX_MIN_RIAL, SUFFIX_MAX_RIAL,
} = svc;

// ─── خالص ───────────────────────────────────────────────────────────────────

test("freeSuffixes: ۹۹۹ مقدارِ ممکن، همه مضربِ ۱۰ در ۱۰..۹۹۹۰", () => {
  const all = freeSuffixes(1_000_000, new Set());
  assert.equal(all.length, 999);
  assert.equal(all[0], SUFFIX_MIN_RIAL);
  assert.equal(all.at(-1), SUFFIX_MAX_RIAL);
  assert.ok(all.every((s) => s % 10 === 0));
});

test("freeSuffixes: مبالغِ اشغال‌شده حذف می‌شوند (حتی اگر از base دیگری آمده باشند)", () => {
  const free = freeSuffixes(1_000_000, new Set([1_000_010, 1_000_130, 1_009_990]));
  assert.equal(free.length, 996);
  assert.ok(!free.includes(10) && !free.includes(130) && !free.includes(9990));
  assert.equal(freeSuffixes(1_000_000, new Set(Array.from({ length: 999 }, (_, i) => 1_000_000 + 10 * (i + 1)))).length, 0);
});

test("pickRandom: از randomInt تزریق‌شده استفاده می‌کند", () => {
  assert.equal(pickRandom(["a", "b", "c"], () => 2), "c");
});

test("مبلغِ نامعتبر پیش از هر اتصالی رد می‌شود", async () => {
  const pool = { connect: async () => { throw new Error("نباید وصل شود"); } };
  for (const bad of [0, -5, 1.5, NaN, "100"]) {
    await assert.rejects(
      createPaymentRequest(pool, {
        channelId: "c", channelScope: { scope: "platform" }, userId: "u", purpose: "wallet_topup", baseAmountRial: bad,
      }),
      (e) => e.code === "invalid_amount",
    );
  }
});

test("resolveDefaultExpiryMs: پیش‌فرض ۳۰ دقیقه؛ env فقط عددِ صحیحِ ۵..۲۴۰ را می‌پذیرد", () => {
  const { resolveDefaultExpiryMs, DEFAULT_EXPIRY_MS } = svc;
  const MIN = 60_000;
  assert.equal(DEFAULT_EXPIRY_MS, 30 * MIN);
  assert.equal(resolveDefaultExpiryMs({}), 30 * MIN);
  assert.equal(resolveDefaultExpiryMs({ PAYMENT_REQUEST_EXPIRY_MINUTES: "45" }), 45 * MIN);
  assert.equal(resolveDefaultExpiryMs({ PAYMENT_REQUEST_EXPIRY_MINUTES: " 10 " }), 10 * MIN);
  assert.equal(resolveDefaultExpiryMs({ PAYMENT_REQUEST_EXPIRY_MINUTES: "5" }), 5 * MIN);
  assert.equal(resolveDefaultExpiryMs({ PAYMENT_REQUEST_EXPIRY_MINUTES: "240" }), 240 * MIN);
  // نامعتبر/خارج از بازه → همان ۳۰ دقیقه (نه صفر، نه بی‌نهایت، نه NaN)
  for (const bad of ["", "0", "4", "241", "-10", "1.5", "abc", "1e3", "999999999999"]) {
    assert.equal(resolveDefaultExpiryMs({ PAYMENT_REQUEST_EXPIRY_MINUTES: bad }), 30 * MIN, `مقدار ${bad}`);
  }
});

// ─── زنده ───────────────────────────────────────────────────────────────────

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };

let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const mirror = fs.readFileSync(new URL("../../lib/db/migrations/0038_card_autoconfirm.sql", import.meta.url), "utf8");
const ddl = mirror.slice(mirror.indexOf("-- ─── CARD_AUTOCONFIRM"));

async function withPool(fn) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_p2_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 30, options: `-c search_path=${schema}` });
  try {
    await pool.query(ddl);
    await fn(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

let n = 0;
async function channel(pool, { kind = "card_manual", scope = "platform", botId = null, active = true, minRial = 1_000_000 } = {}) {
  const id = `ch_${++n}`;
  await pool.query(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, payment_url, sms_secret_hash, active, min_amount_rial)
     VALUES ($1,$2,$3,$4,$5,$6,'h',$7,$8)`,
    [id, scope, botId, kind, kind === "card_manual" ? "enc" : null, kind === "card_manual" ? null : "https://pay.example/x", active, minRial],
  );
  return id;
}

const P = { scope: "platform" };
const create = (pool, channelId, over = {}) =>
  createPaymentRequest(pool, {
    channelId, channelScope: P, userId: `u${++n}`, purpose: "wallet_topup", baseAmountRial: 1_000_000, ...over,
  });

const rows = (pool, sql, params) => pool.query(sql, params).then((r) => r.rows);

test("۲۰ درخواستِ هم‌زمان برای یک base/کانال: همه pending با final یکتا", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const results = await Promise.all(Array.from({ length: 20 }, () => create(pool, ch)));
    assert.ok(results.every((r) => r.request.status === "pending" && r.queuedAhead === 0));
    const finals = results.map((r) => r.request.finalAmountRial);
    assert.equal(new Set(finals).size, 20, "final تکراری");
    for (const r of results) {
      assert.ok(r.request.suffixRial >= 10 && r.request.suffixRial <= 9990 && r.request.suffixRial % 10 === 0);
      assert.equal(r.request.finalAmountRial, r.request.baseAmountRial + r.request.suffixRial);
      assert.ok(r.request.expiresAt > new Date());
    }
    const dup = await rows(pool,
      `SELECT final_amount_rial FROM payment_requests WHERE status='pending' GROUP BY 1 HAVING COUNT(*) > 1`);
    assert.equal(dup.length, 0);
  }));

test("base هایِ نزدیک (بازه‌های suffix هم‌پوشان) هم هرگز final یکسان نمی‌گیرند", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const bases = Array.from({ length: 30 }, (_, i) => 1_000_000 + (i % 3) * 20);
    const results = await Promise.all(bases.map((b) => create(pool, ch, { baseAmountRial: b })));
    const pending = results.filter((r) => r.request.status === "pending");
    assert.equal(new Set(pending.map((r) => r.request.finalAmountRial)).size, pending.length);
  }));

test("فضایِ suffix پُر → queued؛ با آزاد شدنِ یک اسلات، همان لحظه ارتقا می‌یابد", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    // همه‌ی ۹۹۹ مقدارِ ممکن برایِ base=1,000,000 را اشغال کن.
    await pool.query(
      `INSERT INTO payment_requests
         (id, channel_id, channel_kind, scope, user_id, purpose, base_amount_rial, suffix_rial, final_amount_rial, status, expires_at)
       SELECT 'fill_' || g, $1, 'card_manual', 'platform', 'uf', 'wallet_topup',
              1000000, g * 10, 1000000 + g * 10, 'pending', now() + interval '30 minutes'
         FROM generate_series(1, 999) g`, [ch]);

    const first = await create(pool, ch);
    assert.equal(first.request.status, "queued");
    assert.equal(first.request.queuePosition, 1);
    assert.equal(first.request.suffixRial, 0);
    const second = await create(pool, ch);
    assert.equal(second.request.queuePosition, 2);
    assert.equal(second.queuedAhead, 1);
    assert.equal(await queueAheadOf(pool, second.request.id), 1);

    // base دیگر مستقل است (اسلاتِ خودش را دارد)
    const other = await create(pool, ch, { baseAmountRial: 5_000_000 });
    assert.equal(other.request.status, "pending");

    // یک اسلات آزاد شود → نفرِ اولِ صف (نه دومی) با همان suffix ارتقا می‌یابد
    const res = await closePaymentRequest(pool, { requestId: "fill_7", to: "canceled" });
    assert.equal(res.closed.status, "canceled");
    assert.equal(res.promoted.length, 1);
    assert.equal(res.promoted[0].id, first.request.id);
    assert.equal(res.promoted[0].status, "pending");
    assert.equal(res.promoted[0].suffixRial, 70, "تنها اسلاتِ آزاد");
    assert.equal(res.promoted[0].queuePosition, null);
    assert.ok(res.promoted[0].expiresAt > new Date());
    assert.equal((await rows(pool, `SELECT status FROM payment_requests WHERE id=$1`, [second.request.id]))[0].status, "queued");
  }));

test("fixed_link: ۲۰ درخواستِ هم‌زمان → فقط یکی pending، بقیه به ترتیبِ یکتا queued", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const results = await Promise.all(Array.from({ length: 20 }, () => create(pool, ch)));
    const pending = results.filter((r) => r.request.status === "pending");
    const queued = results.filter((r) => r.request.status === "queued");
    assert.equal(pending.length, 1);
    assert.equal(queued.length, 19);
    assert.equal(pending[0].request.suffixRial, 0);
    const positions = queued.map((r) => r.request.queuePosition).sort((a, b) => a - b);
    assert.deepEqual(positions, Array.from({ length: 19 }, (_, i) => i + 1));
  }));

test("fixed_link: لغو → نفرِ اولِ صف (FIFO) در همان تراکنش pending می‌شود", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const a = await create(pool, ch);
    const b = await create(pool, ch);
    const c = await create(pool, ch);
    const d = await create(pool, ch, { baseAmountRial: 2_000_000 }); // مبلغِ ثابتِ دیگر: مستقل
    assert.deepEqual([a, b, c, d].map((r) => r.request.status), ["pending", "queued", "queued", "pending"]);

    const r1 = await closePaymentRequest(pool, { requestId: a.request.id, to: "canceled" });
    assert.deepEqual(r1.promoted.map((p) => p.id), [b.request.id]);
    const r2 = await closePaymentRequest(pool, { requestId: b.request.id, to: "expired" });
    assert.deepEqual(r2.promoted.map((p) => p.id), [c.request.id]);
    const r3 = await closePaymentRequest(pool, { requestId: c.request.id, to: "canceled" });
    assert.equal(r3.promoted.length, 0);
    // بستنِ دوباره بی‌اثر است
    const again = await closePaymentRequest(pool, { requestId: c.request.id, to: "canceled" });
    assert.equal(again.closed, null);
  }));

test("بستنِ یک درخواستِ queued اسلاتی آزاد نمی‌کند و کسی را ارتقا نمی‌دهد", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const a = await create(pool, ch);
    const b = await create(pool, ch);
    const c = await create(pool, ch);
    const res = await closePaymentRequest(pool, { requestId: b.request.id, to: "canceled" });
    assert.equal(res.promoted.length, 0);
    assert.equal((await rows(pool, `SELECT status FROM payment_requests WHERE id=$1`, [a.request.id]))[0].status, "pending");
    assert.equal((await rows(pool, `SELECT status FROM payment_requests WHERE id=$1`, [c.request.id]))[0].status, "queued");
  }));

test("لغو فقط توسطِ صاحبِ درخواست", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool);
    const a = await create(pool, ch, { userId: "owner" });
    const wrong = await closePaymentRequest(pool, { requestId: a.request.id, to: "canceled", expectedUserId: "intruder" });
    assert.equal(wrong.closed, null);
    assert.equal((await closePaymentRequest(pool, { requestId: a.request.id, to: "canceled", expectedUserId: "owner" })).closed.status, "canceled");
  }));

test("sweeper: pending/queuedِ سررسیده منقضی می‌شود، awaiting_review دست‌نخورده، صف ارتقا می‌یابد", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const a = await create(pool, ch);
    const b = await create(pool, ch);
    const reviewed = await create(pool, ch, { baseAmountRial: 3_000_000 });
    await pool.query(`UPDATE payment_requests SET status='awaiting_review', expires_at = now() - interval '1 hour' WHERE id=$1`,
      [reviewed.request.id]);
    await pool.query(`UPDATE payment_requests SET expires_at = now() - interval '1 minute' WHERE id=$1`, [a.request.id]);

    const out = await expireDueRequests(pool);
    assert.deepEqual(out.expired.map((r) => r.id), [a.request.id]);
    assert.deepEqual(out.promoted.map((r) => r.id), [b.request.id]);
    assert.equal((await rows(pool, `SELECT status FROM payment_requests WHERE id=$1`, [reviewed.request.id]))[0].status, "awaiting_review");
    // دومین اجرا کاری ندارد
    const again = await expireDueRequests(pool);
    assert.equal(again.expired.length + again.promoted.length, 0);
  }));

test("صفِ منقضی‌شده ارتقا نمی‌یابد", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const a = await create(pool, ch);
    const b = await create(pool, ch);
    await pool.query(`UPDATE payment_requests SET expires_at = now() - interval '1 minute' WHERE id=$1`, [b.request.id]);
    const res = await closePaymentRequest(pool, { requestId: a.request.id, to: "canceled" });
    assert.equal(res.promoted.length, 0);
    const out = await expireDueRequests(pool);
    assert.deepEqual(out.expired.map((r) => r.id), [b.request.id]);
  }));

test("ایزوله‌سازیِ tenant و اعتبارسنجیِ کانال", live, () =>
  withPool(async (pool) => {
    const botCh = await channel(pool, { scope: "bot", botId: "botA" });
    const platCh = await channel(pool);
    const off = await channel(pool, { active: false });
    const rej = (p, code) => assert.rejects(p, (e) => e.code === code);

    await rej(create(pool, botCh), "channel_not_found");                                           // scope=platform روی کانالِ بات
    await rej(create(pool, botCh, { channelScope: { scope: "bot", botId: "botB" } }), "channel_not_found"); // بات دیگر
    await rej(create(pool, platCh, { channelScope: { scope: "bot", botId: "botA" } }), "channel_not_found");
    await rej(create(pool, "nope"), "channel_not_found");
    await rej(create(pool, off), "channel_inactive");
    await rej(create(pool, platCh, { baseAmountRial: 999_990 }), "amount_below_minimum");

    const ok = await create(pool, botCh, { channelScope: { scope: "bot", botId: "botA" } });
    assert.equal(ok.request.scope, "bot");
    assert.equal(ok.request.botId, "botA", "bot_id از کانال می‌آید");
  }));

test("همزمانیِ ساخت و لغو روی fixed_link: هیچ‌وقت دو pending یا جایگاهِ تکراری", live, () =>
  withPool(async (pool) => {
    const ch = await channel(pool, { kind: "fixed_link" });
    const created = [];
    const work = [];
    for (let i = 0; i < 30; i++) {
      work.push(create(pool, ch).then((r) => { created.push(r.request.id); }));
      if (i % 3 === 2) {
        work.push((async () => {
          const [p] = await rows(pool, `SELECT id FROM payment_requests WHERE status='pending' LIMIT 1`);
          if (p) await closePaymentRequest(pool, { requestId: p.id, to: "canceled" });
        })());
      }
    }
    await Promise.all(work);
    const pending = await rows(pool, `SELECT id FROM payment_requests WHERE status='pending'`);
    assert.ok(pending.length <= 1, `pending=${pending.length}`);
    const pos = await rows(pool, `SELECT queue_position FROM payment_requests WHERE status='queued'`);
    assert.equal(new Set(pos.map((p) => p.queue_position)).size, pos.length, "جایگاهِ تکراری");
    const all = await rows(pool, `SELECT COUNT(*)::int AS n FROM payment_requests`);
    assert.equal(all[0].n, 30);
  }));
