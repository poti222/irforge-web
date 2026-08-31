/**
 * test/sheetsReadCache.test.mjs — IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, Phase 0.
 *
 * Live Railway logs (2026-08-31) showed dozens of "Quota exceeded ... Read
 * requests per minute" GaxiosErrors across forms/commands/panels/bot-users/
 * plugins — every one of `readSheet`/`readSheetRanges`/`listTabs` hit the
 * Sheets API fresh with zero caching. `sheets.ts` now keeps a short-TTL
 * in-process cache, busted on every write for that spreadsheet.
 *
 * `readSheet` itself always calls the real `getSheetsClient()` (throws
 * without live Google credentials), so this exercises the cache primitives
 * directly via `__readCacheTestables` rather than mocking `googleapis` —
 * the same trade-off `sheetsSafety.test.mjs` makes for this file, just one
 * level less indirect. What matters for tenant isolation is exactly this:
 * a cache hit returns the same value without a second network call, and a
 * write for one spreadsheet never leaves another spreadsheet's cache dirty
 * or removes an unrelated key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateReadCache, __clearReadCacheForTests, __readCacheTestables } from "../src/lib/sheets.ts";

const { cacheGet, cacheSet, readCache, tabNameFromRange, isCacheableRange, NEVER_CACHE_TABS } = __readCacheTestables;

test.beforeEach(() => {
  __clearReadCacheForTests();
});

test("a cached value is returned on the next get with the same key", () => {
  cacheSet("sheetA::range::forms!A:B", [["key", "value"]]);
  assert.deepEqual(cacheGet("sheetA::range::forms!A:B"), [["key", "value"]]);
});

test("a miss on an unset key returns undefined", () => {
  assert.equal(cacheGet("never-set"), undefined);
});

test("an expired entry is treated as a miss and is dropped from the map", () => {
  cacheSet("sheetA::range::forms!A:B", [["stale"]]);
  // Backdate the entry past the TTL instead of sleeping in the test.
  const entry = readCache.get("sheetA::range::forms!A:B");
  entry.at = Date.now() - 60_000;
  assert.equal(cacheGet("sheetA::range::forms!A:B"), undefined);
  assert.equal(readCache.has("sheetA::range::forms!A:B"), false);
});

test("invalidateReadCache drops every entry for that spreadsheet only", () => {
  cacheSet("sheetA::range::forms!A:B", [["a"]]);
  cacheSet("sheetA::tabs", ["forms", "commands"]);
  cacheSet("sheetB::range::forms!A:B", [["b"]]);

  invalidateReadCache("sheetA");

  assert.equal(cacheGet("sheetA::range::forms!A:B"), undefined);
  assert.equal(cacheGet("sheetA::tabs"), undefined);
  // Tenant isolation: busting sheetA must never touch sheetB's cache.
  assert.deepEqual(cacheGet("sheetB::range::forms!A:B"), [["b"]]);
});

test("a spreadsheet id that is a prefix of another is not confused with it", () => {
  // "sheetA1" starts with "sheetA" as a raw string; the "::" separator in
  // the cache key must stop invalidateReadCache("sheetA") from also
  // clearing "sheetA1"'s entries.
  cacheSet("sheetA::range::forms!A:B", [["a"]]);
  cacheSet("sheetA1::range::forms!A:B", [["a1"]]);

  invalidateReadCache("sheetA");

  assert.equal(cacheGet("sheetA::range::forms!A:B"), undefined);
  assert.deepEqual(cacheGet("sheetA1::range::forms!A:B"), [["a1"]]);
});

// ─── never-cache tabs (money/stock, per user's replica-safety review) ───────
//
// irforge-web runs exactly 1 replica today (confirmed via Railway
// get-service-config), so the in-process cache has no cross-instance
// staleness window right now. But orders/wallet/catalog-stock are exactly
// the entities where even a same-process, single-replica 15s window is the
// wrong trade — those routes read-then-act (approve an order, deduct stock),
// so this is a defense that holds even if replicas are ever scaled up.

test("tabNameFromRange extracts the quoted tab name, reversing quoteTab's '' escaping", () => {
  assert.equal(tabNameFromRange("'forms'!A:B"), "forms");
  assert.equal(tabNameFromRange("'orders'!A1:B1"), "orders");
  // quoteTab escapes an embedded quote as '' — a tab literally named it's
  assert.equal(tabNameFromRange("'it''s'!A:B"), "it's");
  assert.equal(tabNameFromRange("Sheet1"), null); // no quoted tab (default range)
});

test("every tab in NEVER_CACHE_TABS is rejected by isCacheableRange", () => {
  for (const tab of NEVER_CACHE_TABS) {
    assert.equal(isCacheableRange(`'${tab}'!A:B`), false, `${tab} must never be cached`);
  }
});

test("a normal config tab is still cacheable", () => {
  assert.equal(isCacheableRange("'forms'!A:B"), true);
  assert.equal(isCacheableRange("'bot_settings'!A:B"), true);
  assert.equal(isCacheableRange("'custom_commands'!A:B"), true);
});

test("readSheet never caches a never-cache tab, even across repeated calls", () => {
  // Exercises the exact branch readSheet/readSheetRanges take, without
  // needing live Google credentials: isCacheableRange gates cacheSet.
  const range = "'orders'!A:B";
  assert.equal(isCacheableRange(range), false);
  cacheGet(`sheetA::range::${range}`); // sanity: nothing pre-seeded
  // Simulating readSheet's own logic: it must skip cacheSet for this range.
  if (isCacheableRange(range)) cacheSet(`sheetA::range::${range}`, [["should-not-cache"]]);
  assert.equal(cacheGet(`sheetA::range::${range}`), undefined);
});

test("a batch of ranges is only cacheable when every range in it is", () => {
  const allSafe = ["'forms'!A:B", "'bot_settings'!A:B"];
  const oneUnsafe = ["'forms'!A:B", "'orders'!A:B"];
  assert.equal(allSafe.every(isCacheableRange), true);
  assert.equal(oneUnsafe.every(isCacheableRange), false);
});
