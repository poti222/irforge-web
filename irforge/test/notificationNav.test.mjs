import { test } from "node:test";
import assert from "node:assert/strict";
import { navDotSeverities, navKeyForNotification, navKeyForPath } from "../src/lib/notification-nav.ts";

const n = (type, severity = "info", read = false) => ({ id: type, botId: null, type, severity, title: "", message: "", read, refId: null, createdAt: "" });

test("each notification type maps to exactly one sidebar item", () => {
  assert.equal(navKeyForNotification("ticket_reply"), "tickets");
  assert.equal(navKeyForNotification("purchase_success"), "bots");
  assert.equal(navKeyForNotification("trial_warning"), "bots");
  assert.equal(navKeyForNotification("wallet_topup_confirmed"), "billing");
  assert.equal(navKeyForNotification("site_update"), "updates");
  assert.equal(navKeyForNotification("role_changed"), null);
});

test("unread only, highest severity per item", () => {
  const d = navDotSeverities([n("ticket_reply"), n("ticket_new", "warning"), n("site_update", "info", true), n("role_changed")]);
  assert.deepEqual(d, { tickets: "warning" });
});

test("path → key", () => {
  assert.equal(navKeyForPath("/tickets"), "tickets");
  assert.equal(navKeyForPath("/bots/abc"), "bots");
  assert.equal(navKeyForPath("/invoices"), "billing");
  assert.equal(navKeyForPath("/support"), null);
});
