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
const { dedupeBotsByToken, computeResolvedSheetIds } = __testables;
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");

function bot(overrides = {}) {
  return {
    id: "bot_1",
    token: encryptToken("123:AAA"),
    sheetId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
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

test("وقتی هیچ‌کدام شیت ندارند، آنی که اخیراً واقعاً به‌روزرسانی شده برنده است", () => {
  const rows = [
    bot({ id: "stale", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") }),
    bot({ id: "recently-touched", createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-05T00:00:00Z") }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "recently-touched");
});

test("live incident 2026-09-19: یک ردیفِ قدیمی‌تر ولی به‌تازگی toggle‌شده (مثلاً Start/Stop) باید برنده شود، نه ردیفِ تازه‌درج‌شده و دست‌نخورده", () => {
  // Both have a sheetId (the real, live shape of the actual production
  // incident — both rows are usable bots, not "a real one vs. an orphan").
  // "original" is the row the user has actually been toggling on/off via
  // the website (its updatedAt keeps advancing); "fresher-insert" is a
  // duplicate that was created later but never touched again since.
  const rows = [
    bot({
      id: "original", sheetId: "sheet_1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-09-19T15:00:00Z"), // just toggled by the user
    }),
    bot({
      id: "fresher-insert", sheetId: "sheet_2",
      createdAt: new Date("2026-01-02T00:00:00Z"), // created AFTER "original"
      updatedAt: new Date("2026-01-02T00:00:00Z"), // never touched since
    }),
  ];
  const result = dedupeBotsByToken(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "original", "آخرین ردیفِ واقعاً به‌روزرسانی‌شده باید نمایش داده شود، نه صرفاً جدیدترین درجِ اولیه");
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

test("گزارشِ کاربر: وقتی دو ردیفِ هم‌توکن دقیقاً همان updatedAt دارند، برنده مستقل از ترتیبِ ورودی است (نه صرفاً «هر کدوم اول iterate شد»)", () => {
  // db.select() بالادست هیچ ORDER BY ندارد، پس ترتیبِ rows بینِ دو فراخوانیِ
  // پشتِ‌سرهم تضمین‌شده نیست. قبل از این فیکس، تساویِ دقیقِ updatedAt یعنی
  // `current.updatedAt >= bot.updatedAt` همیشه true می‌داد، پس برنده = هر
  // کدوم زودتر در آرایه بود — دقیقاً همون چیزی که «رفرشِ اول بات X روشنه،
  // رفرشِ دوم بات Y روشنه» را توضیح می‌دهد بدونِ اینکه واقعاً چیزی در
  // Postgres عوض شده باشد.
  const tiedAt = new Date("2026-09-22T12:00:00Z");
  const a = bot({ id: "row-a", sheetId: "sheet_1", status: "active", updatedAt: tiedAt });
  const b = bot({ id: "row-b", sheetId: "sheet_1", status: "inactive", updatedAt: tiedAt });

  const orderOne = dedupeBotsByToken([a, b]);
  const orderTwo = dedupeBotsByToken([b, a]);

  assert.equal(orderOne.length, 1);
  assert.equal(orderTwo.length, 1);
  assert.equal(orderOne[0].id, orderTwo[0].id, "همان بات، صرف‌نظر از اینکه کدوم اول در آرایه بود، باید برنده باشد");
  assert.equal(orderOne[0].status, orderTwo[0].status, "همان status، بدونِ پلک‌زدن بینِ رفرش‌ها");
});

// ─── computeResolvedSheetIds — گزارشِ کاربر ۲۰۲۶-۰۹-۲۲: «My Products» بینِ
// رفرش‌ها status سه بات کاملاً متفاوت را عوض می‌کرد، نه یک باتِ تکراری.
// فیکسِ بالا (dedupeBotsByToken) این حالت را نمی‌گرفت چون هر بات توکنِ خودش
// را دارد -- ریشه‌ی واقعی در reconcileBotsFromRegistry بود: readAllTenants()
// بدونِ dedup است، پس یک ردیفِ رجیستریِ کهنه (توکنِ عوض‌شده، همان sheetId)
// می‌توانست شاخه‌ی «همان owner همان sheet» را بگیرد و بات درست را با دیتایِ
// کهنه بازنویسی کند. computeResolvedSheetIds تصمیمِ خالصِ پشتِ فیکس است:
// هر sheetId که از قبل با یک توکنِ واقعی مچ شده، دیگر کاندیدِ آن شاخه نیست.
test("computeResolvedSheetIds: sheetId ای که با توکنِ واقعی مچ شده resolved است", () => {
  const known = new Set(["real-token-abc"]);
  const result = computeResolvedSheetIds(
    [{ plainToken: "real-token-abc", sheetId: "sheet_1" }],
    known
  );
  assert.ok(result.has("sheet_1"));
});

test("computeResolvedSheetIds: ردیفِ رجیستریِ کهنه (توکنِ نامچ، همان sheetId) resolved حساب نمی‌شود", () => {
  // این دقیقاً سناریوی زنده است: یک تننت دو ردیفِ رجیستری دارد -- یکی با
  // توکنِ فعلی (که با byToken مچ می‌شود) و یکی کهنه با توکنِ قبلی، هر دو
  // روی همان sheetId.
  const known = new Set(["current-token"]);
  const result = computeResolvedSheetIds(
    [
      { plainToken: "current-token", sheetId: "sheet_1" },
      { plainToken: "stale-old-token", sheetId: "sheet_1" },
    ],
    known
  );
  assert.deepEqual([...result], ["sheet_1"], "همان یک sheetId -- کافی است یکی از ردیف‌ها مچ کرده باشد");
});

test("computeResolvedSheetIds: بدونِ هیچ توکنِ واقعیِ مچ‌شده، sheetId اصلاً resolved نمی‌شود", () => {
  const known = new Set(["something-else"]);
  const result = computeResolvedSheetIds(
    [{ plainToken: "unmatched-token", sheetId: "sheet_1" }],
    known
  );
  assert.equal(result.size, 0, "بدونِ مچِ توکن، sheetId نباید مانعِ شاخه‌ی import/insert معمولی شود");
});

test("computeResolvedSheetIds: sheetId خالی/نال هیچ‌وقت اضافه نمی‌شود، حتی با توکنِ مچ‌شده", () => {
  const known = new Set(["real-token"]);
  const result = computeResolvedSheetIds([{ plainToken: "real-token", sheetId: null }], known);
  assert.equal(result.size, 0);
});
