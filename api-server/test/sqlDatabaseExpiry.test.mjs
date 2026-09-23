/**
 * test/sqlDatabaseExpiry.test.mjs — IRFORGE_PAID_SQL_DATABASE_PROMPT
 *
 * همان ترکِ tierExpiry.test.mjs: فقط مسیرهایِ «کاری لازم نیست» تست می‌شوند —
 * باتی که هنوز خیلی تا انقضا مانده، آرایه‌ی خالی، خطای db.select. مسیرِ
 * `handleExpiredSqlDatabase` عمداً اینجا تست نشده چون به چند ماژولِ دیگرِ
 * واقعی دست می‌زند (wallet.ts، notify.ts، botDatabase.ts→sheetsExport.ts) که
 * یک fake سراسریِ db برایِ همه‌شان با هم قابلِ اعتماد نیست.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);

const { db } = await import("@workspace/db");
const mod = await import("../src/lib/sqlDatabaseExpiry.ts");

function fakeSelect(rows) {
  return () => ({ from: () => ({ where: async () => rows }) });
}

test("sweepSqlDatabaseExpiry: باتی که هنوز خیلی تا انقضایِ SQL مانده → هیچ update ای نمی‌زند", async () => {
  const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  db.select = fakeSelect([{ id: "b1", userId: "u1", name: "بات آزمایشی", sheetId: "s1", databaseSqlExpiresAt: farFuture }]);
  let updateCalled = false;
  db.update = () => { updateCalled = true; return { set: () => ({ where: () => ({ returning: async () => [] }) }) }; };

  await mod.sweepSqlDatabaseExpiry();
  assert.equal(updateCalled, false);
});

// 2026-09-23 — new purchases write SQL_DATABASE_UNLIMITED_EXPIRY (year 9999)
// instead of a one-month-out date. No code change was needed in this file
// for that (the existing `> now` comparison already treats it as "not
// expired"), but this test locks that fact down explicitly rather than
// leaving it as an implicit, unverified assumption about a sentinel date.
test("sweepSqlDatabaseExpiry: باتِ نامحدود (سنتینلِ سالِ ۹۹۹۹) → هیچ update/تمدیدی نمی‌زند", async () => {
  const { SQL_DATABASE_UNLIMITED_EXPIRY } = await import("../src/lib/botDatabase.ts");
  db.select = fakeSelect([
    { id: "b1", userId: "u1", name: "بات نامحدود", sheetId: "s1", databaseSqlExpiresAt: SQL_DATABASE_UNLIMITED_EXPIRY },
  ]);
  let updateCalled = false;
  db.update = () => { updateCalled = true; return { set: () => ({ where: () => ({ returning: async () => [] }) }) }; };

  await mod.sweepSqlDatabaseExpiry();
  assert.equal(updateCalled, false, "a bot with the unlimited sentinel must never be treated as expired or near-expiry");
});

test("sweepSqlDatabaseExpiry: آرایه‌ی خالی → بدونِ خطا برمی‌گردد", async () => {
  db.select = fakeSelect([]);
  await assert.doesNotReject(() => mod.sweepSqlDatabaseExpiry());
});

test("sweepSqlDatabaseExpiry: شکستِ db.select → بی‌صدا catch می‌شود، throw نمی‌کند", async () => {
  db.select = () => ({ from: () => ({ where: async () => { throw new Error("connection lost"); } }) });
  await assert.doesNotReject(() => mod.sweepSqlDatabaseExpiry());
});
