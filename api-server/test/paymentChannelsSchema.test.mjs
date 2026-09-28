/**
 * test/paymentChannelsSchema.test.mjs — فاز ۱ کارت‌به‌کارتِ خودکار: اسکیمای
 * `payment_channels` / `payment_requests` / `sms_inbox`.
 *
 * معیارِ اتمامِ فاز ۱: migration بدون خطا اجرا می‌شود و insertِ دومِ همان
 * `final_amount_rial`ِ فعال روی همان کانال **توسط خودِ دیتابیس** reject می‌شود
 * (نه فقط اپلیکیشن).
 *
 * دو بخش:
 *  ۱. ایستا (همیشه): مایگریشنِ پروداکشن (migrate.mjs) و آینه‌اش (0029) یکی‌اند.
 *  ۲. زنده: فقط وقتی `CARD_TEST_PG_URL` تنظیم باشد (یک Postgres واقعیِ خالی) —
 *     DDL روی یک schemaِ موقتِ جدا اجرا و قیدها با insertِ واقعی امتحان می‌شوند.
 *     بدونِ آن env، این بخش skip می‌شود (مثلِ businessPg.test.mjs).
 *
 * اجرا: CARD_TEST_PG_URL=postgresql://… pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const mirror = fs.readFileSync(new URL("../../lib/db/migrations/0029_card_autoconfirm.sql", import.meta.url), "utf8");
const migrate = fs.readFileSync(new URL("../migrate.mjs", import.meta.url), "utf8");

/** بدنه‌ی DDL بدونِ سرفایلِ آینه (چهار خطِ اولِ کامنت). */
const ddl = mirror.slice(mirror.indexOf("-- ─── CARD_AUTOCONFIRM"));

test("مایگریشنِ پروداکشن دقیقاً همان DDLِ آینه‌ی 0029 را دارد", () => {
  assert.ok(migrate.includes(ddl.trimEnd()), "migrate.mjs و 0029_card_autoconfirm.sql از هم جدا شده‌اند");
});

test("DDL امن برای template literalِ migrate.mjs است (بدون backtick و ${})", () => {
  assert.ok(!ddl.includes("`"), "backtick داخل SQL، رشته‌ی template literal را می‌بندد");
  assert.ok(!ddl.includes("${"), "${ داخل SQL به‌عنوان interpolation تعبیر می‌شود");
});

test("قیدهای یکتاییِ سطحِ دیتابیس در DDL هستند", () => {
  for (const name of [
    "payment_requests_active_final_uk",
    "payment_requests_fixed_pending_uk",
    "sms_inbox_channel_hash_uk",
    "sms_inbox_matched_request_uk",
  ]) {
    assert.match(ddl, new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${name}`), name);
  }
});

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };

let pgMod = null;
try { pgMod = await import("pg"); } catch { /* live tests skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

async function withSchema(fn) {
  const pool = new Pool({ connectionString: PG_URL, max: 25 });
  const schema = `card_t_${Math.random().toString(36).slice(2, 10)}`;
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA ${schema}`);
    await c.query(`SET search_path TO ${schema}`);
    await c.query(ddl);
    await c.query(ddl); // idempotent: دومین اجرا نباید خطا بدهد
  } finally {
    c.release();
  }
  const q = async (sql, params) => {
    const cl = await pool.connect();
    try {
      await cl.query(`SET search_path TO ${schema}`);
      return await cl.query(sql, params);
    } finally {
      cl.release();
    }
  };
  try {
    await fn(q);
  } finally {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
}

async function code(promise) {
  try { await promise; return null; } catch (e) { return e.code; }
}

const UNIQUE = "23505";
const CHECK = "23514";

let n = 0;
const id = (p) => `${p}_${++n}`;

async function channel(q, { kind = "card_manual", scope = "platform", botId = null } = {}) {
  const cid = id("ch");
  await q(
    `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, payment_url, sms_secret_hash)
     VALUES ($1,$2,$3,$4,$5,$6,'h')`,
    [cid, scope, botId, kind, kind === "card_manual" ? "enc" : null, kind === "card_manual" ? null : "https://pay.example/x"],
  );
  return cid;
}

function request(q, channelId, over = {}) {
  const o = {
    kind: "card_manual", scope: "platform", botId: null, purpose: "wallet_topup", orderId: null,
    base: 1_000_000, suffix: 130, status: "pending", queue: null,
    expires: "now() + interval '30 minutes'", confirmedBy: null, confirmedAt: null, adminId: null,
    ...over,
  };
  return q(
    `INSERT INTO payment_requests
       (id, channel_id, channel_kind, scope, bot_id, user_id, purpose, order_id,
        base_amount_rial, suffix_rial, final_amount_rial, status, expires_at, queue_position,
        confirmed_by, confirmed_at, confirmed_by_admin_id)
     VALUES ($1,$2,$3,$4,$5,'u1',$6,$7,$8::bigint,$9::bigint,$8::bigint+$9::bigint,$10,${o.expires},$11,$12,$13,$14) RETURNING id`,
    [id("rq"), channelId, o.kind, o.scope, o.botId, o.purpose, o.orderId, o.base, o.suffix, o.status, o.queue,
      o.confirmedBy, o.confirmedAt, o.adminId],
  );
}

test("دو درخواستِ فعال با final یکسان روی یک کانال: دومی توسط DB رد می‌شود", live, () =>
  withSchema(async (q) => {
    const ch = await channel(q);
    await request(q, ch);
    assert.equal(await code(request(q, ch)), UNIQUE);
    // awaiting_review هم «فعال» حساب می‌شود
    assert.equal(await code(request(q, ch, { status: "awaiting_review" })), UNIQUE);
    // کانالِ دیگر مستقل است
    const ch2 = await channel(q);
    assert.equal(await code(request(q, ch2)), null);
    // suffix دیگر → final دیگر
    assert.equal(await code(request(q, ch, { suffix: 140 })), null);
  }));

test("بعد از expire شدنِ اولی، همان final دوباره قابلِ‌تخصیص است", live, () =>
  withSchema(async (q) => {
    const ch = await channel(q);
    const first = await request(q, ch);
    await q(`UPDATE payment_requests SET status='expired' WHERE id=$1`, [first.rows[0].id]);
    assert.equal(await code(request(q, ch)), null);
  }));

test("۲۰ درخواستِ هم‌زمان با یک final: دقیقاً یکی موفق است", live, () =>
  withSchema(async (q) => {
    const ch = await channel(q);
    const codes = await Promise.all(Array.from({ length: 20 }, () => code(request(q, ch))));
    assert.equal(codes.filter((c) => c === null).length, 1);
    assert.equal(codes.filter((c) => c === UNIQUE).length, 19);
  }));

test("fixed_link: حداکثر یک pending به‌ازای هر مبلغ، بقیه queued", live, () =>
  withSchema(async (q) => {
    const ch = await channel(q, { kind: "fixed_link" });
    const fixed = { kind: "fixed_link", suffix: 0 };
    await request(q, ch, fixed);
    assert.equal(await code(request(q, ch, fixed)), UNIQUE);
    assert.equal(await code(request(q, ch, { ...fixed, status: "queued", queue: 1, expires: "NULL" })), null);
    assert.equal(await code(request(q, ch, { ...fixed, status: "queued", queue: 2, expires: "NULL" })), null);
    // مبلغِ ثابتِ دیگر → pending مستقل
    assert.equal(await code(request(q, ch, { ...fixed, base: 2_000_000 })), null);
    // fixed_link نمی‌تواند suffix داشته باشد
    assert.equal(await code(request(q, ch, { kind: "fixed_link", base: 3_000_000, suffix: 130 })), CHECK);
  }));

test("قیدهای مبلغ و وضعیت", live, () =>
  withSchema(async (q) => {
    const ch = await channel(q);
    assert.equal(await code(request(q, ch, { base: 0, suffix: 0 })), CHECK, "base > 0");
    assert.equal(await code(request(q, ch, { suffix: 135 })), CHECK, "suffix مضرب ۱۰");
    assert.equal(await code(request(q, ch, { suffix: 10_000 })), CHECK, "suffix ≤ 9990");
    assert.equal(await code(request(q, ch, { expires: "NULL" })), CHECK, "pending بدونِ expires_at");
    assert.equal(await code(request(q, ch, { status: "queued", suffix: 0, expires: "NULL" })), CHECK, "queued بدونِ queue_position");
    assert.equal(await code(request(q, ch, { status: "bogus" })), CHECK);
    assert.equal(await code(request(q, ch, { purpose: "order" })), CHECK, "order بدونِ order_id");
    assert.equal(await code(request(q, ch, { purpose: "wallet_topup", orderId: "o1" })), CHECK, "topup با order_id");
    assert.equal(await code(request(q, ch, { scope: "bot" })), CHECK, "scope=bot بدونِ bot_id");
    // confirmed: باید confirmed_by/at داشته باشد و ادمین‌بودن شناسه‌ی ادمین
    assert.equal(await code(request(q, ch, { status: "confirmed", suffix: 200, expires: "NULL" })), CHECK);
    assert.equal(
      await code(request(q, ch, {
        status: "confirmed", suffix: 210, expires: "NULL", confirmedBy: "admin", confirmedAt: new Date(),
      })),
      CHECK, "تأییدِ ادمین بدونِ confirmed_by_admin_id",
    );
    assert.equal(
      await code(request(q, ch, {
        status: "confirmed", suffix: 220, expires: "NULL", confirmedBy: "sms", confirmedAt: new Date(),
      })),
      null,
    );
  }));

test("کانال: scope/bot_id و فیلدهای لازمِ هر kind", live, () =>
  withSchema(async (q) => {
    const bad = (cols) => code(q(
      `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, payment_url, sms_secret_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'h')`, [id("ch"), ...cols]));
    assert.equal(await bad(["bot", null, "card_manual", "enc", null]), CHECK, "scope=bot بدونِ bot_id");
    assert.equal(await bad(["platform", "b1", "card_manual", "enc", null]), CHECK, "platform با bot_id");
    assert.equal(await bad(["platform", null, "card_manual", null, null]), CHECK, "card_manual بدونِ شماره‌ی کارت");
    assert.equal(await bad(["platform", null, "open_link", null, null]), CHECK, "لینک بدونِ payment_url");
    assert.equal(await bad(["platform", null, "nope", "enc", null]), CHECK);
    assert.equal(await bad(["bot", "b1", "open_link", null, "https://pay.example/x"]), null);
  }));

test("sms_inbox: idempotency، برداشت هرگز match نمی‌شود، هر درخواست حداکثر یک پیامک", live, () =>
  withSchema(async (q) => {
    const ch = await channel(q);
    const sms = (over = {}) => {
      const o = { hash: id("h"), direction: "deposit", amount: 1_000_130, parsed: true, status: "unmatched", req: null, ...over };
      return q(
        `INSERT INTO sms_inbox (id, channel_id, raw_text, received_at, content_hash, direction, amount_rial,
                                parsed_ok, status, matched_request_id)
         VALUES ($1,$2,'t',now(),$3,$4,$5,$6,$7,$8)`,
        [id("sms"), ch, o.hash, o.direction, o.amount, o.parsed, o.status, o.req],
      );
    };
    await sms({ hash: "same" });
    assert.equal(await code(sms({ hash: "same" })), UNIQUE, "همان پیامک دوباره");
    const ch2 = await channel(q);
    assert.equal(await code(q(
      `INSERT INTO sms_inbox (id, channel_id, raw_text, received_at, content_hash) VALUES ($1,$2,'t',now(),'same')`,
      [id("sms"), ch2])), null, "همان hash روی کانالِ دیگر مجاز است");

    const rq = (await request(q, ch)).rows[0].id;
    assert.equal(await code(sms({ status: "matched", req: rq, direction: "withdraw" })), CHECK, "برداشت match نمی‌شود");
    assert.equal(await code(sms({ status: "matched", req: rq, parsed: false })), CHECK, "پارس‌نشده match نمی‌شود");
    assert.equal(await code(sms({ status: "matched", req: null })), CHECK, "matched بدونِ درخواست");
    assert.equal(await code(sms({ status: "unmatched", req: rq })), CHECK, "درخواست بدونِ status=matched");
    assert.equal(await code(sms({ status: "matched", req: rq })), null);
    assert.equal(await code(sms({ status: "matched", req: rq })), UNIQUE, "پیامکِ دوم برای همان درخواست");
    assert.equal(await code(sms({ parsed: true, direction: "unknown" })), CHECK, "parsed_ok با جهتِ unknown");
    assert.equal(await code(sms({ amount: -5 })), CHECK);
  }));
