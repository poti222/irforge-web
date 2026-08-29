/**
 * test/completeProfile.test.mjs
 *
 * No live-DB integration harness in this repo (same situation as
 * loginEmailFlow.test.mjs/registrationEmailFlow.test.mjs) — these are
 * source-text checks of the structural/security properties that matter
 * most for PATCH /auth/complete-profile: it's gated, it never accepts
 * Telegram/OAuth fields from the client, and only real uniqueness
 * conflicts get 409 (everything else is a 400 on a malformed value).
 * The pure logic this route calls into (checkProfile, identityHeuristics)
 * is unit-tested directly in profile.test.mjs / identityHeuristics.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/routes/completeProfile.ts"), "utf8");

test("PATCH /auth/complete-profile requires auth and rate-limits by IP", () => {
  assert.match(
    src,
    /router\.patch\(\s*["']\/auth\/complete-profile["']\s*,\s*authRateLimit\([^)]*\)\s*,\s*requireAuth/,
  );
});

test("never accepts Telegram identity fields from the request body — bot-linking is the only path", () => {
  assert.doesNotMatch(src, /body\.telegramId|body\.telegramUsername|body\.telegramFirstName/);
});

test("never lets the client set oauthProvider — it's set once at account creation only", () => {
  assert.doesNotMatch(src, /body\.oauthProvider|updates\.oauthProvider/);
});

test("only the three real uniqueness conflicts (email/phone/username) use 409 — everything else is 400", () => {
  const conflictLines = [...src.matchAll(/FieldValidationError\([^)]*\)/g)].map((m) => m[0]);
  const with409 = conflictLines.filter((l) => l.includes(", 409)"));
  assert.equal(with409.length, 3, `expected exactly 3 calls with a 409 status, found ${with409.length}`);
  for (const line of with409) {
    assert.match(line, /_taken/, `409 call should be a "*_taken" conflict, got: ${line}`);
  }
});

test("the name/gender mismatch heuristic only re-runs when name or gender is actually in this request", () => {
  const heuristicBlock = src.slice(src.indexOf("hasField(\"name\") || hasField(\"gender\")"));
  assert.match(heuristicBlock, /nameGenderMismatch/);
});

test("a completed profile gets identityCompletedAt set exactly once, never re-updated", () => {
  assert.match(src, /profile\.complete && !updated\.identityCompletedAt/);
});

test("password is hashed before storage, never stored raw", () => {
  assert.match(src, /hashPassword\(body\.password\)/);
  assert.doesNotMatch(src, /passwordHash:\s*body\.password\b/);
});
