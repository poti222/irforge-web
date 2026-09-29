/**
 * test/walletTopupMigration.test.mjs — فاز ۸: مهاجرتِ `wallet_topups`/`sms_logs` به ماژولِ کارت‌به‌کارتِ خودکار
 * (`lib/walletTopupMigration.ts`). معیار: idempotent، بدونِ هیچ اعتبارِ تازه، بدونِ ردیفِ یتیم، گزارشِ کامل،
 * و pendingِ مهاجرت‌شده هنوز با پیامکِ در راه تأیید می‌شود.
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);

import { test } from "node:test";
import assert from "node:assert/strict";
import { DDL_ALL, SITE_TABLES_DDL } from "./helpers/cardPayDdl.mjs";

const M = await import("../src/lib/walletTopupMigration.ts");
const { ingestSms } = await import("../src/lib/smsIngest.ts");
const { matchSms } = await import("../src/lib/paymentMatcher.ts");
const { registerDefaultPaymentEffects } = await import("../src/lib/paymentEffectsBoot.ts");
registerDefaultPaymentEffects();

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const NOW = new Date("2026-09-29T12:00:00Z");
const ago = (min) => new Date(NOW.getTime() - min * 60_000);
const inMin = (min) => new Date(NOW.getTime() + min * 60_000);

async function withDb(fn, { legacyTables = true } = {}) {
  const admin = new Pool({ connectionString: PG_URL, max: 2 });
  const schema = `card_m8_${Math.random().toString(36).slice(2, 10)}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: PG_URL, max: 10, options: `-c search_path=${schema}` });
  await pool.query(DDL_ALL);
  await pool.query(SITE_TABLES_DDL);
  if (!legacyTables) await pool.query("DROP TABLE wallet_topups; DROP TABLE sms_logs;");
  try { await fn(pool); } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

/** سناریوی «واقعی»: همه‌ی وضعیت‌های قدیمی + پیامک‌ها + ledger. */
async function seedLegacy(pool) {
  await pool.query(
    "INSERT INTO platform_settings (key, value) VALUES ('payment_methods', $1)",
    [JSON.stringify({ blubank: { link: "https://bluthlink.example/pay/irforge", enabled: true, note: "" } })]);
  const t = (id, user, req, suffix, status, extra = {}) => pool.query(
    `INSERT INTO wallet_topups (id, user_id, requested_amount, suffix, final_amount, status, matched_sms_id, receipt_image_url,
       receipt_uploaded_at, created_at, expires_at, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, user, req, suffix, extra.final ?? req + suffix, status, extra.sms ?? null, extra.receipt ?? null,
      extra.receipt ? ago(3) : null, extra.created ?? ago(30), extra.expires ?? null, extra.confirmedAt ?? null]);
  await t("T1", "u1", 2_000_000, 1230, "pending", { expires: inMin(10), created: ago(10) });                   // در حالِ پرداخت
  await t("T2", "u2", 3_000_000, 4321, "pending", { expires: inMin(5), created: ago(15) });                    // پسوندِ نامضرب
  await t("T3", "u3", 1_000_000, 1500, "pending", { expires: ago(5), created: ago(25) });                      // مهلت‌گذشته ولی sweep نشده
  await t("T4", "u4", 5_000_000, 2000, "confirmed", { sms: "S1", confirmedAt: ago(600), created: ago(620), expires: ago(590) });
  await t("T5", "u5", 1_000_000, 3000, "confirmed", { confirmedAt: ago(700), created: ago(720), expires: ago(690) });  // تأییدِ دستی
  await t("T6", "u6", 7_000_000, 4000, "confirmed", { sms: "S5", confirmedAt: ago(800), created: ago(820), expires: ago(790) }); // بدونِ credit در ledger
  await t("T7", "u7", 1_000_000, 5000, "canceled", { created: ago(900), expires: ago(880) });
  await t("T8", "u8", 1_000_000, 6000, "expired", { created: ago(950), expires: ago(930) });
  await t("T9", "u9", 2_000_000, 7000, "pending", { expires: inMin(12), created: ago(8), receipt: "https://img.example/r.webp" });
  await t("T10", "u10", 1_000_000, 100, "pending", { final: 1_999_999, expires: inMin(5) });                    // ناسازگار

  const s = (id, text, amount, matched, when) => pool.query(
    "INSERT INTO sms_logs (id, raw_text, sender, parsed_amount, received_at, matched_payment_id, webhook_ip, created_at) VALUES ($1,$2,'Blubank',$3,$4,$5,'1.2.3.4',$4)",
    [id, text, amount, when, matched]);
  await s("S1", "واریز 5,002,000 ریال به حساب شما نشست", 5_002_000, "T4", ago(600));
  await s("S2", "واریز 9,999,990 ریال به حساب شما نشست", 9_999_990, null, ago(500));   // مطابقت نکرد
  await s("S3", "تبلیغاتِ بانک، پیامِ بی‌مبلغ", null, null, ago(400));
  await s("S4", "واریز 1,000,000 ریال به حساب شما نشست", 1_000_000, "T-GONE", ago(300)); // اشاره به سفارشی که وجود ندارد
  await s("S5", "واریز 7,004,000 ریال به حساب شما نشست", 7_004_000, "T6", ago(800));

  // ledgerِ قدیمی: T4 و T5 شارژ شده‌اند؛ T6 نه.
  const led = (id, user, amount, note) => pool.query(
    "INSERT INTO wallet_transactions (id, user_id, type, amount, status, review_note) VALUES ($1,$2,'deposit_blubank',$3,'approved',$4)", [id, user, amount, note]);
  await led("L4", "u4", 5_000_000, "شارژ خودکار کیف‌پول از طریق بلوبانک (سفارش T4)");
  await led("L5", "u5", 1_000_000, "تأییدِ دستیِ سوپرادمین برایِ سفارشِ شارژِ بلوبانک T5");
  await pool.query("INSERT INTO wallets (id, user_id, balance) VALUES ('w4','u4',5000000),('w5','u5',1000000)");
}

const snapshotMoney = async (pool) => ({
  wallets: (await pool.query("SELECT user_id, balance FROM wallets ORDER BY user_id")).rows,
  ledger: (await pool.query("SELECT id, user_id, amount FROM wallet_transactions ORDER BY id")).rows,
});

test("مهاجرت: dry-run گزارشِ واقعی می‌دهد ولی هیچ‌چیز نمی‌نویسد", live, () => withDb(async (pool) => {
  await seedLegacy(pool);
  const before = await snapshotMoney(pool);
  const r = await M.migrateLegacyWalletTopups(pool, { now: NOW, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.topups.total, 10);
  assert.equal(r.topups.migrated, 9);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM payment_requests")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM payment_channels")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM sms_inbox")).rows[0].n, 0);
  assert.deepEqual(await snapshotMoney(pool), before);
}));

test("مهاجرت: نگاشتِ وضعیت‌ها، پیامک‌ها، بدونِ اعتبارِ تازه، گزارشِ یتیم/ledger", live, () => withDb(async (pool) => {
  await seedLegacy(pool);
  const before = await snapshotMoney(pool);
  const r = await M.migrateLegacyWalletTopups(pool, { now: NOW });

  // کانال از تنظیماتِ قدیمی
  assert.equal(r.channel.created, true);
  assert.deepEqual([r.channel.kind, r.channel.active], ["open_link", true]);
  const ch = (await pool.query("SELECT * FROM payment_channels")).rows[0];
  assert.deepEqual([ch.scope, ch.bot_id, ch.payment_url, ch.bank_parser, Number(ch.min_amount_rial)],
    ["platform", null, "https://bluthlink.example/pay/irforge", "blubank", 1_000_000]);

  // نگاشتِ وضعیت
  const st = Object.fromEntries((await pool.query("SELECT legacy_ref, status, confirmed_by, confirmed_by_admin_id, effect_done_at, expires_at, receipt_file_id FROM payment_requests")).rows
    .map((x) => [x.legacy_ref.replace("wallet_topups:", ""), x]));
  assert.equal(st.T1.status, "pending");
  assert.equal(st.T2.status, "pending");
  assert.equal(st.T3.status, "expired");
  assert.deepEqual([st.T4.status, st.T4.confirmed_by], ["confirmed", "sms"]);
  assert.deepEqual([st.T5.status, st.T5.confirmed_by, st.T5.confirmed_by_admin_id], ["confirmed", "admin", "legacy-manual-confirm"]);
  assert.ok(st.T4.effect_done_at && st.T5.effect_done_at, "تأییدشده‌های قدیمی «اثر انجام‌شده» علامت می‌خورند");
  assert.equal(st.T7.status, "canceled");
  assert.equal(st.T8.status, "expired");
  assert.equal(st.T9.status, "awaiting_review");
  assert.equal(st.T9.receipt_file_id, "https://img.example/r.webp");
  assert.equal(st.T10, undefined);                                     // ناسازگار مهاجرت نمی‌شود، گزارش می‌شود

  // مبلغِ نهایی عیناً (حتی پسوندِ نامضرب)
  const t2 = (await pool.query("SELECT * FROM payment_requests WHERE legacy_ref = 'wallet_topups:T2'")).rows[0];
  assert.deepEqual([Number(t2.base_amount_rial), Number(t2.suffix_rial), Number(t2.final_amount_rial)], [3_000_000, 4321, 3_004_321]);

  // پیامک‌ها
  const sms = Object.fromEntries((await pool.query("SELECT legacy_ref, status, direction, parsed_ok, matched_request_id, amount_rial FROM sms_inbox")).rows
    .map((x) => [x.legacy_ref.replace("sms_logs:", ""), x]));
  assert.deepEqual([sms.S1.status, sms.S1.matched_request_id !== null], ["matched", true]);
  assert.equal(sms.S2.status, "unmatched");
  assert.deepEqual([sms.S3.status, sms.S3.parsed_ok, sms.S3.direction], ["ignored", false, "unknown"]);
  assert.equal(sms.S4.status, "unmatched");                            // به سفارشِ ناموجود اشاره داشت
  assert.equal(Number(sms.S2.amount_rial), 9_999_990);
  const linked = (await pool.query("SELECT matched_sms_id FROM payment_requests WHERE legacy_ref = 'wallet_topups:T4'")).rows[0];
  assert.ok(linked.matched_sms_id);

  // هیچ پولِ تازه‌ای وارد کیف‌پول نشد
  assert.deepEqual(await snapshotMoney(pool), before);

  // گزارش
  assert.deepEqual([r.topups.total, r.topups.migrated, r.topups.alreadyMigrated], [10, 9, 0]);
  assert.deepEqual([r.topups.stayedPending, r.topups.movedToReview, r.topups.closedExpired, r.topups.nonMultipleOf10Suffix], [2, 1, 1, 1]);
  assert.equal(r.topups.unmigratable.length, 1);
  assert.equal(r.topups.unmigratable[0].id, "T10");
  assert.deepEqual([r.sms.total, r.sms.migrated, r.sms.deposits, r.sms.ignored, r.sms.linkedToRequest], [5, 5, 4, 1, 2]);
  assert.deepEqual([r.ledger.confirmed, r.ledger.withCredit, r.ledger.confirmedWithoutCredit.map((x) => x.topupId)], [3, 2, ["T6"]]);
  assert.deepEqual([r.orphans.topups, r.orphans.sms], [1, 0]);          // فقط T10
  assert.equal(r.ok, false);
  assert.ok(r.attention.some((a) => a.includes("ledger")));
  const md = M.formatMigrationReport(r);
  assert.match(md, /غیرقابل‌مهاجرت/);
  assert.match(md, /T6/);
  assert.match(md, /❌ ناقص/);
  // ثبتِ رویدادِ مهاجرت برایِ سوپرادمین
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM payment_events WHERE kind = 'legacy_migration'")).rows[0].n, 1);
}));

test("مهاجرت: idempotent — اجرای دوم و اجرای هم‌زمان چیزی نمی‌سازند", live, () => withDb(async (pool) => {
  await seedLegacy(pool);
  await pool.query("DELETE FROM wallet_topups WHERE id = 'T10'");      // بدونِ ناسازگار → کامل
  const first = await M.migrateLegacyWalletTopups(pool, { now: NOW });
  assert.equal(first.ok, true);
  assert.deepEqual([first.orphans.topups, first.orphans.sms], [0, 0]);
  const count = async () => ({
    r: (await pool.query("SELECT COUNT(*)::int AS n FROM payment_requests")).rows[0].n,
    s: (await pool.query("SELECT COUNT(*)::int AS n FROM sms_inbox")).rows[0].n,
    c: (await pool.query("SELECT COUNT(*)::int AS n FROM payment_channels")).rows[0].n,
  });
  const c1 = await count();
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => M.migrateLegacyWalletTopups(pool, { now: NOW })));
  for (const x of [a, b, c]) {
    assert.deepEqual([x.topups.migrated, x.topups.alreadyMigrated, x.sms.migrated, x.sms.alreadyMigrated, x.channel.created], [0, 9, 0, 5, false]);
    assert.equal(x.ok, true);
  }
  assert.deepEqual(await count(), c1);
  // یک ردیفِ قدیمیِ تازه (بعد از اجرای اول) در اجرای بعدی می‌آید و بقیه دست‌نخورده می‌مانند
  await pool.query("INSERT INTO wallet_topups (id, user_id, requested_amount, suffix, final_amount, status, expires_at) VALUES ('T11','u11',1000000,1010,1001010,'canceled',$1)", [ago(1)]);
  const again = await M.migrateLegacyWalletTopups(pool, { now: NOW });
  assert.deepEqual([again.topups.migrated, again.topups.alreadyMigrated, again.ok], [1, 9, true]);
}));

test("pendingِ مهاجرت‌شده هنوز با پیامکِ در راه تأیید می‌شود و همان مبلغِ base را شارژ می‌کند (یک‌بار)", live, () => withDb(async (pool) => {
  await seedLegacy(pool);
  await M.migrateLegacyWalletTopups(pool, { now: NOW });
  const ch = (await pool.query("SELECT * FROM payment_channels")).rows[0];
  const sc = { id: ch.id, scope: "platform", botId: null, active: true, senderAllowlist: [], bankParser: "blubank" };
  const sms = (rial) => `بلو\nواریز پول\n فاطمه عزیز، ${rial.toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 1 ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;
  for (const [id, user, final, base] of [["T1", "u1", 2_001_230, 2_000_000], ["T2", "u2", 3_004_321, 3_000_000]]) {
    const ing = await ingestSms(pool, sc, { text: sms(final), sender: "Blubank", time: NOW.toISOString() }, NOW);
    const out = await matchSms(pool, ing.id, { now: NOW });
    assert.equal(out.outcome, "confirmed", id);
    assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id = $1", [user])).rows[0].balance), base);
    const dup = await ingestSms(pool, sc, { text: sms(final), sender: "Blubank", time: NOW.toISOString() }, NOW);
    assert.equal(dup.inserted, false);
  }
  // pending با فیش (T9) پس از تأییدِ خودکار هم قابل‌تأیید است (awaiting_review)
  const ing9 = await ingestSms(pool, sc, { text: sms(2_007_000), sender: "Blubank", time: NOW.toISOString() }, NOW);
  assert.equal((await matchSms(pool, ing9.id, { now: NOW })).outcome, "confirmed");
  // ردیف‌های مهلت‌گذشته/لغو‌شده هرگز با پیامکِ هم‌مبلغ تأیید نمی‌شوند (T3 expired)
  const ing3 = await ingestSms(pool, sc, { text: sms(1_001_500), sender: "Blubank", time: NOW.toISOString() }, NOW);
  assert.equal((await matchSms(pool, ing3.id, { now: NOW })).outcome, "no_candidate");
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM wallet_transactions WHERE type = 'deposit_card_auto'")).rows[0].n, 3);
}));

test("برخوردِ مبلغِ نهایی با درخواستِ جدیدِ همان کانال → ردیفِ قدیمی expired ثبت می‌شود و در گزارش می‌آید", live, () => withDb(async (pool) => {
  await seedLegacy(pool);
  await pool.query("DELETE FROM wallet_topups WHERE id = 'T10'");
  // کانال + یک درخواستِ جدیدِ pending با همان finalِ T1 (۲٬۰۰۱٬۲۳۰)
  await pool.query(`INSERT INTO payment_channels (id, scope, kind, payment_url, sms_secret_hash, min_amount_rial) VALUES ('pch_pre','platform','open_link','https://x.example/y','h',1000000)`);
  await pool.query(
    `INSERT INTO payment_requests (id, channel_id, channel_kind, scope, user_id, purpose, base_amount_rial, suffix_rial, final_amount_rial, status, expires_at)
     VALUES ('pr_new','pch_pre','open_link','platform','unew','wallet_topup',2000000,1230,2001230,'pending',$1)`, [inMin(20)]);
  const r = await M.migrateLegacyWalletTopups(pool, { now: NOW });
  assert.equal(r.channel.created, false);                              // کانالِ موجود دست‌نخورده
  assert.equal(r.channel.id, "pch_pre");
  assert.equal(r.topups.collisionsExpired, 1);
  assert.equal((await pool.query("SELECT status FROM payment_requests WHERE legacy_ref = 'wallet_topups:T1'")).rows[0].status, "expired");
  assert.equal((await pool.query("SELECT status FROM payment_requests WHERE id = 'pr_new'")).rows[0].status, "pending");
  assert.ok(r.attention.some((a) => a.includes("T1")));
  assert.equal(r.ok, true);                                            // یتیم نیست: ثبت شد (expired)
}));

test("لینکِ تنظیماتِ قدیمی: بدونِ ردیفِ تنظیمات → پیش‌فرضِ env؛ لینکِ نامعتبر → کانالِ جانگهدارِ غیرفعال + هشدار؛ بدونِ داده و کانال → چیزی ساخته نمی‌شود", live, async () => {
  const prev = process.env.BLUBANK_TOPUP_LINK;
  process.env.BLUBANK_TOPUP_LINK = "https://env.example/pay/x";
  try {
    await withDb(async (pool) => {
      const r = await M.migrateLegacyWalletTopups(pool, { now: NOW });
      assert.deepEqual([r.channel.created, r.channel.active], [true, true]);          // بدونِ ردیف: همان معناییِ getPaymentMethods (فعال)
      assert.equal((await pool.query("SELECT payment_url FROM payment_channels")).rows[0].payment_url, "https://env.example/pay/x");
    });
    await withDb(async (pool) => {
      await pool.query("INSERT INTO platform_settings (key, value) VALUES ('payment_methods', $1)", [JSON.stringify({ blubank: { link: "not a url", enabled: true } })]);
      await pool.query(`INSERT INTO wallet_topups (id, user_id, requested_amount, suffix, final_amount, status, expires_at)
        VALUES ('X1','u',1000000,1010,1001010,'expired',$1)`, [ago(5)]);
      const r = await M.migrateLegacyWalletTopups(pool, { now: NOW });
      assert.deepEqual([r.channel.created, r.channel.active], [true, false]);
      assert.ok(r.attention.some((a) => a.includes("جانگه‌دار")));
      assert.equal(r.ok, true);
    });
    await withDb(async (pool) => {
      await pool.query("INSERT INTO platform_settings (key, value) VALUES ('payment_methods', $1)", [JSON.stringify({ blubank: { link: "https://x.example/y", enabled: false } })]);
      const r = await M.migrateLegacyWalletTopups(pool, { now: NOW });
      assert.deepEqual([r.channel.created, r.channel.active], [true, false]);          // در تنظیماتِ قدیمی خاموش بود → خاموش می‌ماند
    });
  } finally {
    if (prev === undefined) delete process.env.BLUBANK_TOPUP_LINK; else process.env.BLUBANK_TOPUP_LINK = prev;
  }
});

test("جدول‌های قدیمی نبود (نصبِ تازه) → رد می‌شود، بدونِ خطا", live, () => withDb(async (pool) => {
  const r = await M.migrateLegacyWalletTopups(pool, { now: NOW });
  assert.equal(r.skipped, "no_legacy_tables");
  assert.match(M.formatMigrationReport(r), /رد شد/);
}, { legacyTables: false }));

test("مهاجرت هرگز به wallets/wallet_transactions نمی‌نویسد (اسکنِ منبع)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/walletTopupMigration.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /(INSERT INTO|UPDATE|DELETE FROM)\s+(wallets|wallet_transactions|wallet_topups|sms_logs)\b/i);
});
