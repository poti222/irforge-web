/**
 * test/botTokenReplace.test.mjs
 *
 * Live incident 2026-09-19 -- tracing a "golazin won't start, Token is
 * invalid!" report on the bot-runtime side (irforge-app) led here: the
 * website's "Replace token" feature (TabDanger.tsx -> PATCH /bots/:botId
 * with a `token` field) had two real gaps, both traced by reading the
 * route directly (real Postgres/registry integration isn't available in
 * this sandbox -- same reasoning as botDuplicateToken.test.mjs's own note
 * on withTokenCreationLock/tokenUsedInTx, verified structurally here
 * rather than mocked):
 *
 *   1. No duplicate-token check. Every OTHER token-accepting route
 *      (POST /bots, /bots/trial, /bots/wallet-purchase, POST /admin/bots)
 *      calls isTokenAlreadyUsed() first; this one didn't, so "Replace
 *      token" could silently point a bot at a token another bot already
 *      owns -- the exact two-rows-one-real-token registry shape
 *      (utils/registry.py's dedupe/repair, irforge-app) that caused
 *      today's whole incident, just reached from the opposite direction.
 *
 *   2. No registry re-sync. This route only ever updated bots.token in
 *      Postgres and called syncBotUpsert() (metadata-only mirror). The bot
 *      RUNTIME doesn't read bots.token at all -- it reads the registry
 *      `tenants` tab, which every OTHER write path here (status toggle,
 *      resync, approve-payment) keeps in sync via syncTenantUpsert(). A
 *      token "fixed" through this route looked corrected in the UI/DB but
 *      the tenant kept running (or failing to start) against whatever
 *      stale token the registry still had, until some unrelated action
 *      happened to trigger a sync.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(__dirname, "../src/routes/bots.ts"), "utf-8");

function patchBotsSection() {
  const start = routeSource.indexOf('router.patch("/bots/:botId"');
  assert.ok(start >= 0, 'router.patch("/bots/:botId", ...) must exist');
  const end = routeSource.indexOf('router.delete("/bots/:botId"', start);
  assert.ok(end > start, "could not find the end of the PATCH /bots/:botId handler");
  const raw = routeSource.slice(start, end);
  // Strip full-line `//` comments before matching. The handler's own
  // incident-context comments mention `syncTenantUpsert()` and `isTokenAlreadyUsed(...)`
  // by name in prose, which would otherwise collide with indexOf/regex
  // checks meant to find the real call sites.
  return raw.replace(/^\s*\/\/.*$/gm, "");
}

test("isTokenAlreadyUsed accepts an excludeBotId so a bot can keep its own current token", () => {
  const sig = routeSource.match(/async function isTokenAlreadyUsed\(([^)]*)\)/);
  assert.ok(sig, "isTokenAlreadyUsed signature must be present");
  assert.match(sig[1], /excludeBotId/, "must accept an excludeBotId parameter");
  const body = routeSource.slice(routeSource.indexOf("async function isTokenAlreadyUsed"));
  const guardIdx = body.search(/if \(excludeBotId && b\.id === excludeBotId\) return false;/);
  assert.ok(guardIdx > 0 && guardIdx < 300, "must skip the bot's own row before comparing tokens");
});

test("PATCH /bots/:botId checks isTokenAlreadyUsed before writing a replacement token", () => {
  const section = patchBotsSection();
  const checkIdx = section.search(/isTokenAlreadyUsed\(newToken, req\.params\.botId\)/);
  const updateIdx = section.indexOf(".update(botsTable)");
  assert.ok(checkIdx >= 0, "must call isTokenAlreadyUsed(newToken, botId) for a token replacement");
  assert.ok(updateIdx > checkIdx, "the duplicate check must run BEFORE the Postgres write");
});

test("PATCH /bots/:botId rejects a duplicate replacement token with 409 duplicate_token", () => {
  const section = patchBotsSection();
  const checkIdx = section.indexOf("isTokenAlreadyUsed(newToken, req.params.botId)");
  const nearby = section.slice(checkIdx, checkIdx + 250);
  assert.match(nearby, /status\(409\)/);
  assert.match(nearby, /duplicate_token/);
});

test("PATCH /bots/:botId re-syncs the registry tenant row when the token changes and a sheet is assigned", () => {
  const section = patchBotsSection();
  const updateIdx = section.indexOf(".update(botsTable)");
  const syncIdx = section.indexOf("syncTenantUpsert(", updateIdx);
  assert.ok(syncIdx > updateIdx, "syncTenantUpsert must be called after the Postgres write");

  // Guarded on both the token actually changing AND the bot already having
  // a sheet (matching every other sync call site's own guard shape).
  const guardSection = section.slice(section.lastIndexOf("if (", syncIdx), syncIdx);
  assert.match(guardSection, /newToken !== undefined/);
  assert.match(guardSection, /bot\.sheetId/);

  const call = section.slice(syncIdx, syncIdx + 400);
  assert.match(call, /bot_token:\s*newToken/, "must push the NEW plaintext token, not the stale one");
});

test("PATCH /bots/:botId also re-syncs the sheet_pool used_by row when the token changes", () => {
  const section = patchBotsSection();
  const tenantSyncIdx = section.indexOf("syncTenantUpsert(");
  const poolSyncIdx = section.indexOf("syncSheetPoolUpsert(", tenantSyncIdx);
  assert.ok(poolSyncIdx > tenantSyncIdx, "syncSheetPoolUpsert must be called alongside syncTenantUpsert");
  const call = section.slice(poolSyncIdx, poolSyncIdx + 200);
  assert.match(call, /used_by:\s*newToken/);
});

test("PATCH /bots/:botId does not touch the registry when only name/description change (no token field)", () => {
  const section = patchBotsSection();
  // The registry re-sync block must itself be gated on newToken !== undefined
  // -- already asserted above -- so a plain rename never fires it. Cross-check
  // there is exactly one syncTenantUpsert call site in this handler (the
  // token-replacement one), not an unconditional one that would run on every
  // PATCH regardless of what changed.
  const matches = section.match(/syncTenantUpsert\(/g) ?? [];
  assert.equal(matches.length, 1, "exactly one syncTenantUpsert call site, gated on the token change");
});
