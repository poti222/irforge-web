/**
 * lib/sessionToken.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 6.2 — the one place that turns a raw session
 * token into what actually gets stored (`sessions.token` in Postgres, and
 * the mirrored row in the Sheets "sessions" tab — lib/sheetsSync.ts). A raw
 * token is bearer-equivalent to being logged in as that user; every
 * insert/lookup/delete must go through here instead of storing the token
 * itself.
 *
 * Plain sha256, no HMAC/pepper: unlike lib/otp.ts's 6-digit codes (a
 * 1,000,000-entry keyspace a fixed salt can't protect against a
 * precomputed table), a session token already carries 128 bits of real
 * randomness (see generateToken in routes/auth.ts) — there is no feasible
 * table to precompute over 2^128 possibilities regardless of salting.
 */
import crypto from "crypto";

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Coarse fingerprint for telling two sessions apart, without storing the
 * raw User-Agent string (which can carry identifying detail of its own). */
export function hashUserAgent(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  return crypto.createHash("sha256").update(userAgent, "utf8").digest("hex").slice(0, 16);
}
