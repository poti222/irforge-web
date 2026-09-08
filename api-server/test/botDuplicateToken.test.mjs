/**
 * test/botDuplicateToken.test.mjs
 *
 * Bug report: creating one bot produced several Postgres rows for it, only
 * one of which actually worked ("پلاگین‌ها 3 تا شدن" was the downstream
 * symptom in the plugin-catalog case, but for bots the row itself is what
 * multiplied). Root cause: `bots.token` is AES-GCM ciphertext with a random
 * IV per row, so it can never carry a real unique index -- duplicate
 * protection was a plain check-then-insert with nothing between the two,
 * and `reconcileBotsFromRegistry()` (run on every GET /bots) was the most
 * exploitable copy of that race since two tabs/devices loading the
 * dashboard around the same moment both see "no row yet" for the same
 * tenant and both insert one.
 *
 * `withTokenCreationLock`/`tokenUsedInTx` (the actual fix, a real
 * `pg_advisory_xact_lock`) need a real Postgres to mean anything -- a mock
 * can't tell "acquired then re-checked" apart from "always says yes",
 * which is the exact bug this exists to catch. That half was verified live
 * against a local Postgres instead (two genuinely concurrent callers for
 * the same token: exactly one insert, the loser's re-check inside the lock
 * correctly saw the winner's committed row) -- see PROGRESS.md. This file
 * covers the half that IS meaningfully unit-testable: `dedupeBotsByToken`,
 * the defensive net GET /bots applies so pre-existing duplicates (or any
 * future gap this doesn't cover) never render as separate bots to the user
 * regardless of what caused them.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);

const { __testables } = await import("../src/routes/bots.ts");
const { dedupeBotsByToken } = __testables;
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");

function bot(overrides = {}) {
  return {
    id: "bot_1",
    token: encryptToken("123:AAA"),
    sheetId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

test("سه ردیفِ هم‌توکن یک بات می‌شوند", () => {
  const rows = [
    bot({ id: "a" }),
    bot({ id: "b" }),
    bot({ id: "c" }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 1);
});

test("در میانِ چند ردیفِ هم‌توکن، آنی که شیت دارد برنده است", () => {
  const rows = [
    bot({ id: "no-sheet", sheetId: null, createdAt: new Date("2026-01-01") }),
    bot({ id: "has-sheet", sheetId: "sheet_1", createdAt: new Date("2026-01-02") }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "has-sheet");
});

test("وقتی هیچ‌کدام شیت ندارند، قدیمی‌ترین (نه آخرین درجِ تکراری) برنده است", () => {
  const rows = [
    bot({ id: "older", createdAt: new Date("2026-01-01T00:00:00Z") }),
    bot({ id: "newer", createdAt: new Date("2026-01-02T00:00:00Z") }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "older");
});

test("توکن‌های واقعاً متفاوت هر دو باقی می‌مانند", () => {
  const rows = [
    bot({ id: "a", token: encryptToken("111:AAA") }),
    bot({ id: "b", token: encryptToken("222:BBB") }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 2);
});

test("ردیفِ رمزگشایی‌نشدنی هرگز بی‌صدا حذف نمی‌شود", () => {
  const rows = [
    bot({ id: "real", token: encryptToken("111:AAA") }),
    bot({ id: "corrupt", token: "aabb:ccdd:eeff" }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 2, "یک ردیفِ رمزگشایی‌نشدنی باید نگه داشته شود، نه گم شود");
  assert.ok(result.some((b) => b.id === "corrupt"));
});

test("بدون هیچ باتی → آرایه‌ی خالی", () => {
  assert.deepEqual(dedupeBotsByToken([]), []);
});

test("یک بات تنها، دست‌نخورده برمی‌گردد", () => {
  const rows = [bot({ id: "only-one" })];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "only-one");
});
