import crypto from "crypto";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const KEY_HEX = process.env.BOT_TOKEN_ENCRYPTION_KEY ?? "";

// A fixed, non-secret string -- its content doesn't matter, only that it's
// the exact same literal irforge-app's registry_token_crypto.py self-check
// uses, so a round-trip failure can only mean the key itself is wrong.
const SELF_CHECK_PLAINTEXT = "irforge-crypto-self-check-v1";

function getKey(): Buffer {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error("BOT_TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  }
  return Buffer.from(KEY_HEX, "hex");
}

/**
 * First 8 hex chars of SHA-256(key bytes) -- enough to tell apart two
 * *different* keys by eye/grep across services, never enough to recover
 * the key itself. Hashes the decoded 32 raw bytes, not the hex string, so
 * it can't disagree with irforge-app's identical Python implementation
 * over hex letter-case.
 */
export function getKeyFingerprint(): string {
  return crypto.createHash("sha256").update(getKey()).digest("hex").slice(0, 8);
}

/**
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint —
 * condition 3 replacement. See utils/registry_token_crypto.py's
 * run_startup_crypto_self_check() (irforge-app) for the full reasoning --
 * this is the same check, same fixed plaintext, same fingerprint
 * definition, so the two can be compared by eye in Railway's logs across
 * mainbot/support-bot/irforge-web without anyone ever pasting the key
 * itself anywhere. Deliberately never throws: BOT_TOKEN_ENCRYPTION_KEY
 * isn't required for this service to boot today.
 */
export function runStartupCryptoSelfCheck(): void {
  if (!process.env.BOT_TOKEN_ENCRYPTION_KEY) {
    logger.info(
      "crypto self-check: BOT_TOKEN_ENCRYPTION_KEY is not set -- skipping (nothing " +
        "on the live path requires it yet, but Phase 3 dual-write will)."
    );
    return;
  }
  let fingerprint: string;
  try {
    fingerprint = getKeyFingerprint();
  } catch (err) {
    logger.error({ err }, "crypto self-check: FAIL -- could not derive key fingerprint");
    return;
  }
  try {
    const roundTripped = decryptToken(encryptToken(SELF_CHECK_PLAINTEXT));
    if (roundTripped === SELF_CHECK_PLAINTEXT) {
      logger.info(`crypto self-check: PASS -- key fingerprint=${fingerprint}`);
    } else {
      logger.error(
        `crypto self-check: FAIL -- round-trip produced a different string back; key fingerprint=${fingerprint}`
      );
    }
  } catch (err) {
    logger.error({ err }, `crypto self-check: FAIL -- key fingerprint=${fingerprint}`);
  }
}

// FIX [Critical]: encrypt bot token before storing in DB
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) return stored; // not encrypted (legacy row)
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}
