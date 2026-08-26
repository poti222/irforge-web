/**
 * test/auditLog.test.mjs — IRFORGE_PROMPT_V3 Phase 29
 *
 * Covers src/lib/auditLog.ts: the audit tab (admin-user-detail.tsx) used to
 * render only the raw action enum and the free-text reason, discarding the
 * `metadata` the backend (api-server/src/lib/audit.ts) already captures per
 * action. These functions turn that metadata back into the one-line detail
 * a super admin actually needs (what a role changed from/to, how many
 * sessions were revoked, which identity fields changed, ...).
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { auditActionLabel, describeAuditDetail } = await import("../src/lib/auditLog.ts");

// ── auditActionLabel ─────────────────────────────────────────────────────

test("auditActionLabel translates a known action to Persian", () => {
  assert.equal(auditActionLabel("role_changed", true), "تغییر نقش");
});

test("auditActionLabel translates a known action to English", () => {
  assert.equal(auditActionLabel("role_changed", false), "Role changed");
});

test("auditActionLabel falls back to the raw string for an unknown action", () => {
  assert.equal(auditActionLabel("something_new", true), "something_new");
  assert.equal(auditActionLabel("something_new", false), "something_new");
});

test("auditActionLabel covers every action the backend can emit", () => {
  const actions = [
    "telegram_reset", "password_set", "identity_updated", "role_changed",
    "status_changed", "sessions_revoked", "impersonation_started",
    "bot_purged", "ticket_created_notified", "ticket_escalated_notified",
    "plan_changed", "wallet_adjusted",
  ];
  for (const action of actions) {
    assert.notEqual(auditActionLabel(action, true), action, `${action} (fa) should have a real label`);
    assert.notEqual(auditActionLabel(action, false), action, `${action} (en) should have a real label`);
  }
});

// ── describeAuditDetail ──────────────────────────────────────────────────

test("identity_updated lists the changed fields in Persian", () => {
  const detail = describeAuditDetail("identity_updated", { fields: ["name", "email"] }, true);
  assert.equal(detail, "فیلدهای تغییریافته: نام، ایمیل");
});

test("identity_updated lists the changed fields in English", () => {
  const detail = describeAuditDetail("identity_updated", { fields: ["name", "email"] }, false);
  assert.equal(detail, "Changed fields: name, email");
});

test("identity_updated with no fields returns null", () => {
  assert.equal(describeAuditDetail("identity_updated", { fields: [] }, true), null);
  assert.equal(describeAuditDetail("identity_updated", {}, true), null);
});

test("role_changed shows both the previous and new role", () => {
  const detail = describeAuditDetail("role_changed", { from: "admin", to: "super_admin" }, true);
  assert.equal(detail, "از «admin» به «super_admin»");
});

test("role_changed with no previous role still shows the new one", () => {
  const detail = describeAuditDetail("role_changed", { to: "admin" }, false);
  assert.equal(detail, 'New role: "admin"');
});

test("role_changed with no target role returns null", () => {
  assert.equal(describeAuditDetail("role_changed", {}, true), null);
});

test("password_set reports the revoked session count", () => {
  assert.equal(describeAuditDetail("password_set", { sessionsRevoked: 3 }, true), "3 نشست باطل شد");
  assert.equal(describeAuditDetail("password_set", { sessionsRevoked: 1 }, false), "1 session revoked");
  assert.equal(describeAuditDetail("password_set", { sessionsRevoked: 2 }, false), "2 sessions revoked");
});

test("sessions_revoked reports the count", () => {
  assert.equal(describeAuditDetail("sessions_revoked", { count: 5 }, true), "5 نشست باطل شد");
});

test("telegram_reset shows the previous username", () => {
  const detail = describeAuditDetail("telegram_reset", { previousTelegramUsername: "old_user" }, true);
  assert.equal(detail, "یوزرنیمِ قبلی: @old_user");
});

test("telegram_reset with no previous username returns null", () => {
  assert.equal(describeAuditDetail("telegram_reset", { previousTelegramUsername: null }, true), null);
});

test("impersonation_started shows a formatted expiry", () => {
  const detail = describeAuditDetail(
    "impersonation_started", { expiresAt: "2026-01-01T12:00:00.000Z" }, false,
  );
  assert.ok(detail.startsWith("Valid until "));
});

test("bot_purged shows the bot name", () => {
  const detail = describeAuditDetail("bot_purged", { botId: "b1", botName: "My Shop Bot" }, false);
  assert.equal(detail, "Bot: My Shop Bot");
});

test("ticket_created_notified shows the ticket id", () => {
  const detail = describeAuditDetail("ticket_created_notified", { ticketId: "T-42" }, true);
  assert.equal(detail, "تیکت #T-42");
});

test("ticket_escalated_notified shows the ticket id", () => {
  const detail = describeAuditDetail("ticket_escalated_notified", { ticketId: 42 }, false);
  assert.equal(detail, "Ticket #42");
});

test("plan_changed shows the previous and new plan", () => {
  const detail = describeAuditDetail("plan_changed", { from: "free", to: "gold" }, true);
  assert.equal(detail, "از پلن «free» به «gold»");
});

test("plan_changed with a duration appends the day count", () => {
  const detail = describeAuditDetail("plan_changed", { from: "free", to: "gold", durationDays: 30 }, false);
  assert.equal(detail, 'From plan "free" to "gold" (30 days)');
});

test("plan_changed with no previous plan still shows the new one", () => {
  const detail = describeAuditDetail("plan_changed", { to: "gold" }, false);
  assert.equal(detail, 'New plan: "gold"');
});

test("plan_changed with no target plan returns null", () => {
  assert.equal(describeAuditDetail("plan_changed", {}, true), null);
});

test("wallet_adjusted (credit) shows the credited amount", () => {
  const detail = describeAuditDetail("wallet_adjusted", { direction: "credit", amount: 50000 }, true);
  assert.equal(detail, "۵۰٬۰۰۰ تومان شارژ شد");
});

test("wallet_adjusted (debit) shows the debited amount in English", () => {
  const detail = describeAuditDetail("wallet_adjusted", { direction: "debit", amount: 20000 }, false);
  assert.equal(detail, "Debited 20,000 Toman");
});

test("wallet_adjusted with an unknown direction returns null", () => {
  assert.equal(describeAuditDetail("wallet_adjusted", { direction: "refund", amount: 1 }, true), null);
});

test("an unknown action returns null instead of throwing", () => {
  assert.equal(describeAuditDetail("something_new", { anything: true }, true), null);
});

test("null or undefined metadata never throws", () => {
  assert.equal(describeAuditDetail("role_changed", null, true), null);
  assert.equal(describeAuditDetail("role_changed", undefined, true), null);
});
