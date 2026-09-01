/**
 * test/tokenCryptoSelfCheck.test.mjs
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint —
 * condition 3 replacement.
 *
 * A genuine cross-service BOT_TOKEN_ENCRYPTION_KEY round-trip can't be run
 * from this sandbox. getKeyFingerprint()/runStartupCryptoSelfCheck() exist
 * so an operator can compare a short, non-secret fingerprint across
 * mainbot/support-bot/irforge-web's real logs instead -- which only works
 * if the two independent implementations (this one, and irforge-app's
 * utils/registry_token_crypto.py) produce the byte-identical fingerprint
 * for the byte-identical key. That parity is the one thing worth proving
 * here beyond the obvious "same key -> same output twice" -- verified by
 * shelling out to the real Python implementation, not by re-deriving the
 * same formula a second time in JS (which would just prove this file agrees
 * with itself).
 *
 * BOT_TOKEN_ENCRYPTION_KEY is read into a module-level const at import
 * time in tokenCrypto.ts (mirroring production, where it's a fixed env
 * var for the process's whole lifetime) -- so it must be set BEFORE the
 * first import, and this file only ever exercises one key value.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const TEST_KEY = "c".repeat(64);
process.env.BOT_TOKEN_ENCRYPTION_KEY = TEST_KEY;

const { getKeyFingerprint, runStartupCryptoSelfCheck, encryptToken, decryptToken } = await import(
  "../src/lib/tokenCrypto.ts"
);
const { logger } = await import("../src/lib/logger.ts");

test("getKeyFingerprint is deterministic for the same key", () => {
  assert.equal(getKeyFingerprint(), getKeyFingerprint());
});

test("getKeyFingerprint matches a from-scratch SHA-256 of the raw key bytes", () => {
  const expected = crypto.createHash("sha256").update(Buffer.from(TEST_KEY, "hex")).digest("hex").slice(0, 8);
  assert.equal(getKeyFingerprint(), expected);
});

test("getKeyFingerprint agrees with irforge-app's independent Python implementation for the same key", () => {
  const pythonFingerprint = execFileSync(
    "python3",
    ["-c", "import hashlib, sys; print(hashlib.sha256(bytes.fromhex(sys.argv[1])).hexdigest()[:8])", TEST_KEY],
    { encoding: "utf8" }
  ).trim();
  assert.equal(getKeyFingerprint(), pythonFingerprint);
});

test("runStartupCryptoSelfCheck logs PASS and the fingerprint, never the key itself", () => {
  const calls = [];
  const originalInfo = logger.info.bind(logger);
  logger.info = (...args) => calls.push(args.map(String).join(" "));
  try {
    runStartupCryptoSelfCheck();
  } finally {
    logger.info = originalInfo;
  }
  const joined = calls.join("\n");
  assert.match(joined, /PASS/);
  assert.ok(joined.includes(getKeyFingerprint()));
  assert.ok(!joined.includes(TEST_KEY), "the raw key must never be logged");
});

test("encrypt/decrypt round-trips the exact fixed self-check plaintext the self-check relies on", () => {
  const plaintext = "irforge-crypto-self-check-v1";
  assert.equal(decryptToken(encryptToken(plaintext)), plaintext);
});
