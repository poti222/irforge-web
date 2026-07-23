import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // FIX [Critical]: Token expiry — sessions now expire after 30 days
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
