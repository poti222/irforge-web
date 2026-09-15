/**
 * test/cleanupDuplicateBots.test.mjs — IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش D.
 *
 * `scripts/cleanupDuplicateBots.ts`'s two pure functions:
 *   - `groupDuplicateBots`: همان گروه‌بندیِ `dedupeBotsByToken` (توکنِ
 *     رمزگشایی‌شده، ردیفِ رمزگشایی‌نشدنی هرگز گروه نمی‌شود) ولی برخلافِ آن
 *     خودِ گروه‌ها را برمی‌گرداند، نه فقط برنده را — چون این اسکریپت باید
 *     همه‌ی بازنده‌ها را هم بشناسد تا پاکشان کند.
 *   - `classifyDuplicateGroup`: تصمیمِ ادغامِ خودکار در برابرِ نیازِ
 *     بازبینیِ دستی. سه قانونِ ایمنی که این فایل قفل می‌کند:
 *       ۱. status متفاوت در یک گروه → هرگز حدس زده نمی‌شود، کلِ گروه به
 *          بازبینی می‌رود.
 *       ۲. بیش از یک ردیفِ واقعاً sheetId دار در یک گروه → به بازبینی
 *          می‌رود (حذفِ خودکار یعنی یک شیتِ واقعی برایِ همیشه resetSpreadsheet
 *          می‌شد — گاردِ اضافه‌ی خودِ این فاز، فراتر از خواسته‌ی صریحِ کاربر).
 *       ۳. وقتی امن است: فیلدهای tier/isTrial با قاعده‌ی «واقعی برنده‌ی
 *          Unknown است، بینِ چند واقعی جدیدترینِ updatedAt برنده است» ادغام
 *          می‌شوند — دقیقاً قاعده‌ای که کاربر برای expiry_date خواسته.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);

const { groupDuplicateBots, classifyDuplicateGroup } = await import("../scripts/cleanupDuplicateBots.ts");
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");

const TOKEN = "123:AAA";

function bot(overrides = {}) {
  return {
    id: "bot_1",
    token: encryptToken(TOKEN),
    sheetId: null,
    status: "active",
    tier: null,
    tierExpiresAt: null,
    isTrial: false,
    trialExpiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── groupDuplicateBots ──────────────────────────────────────────────────────

test("groupDuplicateBots: بدون هیچ باتی → آرایه‌ی خالی", () => {
  assert.deepEqual(groupDuplicateBots([]), []);
});

test("groupDuplicateBots: باتِ تنها گروه نمی‌شود (دوپلیکیت نیست)", () => {
  assert.deepEqual(groupDuplicateBots([bot({ id: "a" })]), []);
});

test("groupDuplicateBots: چند ردیفِ هم‌توکن یک گروه می‌شوند", () => {
  const groups = groupDuplicateBots([bot({ id: "a" }), bot({ id: "b" }), bot({ id: "c" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 3);
  assert.equal(groups[0].token, TOKEN);
});

test("groupDuplicateBots: توکن‌های واقعاً متفاوت گروهِ جدا می‌شوند و هیچ‌کدام دوپلیکیت نیستند", () => {
  const groups = groupDuplicateBots([
    bot({ id: "a", token: encryptToken("111:AAA") }),
    bot({ id: "b", token: encryptToken("222:BBB") }),
  ]);
  assert.deepEqual(groups, []);
});

test("groupDuplicateBots: ردیفِ رمزگشایی‌نشدنی هرگز گروه نمی‌شود (نه با خودش، نه با بقیه)", () => {
  const groups = groupDuplicateBots([
    bot({ id: "real-1" }),
    bot({ id: "real-2" }),
    bot({ id: "corrupt", token: "aabb:ccdd:eeff" }),
    bot({ id: "corrupt-2", token: "aabb:ccdd:eeff" }), // even two identical corrupt rows never group
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows.map((r) => r.id).sort(), ["real-1", "real-2"]);
});

// ─── classifyDuplicateGroup — safety rules ──────────────────────────────────

test("classifyDuplicateGroup: statusِ متفاوت → نیاز به بازبینی، نه ادغامِ خودکار", () => {
  const rows = [bot({ id: "a", status: "active" }), bot({ id: "b", status: "inactive" })];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.needsReview, true);
  assert.equal(result.reviewReason, "status_conflict");
});

test("classifyDuplicateGroup: دو ردیفِ هر دو با sheetId واقعی → نیاز به بازبینی (گاردِ ایمنی)", () => {
  const rows = [
    bot({ id: "a", sheetId: "sheet_1" }),
    bot({ id: "b", sheetId: "sheet_2" }),
  ];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.needsReview, true);
  assert.equal(result.reviewReason, "multiple_sheets");
});

test("classifyDuplicateGroup: یک ردیفِ sheetId دار در میانِ چندتا → همان برنده، بقیه بازنده", () => {
  const rows = [
    bot({ id: "no-sheet-1" }),
    bot({ id: "has-sheet", sheetId: "sheet_1" }),
    bot({ id: "no-sheet-2" }),
  ];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.needsReview, false);
  assert.equal(result.keeperId, "has-sheet");
  assert.deepEqual(result.loserIds.sort(), ["no-sheet-1", "no-sheet-2"]);
});

test("classifyDuplicateGroup: هیچ‌کدام sheetId ندارند → قدیمی‌ترین برنده است", () => {
  const rows = [
    bot({ id: "newer", createdAt: new Date("2026-02-01") }),
    bot({ id: "older", createdAt: new Date("2026-01-01") }),
  ];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.needsReview, false);
  assert.equal(result.keeperId, "older");
  assert.deepEqual(result.loserIds, ["newer"]);
});

test("classifyDuplicateGroup: tierِ واقعی بر null برتری دارد، حتی اگر روی ردیفِ بازنده باشد", () => {
  const rows = [
    bot({ id: "keeper", sheetId: "sheet_1", tier: null }),
    bot({ id: "loser", tier: "pro", tierExpiresAt: new Date("2026-06-01") }),
  ];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.needsReview, false);
  assert.equal(result.keeperId, "keeper");
  assert.equal(result.mergedFields.tier, "pro");
  assert.deepEqual(result.mergedFields.tierExpiresAt, new Date("2026-06-01"));
});

test("classifyDuplicateGroup: بینِ چند tierِ واقعی، جدیدترینِ updatedAt برنده است", () => {
  const rows = [
    bot({ id: "keeper", sheetId: "sheet_1" }),
    bot({ id: "stale-tier", tier: "standard", updatedAt: new Date("2026-01-01") }),
    bot({ id: "fresh-tier", tier: "pro", updatedAt: new Date("2026-03-01") }),
  ];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.mergedFields.tier, "pro");
});

test("classifyDuplicateGroup: isTrial=true بر false برتری دارد", () => {
  const rows = [
    bot({ id: "keeper", sheetId: "sheet_1", isTrial: false }),
    bot({ id: "loser", isTrial: true, trialExpiresAt: new Date("2026-04-01") }),
  ];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.mergedFields.isTrial, true);
  assert.deepEqual(result.mergedFields.trialExpiresAt, new Date("2026-04-01"));
});

test("classifyDuplicateGroup: هیچ ردیفی tier/isTrialِ واقعی ندارد → merged همه null/false می‌ماند", () => {
  const rows = [bot({ id: "a", sheetId: "sheet_1" }), bot({ id: "b" })];
  const result = classifyDuplicateGroup(TOKEN, rows);
  assert.equal(result.mergedFields.tier, null);
  assert.equal(result.mergedFields.isTrial, false);
});
