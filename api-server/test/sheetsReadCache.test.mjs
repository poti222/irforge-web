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

const { cacheGet, cacheSet, readCache } = __readCacheTestables;

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
