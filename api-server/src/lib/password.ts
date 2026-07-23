/**
 * lib/password.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for password hashing/verification.
 *
 * FIX [X1]: previously auth.ts hashed with bcrypt while users.ts used
 * SHA-256 + a static salt. That divergence made `PATCH /api/users/password`
 * impossible to satisfy (a bcrypt hash can never equal a sha256 hash) and,
 * if bypassed, would store a password login could never verify. Both routes
 * now import from here so there is exactly one hashing scheme.
 */

import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string | null | undefined
): Promise<boolean> {
  // bcrypt.compare throws on a null/empty hash — guard so callers get `false`.
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}
