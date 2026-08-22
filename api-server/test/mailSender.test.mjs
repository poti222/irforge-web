/**
 * test/mailSender.test.mjs — IRFORGE_PROMPT_V3 Phase 12
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const mail = await import("../src/lib/mailSender.ts");

test("mailConfigIssue: flags a missing SMTP_HOST", () => {
  assert.ok(mail.mailConfigIssue({}));
});

test("mailConfigIssue: fine once SMTP_HOST is set", () => {
  assert.equal(mail.mailConfigIssue({ SMTP_HOST: "smtp.example.com" }), null);
});

test("sendEmail: reports not_configured and never calls the transport when unset", async () => {
  const getTransport = () => null;
  const result = await mail.sendEmail({ to: "a@example.com", subject: "s", html: "<p>hi</p>" }, getTransport);
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_configured");
});

test("sendEmail: calls sendMail with the right envelope on a configured transport", async () => {
  const sent = [];
  const fakeTransport = { sendMail: async (opts) => { sent.push(opts); } };
  const result = await mail.sendEmail(
    { to: "a@example.com", subject: "Verify your email", html: "<p>123456</p>", text: "123456" },
    () => fakeTransport,
  );
  assert.equal(result.ok, true);
  assert.equal(result.provider, "smtp");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "a@example.com");
  assert.equal(sent[0].subject, "Verify your email");
  assert.equal(sent[0].html, "<p>123456</p>");
});

test("sendEmail: a thrown send error is caught, never propagated", async () => {
  const fakeTransport = { sendMail: async () => { throw new Error("SMTP connection refused"); } };
  const result = await mail.sendEmail(
    { to: "a@example.com", subject: "s", html: "h" },
    () => fakeTransport,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "send_failed");
});
