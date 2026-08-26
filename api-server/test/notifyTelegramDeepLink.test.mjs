/**
 * test/notifyTelegramDeepLink.test.mjs — IRFORGE_PROMPT_V3 Phase 16
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { deepLink } = await import("../src/lib/notifyTelegram.ts");

test("deepLink: bot_new_ticket goes to the bot's own tickets section", () => {
  const url = deepLink("https://irforge.ir", {
    type: "bot_new_ticket", severity: "warning", title: "t", message: "m", botId: "bot-1",
  });
  assert.equal(url, "https://irforge.ir/bots/bot-1?section=tickets");
});

test("deepLink: bot_ticket_escalated goes to the same tickets section", () => {
  const url = deepLink("https://irforge.ir", {
    type: "bot_ticket_escalated", severity: "warning", title: "t", message: "m", botId: "bot-1",
  });
  assert.equal(url, "https://irforge.ir/bots/bot-1?section=tickets");
});

test("deepLink: bot_new_ticket without a botId falls back to the bot list, not a broken link", () => {
  const url = deepLink("https://irforge.ir", {
    type: "bot_new_ticket", severity: "warning", title: "t", message: "m",
  });
  assert.equal(url, "https://irforge.ir/bots");
});

test("deepLink: the generic bot_ prefix branch still works for other bot_ types", () => {
  const url = deepLink("https://irforge.ir", {
    type: "bot_deployed", severity: "info", title: "t", message: "m", botId: "bot-1",
  });
  assert.equal(url, "https://irforge.ir/bots/bot-1");
});

test("deepLink: unrelated ticket_ types (the site's own ticket desk) are unaffected", () => {
  const url = deepLink("https://irforge.ir", {
    type: "ticket_reply", severity: "info", title: "t", message: "m", refId: "abc",
  });
  assert.equal(url, "https://irforge.ir/tickets/abc");
});
