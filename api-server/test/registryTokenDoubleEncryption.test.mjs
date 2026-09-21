/**
 * test/registryTokenDoubleEncryption.test.mjs
 *
 * Live incident 2026-09-21: an admin replaced a bot's token (PATCH
 * /bots/:botId -> 200, correctly single-encrypted and saved), but the very
 * next media upload was rejected as "token invalid" again -- with Telegram
 * returning error_code 404 "Not Found" for a "token" that was actually 150
 * characters long (a real Telegram token is ~46 chars).
 *
 * Root cause: sheetsSync.ts's buildTenantRegistryValue() has encrypted every
 * registry tenant row's bot_token (both the Postgres and legacy-Sheets write
 * paths) since the Registry R1-R6 encryption migration -- confirmed by its
 * own docstring ("bot_token is encrypted ... never the live token in plain
 * text, on either backend"). But reconcileBotsFromRegistry() in bots.ts
 * (run on every single GET /bots, including the refetch that fires right
 * after a successful token save) was never updated to match: it still
 * treated the registry's bot_token as plaintext, so its "same owner, same
 * sheet" repair branch did `encryptToken(t.bot_token)` on an ALREADY-
 * encrypted value -- re-encrypting a bot's real, working token into
 * unusable double-ciphertext on every reconcile pass.
 *
 * This file pins the crypto-boundary shape of that bug at the two pure
 * functions involved (buildTenantRegistryValue + encryptToken/decryptToken)
 * so it can't silently regress -- reconcileBotsFromRegistry() itself does
 * real Postgres I/O (db.select/db.transaction) and isn't unit-testable
 * without a live database (see botDuplicateToken.test.mjs's own docstring
 * for the same constraint on withTokenCreationLock/tokenUsedInTx).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);

const { __testables } = await import("../src/lib/sheetsSync.ts");
const { buildTenantRegistryValue } = __testables;
const { encryptToken, decryptToken } = await import("../src/lib/tokenCrypto.ts");

// Exactly 46 characters -- the real shape/length of a live Telegram bot
// token (9-10 digit id + ":" + a ~35-char secret) -- so the single- vs
// double-encrypted lengths below match production byte-for-byte.
const REAL_TOKEN = "123456789:" + "A".repeat(36);

test("buildTenantRegistryValue encrypts bot_token -- the registry never holds plaintext", () => {
  const value = buildTenantRegistryValue({
    bot_token: REAL_TOKEN,
    bot_name: "test",
    owner_user_id: "user_1",
  });
  assert.notEqual(value.bot_token, REAL_TOKEN);
  // AES-256-GCM's "iv:tag:ciphertext" hex format -- exactly 3 colon-separated parts.
  assert.equal(value.bot_token.split(":").length, 3);
});

test("decrypting a registry row's bot_token exactly once recovers the real token", () => {
  const registryRow = buildTenantRegistryValue({
    bot_token: REAL_TOKEN,
    bot_name: "test",
    owner_user_id: "user_1",
  });
  assert.equal(decryptToken(registryRow.bot_token), REAL_TOKEN);
});

test("live incident 2026-09-21: re-encrypting a registry row's bot_token WITHOUT decrypting it first produces the exact double-ciphertext shape that broke media uploads", () => {
  const registryRow = buildTenantRegistryValue({
    bot_token: REAL_TOKEN,
    bot_name: "test",
    owner_user_id: "user_1",
  });

  // This is the bug: reconcileBotsFromRegistry() used to do
  // `encryptToken(t.bot_token)` directly on the registry value, which is
  // already ciphertext.
  const doubleEncrypted = encryptToken(registryRow.bot_token);

  // A single decrypt of double-ciphertext succeeds (AES-GCM has no way to
  // know it "shouldn't" -- it just decrypts whatever valid ciphertext it's
  // given) and hands back the ONCE-encrypted value as if it were the real
  // token. That's exactly what botToken()/uploadBufferToBotChat() in
  // botMedia.ts received: a well-formed-looking but Telegram-meaningless
  // 150-char string.
  const onceDecrypted = decryptToken(doubleEncrypted);
  assert.equal(onceDecrypted, registryRow.bot_token);
  assert.notEqual(onceDecrypted, REAL_TOKEN, "a single decrypt of double-ciphertext must NOT yield the real token -- that's the bug");
  assert.equal(onceDecrypted.length, 150, "pins the exact length production logs showed (tokenLength: 150, tokenShapeOk: false)");
  assert.ok(!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(onceDecrypted), "double-ciphertext never matches Telegram's own token shape");
});

test("the fix: decrypting the registry row BEFORE re-encrypting for Postgres storage round-trips to the real token", () => {
  const registryRow = buildTenantRegistryValue({
    bot_token: REAL_TOKEN,
    bot_name: "test",
    owner_user_id: "user_1",
  });

  // What reconcileBotsFromRegistry() does now: decrypt once, THEN encrypt
  // once for storage -- matching every other write path to botsTable.token.
  const plainToken = decryptToken(registryRow.bot_token);
  const storedForPostgres = encryptToken(plainToken);

  assert.equal(decryptToken(storedForPostgres), REAL_TOKEN);
  // A single-encrypted, 150-char real token, not double-encrypted (which
  // would be 264 chars: 24+32+2*150+2 -- encrypting an already-150-char
  // ciphertext instead of the 46-char plaintext).
  assert.equal(storedForPostgres.length, 150, `expected a single-encryption length, got ${storedForPostgres.length}`);
});
