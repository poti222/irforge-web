/**
 * test/botLifecycle.test.mjs — لایوباگ ۲۰۲۶-۱۰-۰۶: «بات‌ها وقتی زمانشان تمام می‌شود پاک نمی‌شوند؛ پرو و استاندارد
 * اصلاً زمان ندارند؛ تریال ۷ روز، استاندارد و پرو ۳۰ روز».
 *
 * جاروی واقعیِ `sweepBotLifecycle` روی Postgres واقعی (جدول‌ها از روی تعریفِ drizzle): تریالِ تمام‌شده → قطعِ سرویس +
 * شمارشِ معکوسِ ۷ روزه + هشدار؛ رسیدنِ زمان → حذفِ کامل؛ تمدید → لغوِ شمارش؛ باتِ پکیج‌دارِ بی‌تاریخ → ۳۰ روز.
 * فقط با CARD_TEST_PG_URL.
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "ab".repeat(32);

import { test } from "node:test";
import assert from "node:assert/strict";

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const schema = `lc_${Math.random().toString(36).slice(2, 10)}`;
let admin = null;
if (PG_URL && Pool) {
  admin = new Pool({ connectionString: PG_URL, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(PG_URL);
  u.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = u.toString();
} else {
  process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
}

const dbm = await import("@workspace/db");
const { ddlFor } = await import("./helpers/drizzleDdl.mjs");
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");
const { sweepBotLifecycle, MAX_PURGES_PER_SWEEP } = await import("../src/lib/botLifecycle.ts");
const { eq } = await import("drizzle-orm");

const DAY = 86_400_000;
const ago = (ms) => new Date(Date.now() - ms);
const inFuture = (ms) => new Date(Date.now() + ms);

let n = 0;
async function addBot(over = {}) {
  const id = `bot_${++n}_${Math.random().toString(36).slice(2, 6)}`;
  await dbm.db.insert(dbm.botsTable).values({
    id, name: `بات ${n}`, token: encryptToken(`${100000 + n}:TOKEN${n}`), userId: "u1",
    status: "active", paymentStatus: "approved", ...over,
  });
  return id;
}
const getBot = async (id) => (await dbm.db.select().from(dbm.botsTable).where(eq(dbm.botsTable.id, id)))[0] ?? null;
const notifs = async (botId) => (await dbm.db.select().from(dbm.notificationsTable)).filter((x) => x.botId === botId || (x.dedupeKey ?? "").includes(botId));

async function setup() {
  await dbm.pool.query(ddlFor(dbm.usersTable, dbm.botsTable, dbm.notificationsTable, dbm.installedPluginsTable, dbm.adminAuditLogTable));
  await dbm.pool.query("CREATE TABLE commands (id text primary key, bot_id text)");
  // همان ایندکسِ یکتایی که migrate.mjs می‌سازد (trial.ts به آن تکیه می‌کند تا اعلانِ تکراری نسازد).
  await dbm.pool.query("CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL");
  await dbm.pool.query("INSERT INTO users (id, name, email, role) VALUES ('u1','مالک','o@example.com','user')");
}
let ready = null;
const once = () => (ready ??= setup());

test("تریالِ تازه‌تمام‌شده: سرویس قطع، شمارشِ معکوسِ ۷ روزه، هشدار — ولی هنوز پاک نمی‌شود", live, async () => {
  await once();
  const id = await addBot({ isTrial: true, trialExpiresAt: ago(60 * 60 * 1000) });
  await sweepBotLifecycle();
  const bot = await getBot(id);
  assert.ok(bot, "هنوز نباید پاک شود");
  assert.equal(bot.status, "expired", "سرویس قطع شد");
  const left = (bot.purgeAfter.getTime() - Date.now()) / DAY;
  assert.ok(left > 6.9 && left <= 7.01, `purge_after ≈ ۷ روز بعد (الان ${left})`);
  const types = (await notifs(id)).map((x) => x.type).sort();
  assert.ok(types.includes("trial_expired"));
  assert.ok(types.includes("bot_purge_warning"), "هشدارِ «۷ روز تا حذف»");
  // دورِ دوم: هیچ اعلانِ تکراری
  const before = (await notifs(id)).length;
  await sweepBotLifecycle();
  assert.equal((await notifs(id)).length, before, "dedupe");
});

test("باتِ از ماه‌ها پیش منقضی‌شده: حذفِ ناگهانی نه — ۷ روزِ کاملِ مهلت از اولین دیده‌شدن", live, async () => {
  await once();
  const id = await addBot({ isTrial: true, trialExpiresAt: ago(60 * DAY), status: "expired" });
  await sweepBotLifecycle();
  const bot = await getBot(id);
  assert.ok(bot, "نباید در همان دورِ اول پاک شود");
  assert.ok(bot.purgeAfter.getTime() - Date.now() > 6.9 * DAY);
});

test("رسیدنِ purge_after: بات + کامندها + پلاگین‌ها پاک، اعلانِ نهایی و ردپای audit", live, async () => {
  await once();
  const id = await addBot({ isTrial: true, trialExpiresAt: ago(8 * DAY), status: "expired", purgeAfter: ago(60 * 1000) });
  await dbm.pool.query("INSERT INTO commands (id, bot_id) VALUES ($1,$2)", [`c_${id}`, id]);
  const r = await sweepBotLifecycle();
  assert.ok(r.purged >= 1);
  assert.equal(await getBot(id), null, "بات پاک شد");
  assert.equal((await dbm.pool.query("SELECT 1 FROM commands WHERE bot_id = $1", [id])).rowCount, 0, "کامندهایش هم");
  const final = (await dbm.db.select().from(dbm.notificationsTable)).find((x) => x.dedupeKey === `bot-purged:${id}`);
  assert.ok(final, "اعلانِ «بات حذف شد»");
  assert.equal(final.botId, null);
  const audit = await dbm.pool.query("SELECT action, reason FROM admin_audit_log WHERE metadata::text LIKE $1", [`%${id}%`]);
  assert.equal(audit.rows[0]?.action, "bot_purged");
  assert.equal(audit.rows[0]?.reason, "expiry");
});

test("پکیجِ استاندارد: تاریخ گذشته + تمدیدِ خودکار ناموفق (tier_expired) + مهلت تمام → حذف؛ فقط با tier_expired", live, async () => {
  await once();
  const dead = await addBot({ tier: "standard", tierExpiresAt: ago(9 * DAY), status: "tier_expired", purgeAfter: ago(1000) });
  const notYet = await addBot({ tier: "pro", tierExpiresAt: ago(9 * DAY), status: "active", purgeAfter: ago(1000) }); // جاروی تمدید هنوز نرسیده
  await sweepBotLifecycle();
  assert.equal(await getBot(dead), null, "پکیجِ تمدید‌نشده پاک شد");
  const kept = await getBot(notYet);
  assert.ok(kept, "تاریخش گذشته ولی تمدیدِ خودکار هنوز امتحان نشده ⇒ هرگز اشتباهی حذف نشود");
  assert.equal(kept.purgeAfter, null, "منقضی حساب نمی‌شود ⇒ شمارشِ معکوس پاک شد");
});

test("تمدید/تمدیدِ تاریخ ⇒ شمارشِ معکوسِ حذف لغو می‌شود", live, async () => {
  await once();
  const id = await addBot({ tier: "standard", tierExpiresAt: inFuture(20 * DAY), status: "active", purgeAfter: inFuture(2 * DAY) });
  await sweepBotLifecycle();
  assert.equal((await getBot(id)).purgeAfter, null);
  const trial = await addBot({ isTrial: true, trialExpiresAt: inFuture(3 * DAY), purgeAfter: inFuture(DAY) });
  await sweepBotLifecycle();
  assert.equal((await getBot(trial)).purgeAfter, null);
});

test("هشدارِ دوم: ≤۳ روز تا حذف", live, async () => {
  await once();
  const id = await addBot({ tier: "pro", tierExpiresAt: ago(5 * DAY), status: "tier_expired", purgeAfter: inFuture(2 * DAY) });
  await sweepBotLifecycle();
  assert.ok(await getBot(id));
  const n = (await dbm.db.select().from(dbm.notificationsTable)).filter((x) => (x.dedupeKey ?? "").startsWith(`bot-purge-final_warning:${id}`));
  assert.equal(n.length, 1);
  assert.equal(n[0].severity, "critical");
});

test("استاندارد/پرو بدونِ تاریخ ⇒ ۳۰ روز از الان؛ سفارشی/بی‌پکیج دست‌نخورده", live, async () => {
  await once();
  const std = await addBot({ tier: "standard" });
  const pro = await addBot({ tier: "pro" });
  const custom = await addBot({ tier: "custom" });
  const none = await addBot({});
  await sweepBotLifecycle();
  for (const id of [std, pro]) {
    const b = await getBot(id);
    const days = (b.tierExpiresAt.getTime() - Date.now()) / DAY;
    assert.ok(days > 29.9 && days <= 30.01, `۳۰ روز (الان ${days})`);
  }
  assert.equal((await getBot(custom)).tierExpiresAt, null);
  assert.equal((await getBot(none)).tierExpiresAt, null);
  assert.ok((await notifs(std)).some((x) => x.type === "tier_period_started"));
  // دومی هیچ تغییری نمی‌دهد
  const t1 = (await getBot(std)).tierExpiresAt.getTime();
  await sweepBotLifecycle();
  assert.equal((await getBot(std)).tierExpiresAt.getTime(), t1);
});

test("سقفِ حذف در هر دور: بیش از MAX_PURGES_PER_SWEEP بات یک‌جا پاک نمی‌شود", live, async () => {
  await once();
  const ids = [];
  for (let i = 0; i < MAX_PURGES_PER_SWEEP + 3; i++) {
    ids.push(await addBot({ isTrial: true, trialExpiresAt: ago(9 * DAY), status: "expired", purgeAfter: ago(1000) }));
  }
  const r = await sweepBotLifecycle();
  assert.equal(r.purged, MAX_PURGES_PER_SWEEP);
  const remaining = (await Promise.all(ids.map(getBot))).filter(Boolean).length;
  assert.equal(remaining, 3);
  await sweepBotLifecycle();
  assert.equal((await Promise.all(ids.map(getBot))).filter(Boolean).length, 0, "دورِ بعد بقیه");
});

test.after(async () => {
  if (admin) {
    try { await dbm.pool.end(); } catch { /* ignore */ }
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } catch { /* ignore */ }
    await admin.end();
  }
});
