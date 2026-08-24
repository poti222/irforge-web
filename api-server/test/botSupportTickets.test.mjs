/**
 * test/botSupportTickets.test.mjs — IRFORGE_PROMPT_V3 Phase 23
 *
 * Covers routes/botSupportTickets.ts's admin-reply status/field logic
 * (nextTicketStatusAfterAdminReply / ticketPatchAfterAdminReply). Before this
 * fix, an admin reply from the website never updated last_message_at/
 * last_sender_role/message_count — the exact fields
 * plugins/ticket/domain.py::add_message maintains bot-side and
 * escalate_stale_tickets reads to decide "has anyone answered this ticket
 * recently". A ticket genuinely answered from the website would still get
 * wrongly escalated as "unanswered" hours later. It also reopened a closed
 * ticket on ANY admin reply, the opposite of the bot's own rule (only a
 * *user* reply reopens a closed ticket).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { __testables } = await import("../src/routes/botSupportTickets.ts");
const { nextTicketStatusAfterAdminReply, ticketPatchAfterAdminReply } = __testables;

test("پاسخِ ادمین: open یا reopened به assigned می‌رود", () => {
  assert.equal(nextTicketStatusAfterAdminReply("open"), "assigned");
  assert.equal(nextTicketStatusAfterAdminReply("reopened"), "assigned");
});

test("پاسخِ ادمین: تیکتِ closed باز نمی‌شود (برخلافِ رفتار قبلی)", () => {
  assert.equal(nextTicketStatusAfterAdminReply("closed"), "closed");
});

test("پاسخِ ادمین: assigned/escalated دست‌نخورده می‌مانند", () => {
  assert.equal(nextTicketStatusAfterAdminReply("assigned"), "assigned");
  assert.equal(nextTicketStatusAfterAdminReply("escalated"), "escalated");
});

test("patch شاملِ last_message_at/last_sender_role/message_count/escalation_notified_at است", () => {
  const ticket = { id: "t1", user_id: "u1", status: "open", message_count: 3 };
  const message = { id: "m1", ticket_id: "t1", sender_type: "admin", sender_id: "admin1", text: "hi", timestamp: "2026-08-23T10:00:00.000Z" };

  const patch = ticketPatchAfterAdminReply(ticket, message);

  assert.equal(patch.status, "assigned");
  assert.equal(patch.last_message_at, "2026-08-23T10:00:00.000Z");
  assert.equal(patch.last_sender_role, "admin");
  assert.equal(patch.message_count, 4, "شمارنده باید یکی زیاد شود، نه بازنویسی شود");
  assert.equal(patch.escalation_notified_at, "", "هشدارِ بی‌پاسخ‌مانده باید با پاسخِ تازه از نو محاسبه شود");
  assert.ok(patch.updated_at);
});

test("message_count نبود (تیکتِ قدیمی) از صفر شروع می‌شود، نه NaN", () => {
  const ticket = { id: "t2", user_id: "u1", status: "open" };
  const message = { id: "m2", ticket_id: "t2", sender_type: "admin", sender_id: "admin1", text: "hi", timestamp: "2026-08-23T10:00:00.000Z" };
  const patch = ticketPatchAfterAdminReply(ticket, message);
  assert.equal(patch.message_count, 1);
});
