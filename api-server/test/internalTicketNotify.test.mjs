/**
 * test/internalTicketNotify.test.mjs — IRFORGE_PROMPT_V3 Phase 16
 *
 * This route calls the database (bot lookup, notification insert) with no
 * DB test harness in this repo — same limitation as
 * registrationEmailFlow.test.mjs — so the security-relevant contract is
 * checked against the route's own source, the established pattern for
 * exactly this situation elsewhere in this test suite.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/routes/internalTicketNotify.ts"), "utf8");

test("the route path and header name match what config.py / expiry_worker's sibling call expects", () => {
  assert.match(src, /router\.post\(\s*["']\/internal\/tickets\/notify-new["']/);
  assert.match(src, /X-Ticket-Notify-Secret/);
});

test("the secret compare is constant-time and rejects an empty configured secret", () => {
  assert.match(src, /crypto\.timingSafeEqual\(providedBuf, expectedBuf\)/);
  assert.match(src, /expected\.length > 0/);
  assert.match(src, /providedBuf\.length === expectedBuf\.length/);
});

test("uses a dedicated secret env var, distinct from INTERNAL_PURGE_SECRET", () => {
  assert.match(src, /TICKET_NOTIFY_SECRET/);
  assert.doesNotMatch(src, /INTERNAL_PURGE_SECRET/);
});

test("a missing/wrong secret is rejected with 403 before any DB lookup runs", () => {
  const guard = src.match(/if \(!secretOk\(req\)\) \{[\s\S]{0,200}?403/);
  assert.ok(guard, "the 403 branch must appear before resolveBotBySpreadsheetId is called");
  const secretCheckIndex = src.indexOf("if (!secretOk(req))");
  const dbLookupIndex = src.indexOf("resolveBotBySpreadsheetId(");
  assert.ok(secretCheckIndex >= 0 && dbLookupIndex > secretCheckIndex);
});

test("the notification dedupeKey is per-ticket-per-kind, so a bot retry cannot double-notify", () => {
  assert.match(src, /dedupeKey:\s*`\$\{type\}:\$\{ticketId\}`/);
});

test("new vs escalated map to two distinct notification types", () => {
  assert.match(src, /"bot_new_ticket"/);
  assert.match(src, /"bot_ticket_escalated"/);
});

test("severity is warning, not silently defaulted to info", () => {
  assert.match(src, /severity:\s*"warning"/);
});

test("resolves recipients as owner + bot_managers, not the owner alone", () => {
  assert.match(src, /getBotOwnerAndManagerIds\(bot\.botId, bot\.ownerUserId\)/);
});

test("is rate-limited (the one backstop against brute-forcing the secret, same as the purge route)", () => {
  assert.match(src, /authRateLimit\(\s*["']internal_ticket_notify["']\s*\)/);
});

test("every call is audited, success or not distinguishable from the audit action name", () => {
  assert.match(src, /writeAudit\(/);
  assert.match(src, /"ticket_created_notified"|"ticket_escalated_notified"/);
});
