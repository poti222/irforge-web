import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  // IRFORGE_PROMPT_V3 Phase 6.2 — despite the column name (kept to avoid
  // touching every call site), this holds sha256(token), never the raw
  // token. A raw session token is bearer-equivalent to being logged in as
  // that user; storing it as-is meant a DB backup/replica/support export —
  // or the plaintext copy this table's rows used to get mirrored into on
  // Google Sheets, see lib/sheetsSync.ts — was as good as a live login for
  // every user in it. sha256 (not HMAC/salted) is enough here: unlike a
  // 6-digit OTP, a session token already carries 128 bits of real
  // randomness (see generateToken in routes/auth.ts), so there's no
  // low-entropy keyspace for a rainbow table to cover. See lib/sessionToken.ts.
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // FIX [Critical]: Token expiry — sessions now expire after 30 days
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // IRFORGE_PROMPT_V3 Phase 6.2 — groundwork for a future "your active
  // sessions" account page: which session was used when, and a coarse
  // fingerprint to tell two sessions apart without storing the raw
  // User-Agent string.
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  userAgentHash: text("user_agent_hash"),
});
