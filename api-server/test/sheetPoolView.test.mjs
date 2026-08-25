/**
 * test/sheetPoolView.test.mjs — IRFORGE_PROMPT_V3 Phase 43.
 *
 * `buildSheetPoolView` is pure (no db) — every case below is a plain
 * input → output check.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheetPoolView } from "../src/lib/sheetPoolView.ts";

function entry(overrides = {}) {
  return {
    id: "sheet1",
    sheetId: "1AbCsheetId",
    status: "available",
    assignedBotId: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("an unassigned sheet has no bot/owner fields at all", () => {
  const out = buildSheetPoolView([entry()], [], []);
  assert.equal(out[0].assignedBotName, null);
  assert.equal(out[0].assignedBotOwnerId, null);
  assert.equal(out[0].assignedBotOwnerName, null);
  assert.equal(out[0].assignedBotOwnerUsername, null);
});

test("an assigned sheet resolves the bot name and the owner's telegram username", () => {
  const out = buildSheetPoolView(
    [entry({ id: "sheet1", status: "assigned", assignedBotId: "bot1" })],
    [{ id: "bot1", name: "My Shop Bot", userId: "user1" }],
    [{ id: "user1", name: "Ali Rezaei", telegramUsername: "ali_r" }],
  );
  assert.equal(out[0].assignedBotName, "My Shop Bot");
  assert.equal(out[0].assignedBotOwnerId, "user1");
  assert.equal(out[0].assignedBotOwnerName, "Ali Rezaei");
  assert.equal(out[0].assignedBotOwnerUsername, "ali_r", "never the raw user id — that was the P43 bug");
});

test("an owner who never linked Telegram still resolves a display name, not null-and-a-UUID", () => {
  const out = buildSheetPoolView(
    [entry({ status: "assigned", assignedBotId: "bot1" })],
    [{ id: "bot1", name: "Bot", userId: "user1" }],
    [{ id: "user1", name: "Sara", telegramUsername: null }],
  );
  assert.equal(out[0].assignedBotOwnerUsername, null);
  assert.equal(out[0].assignedBotOwnerName, "Sara");
});

test("a bot row that wasn't fetched (stale assignedBotId) degrades to nulls, never throws", () => {
  const out = buildSheetPoolView(
    [entry({ status: "assigned", assignedBotId: "deleted-bot" })],
    [],
    [],
  );
  assert.equal(out[0].assignedBotName, null);
  assert.equal(out[0].assignedBotOwnerId, null);
});

test("an owner row that wasn't fetched (stale userId) degrades to nulls, never throws", () => {
  const out = buildSheetPoolView(
    [entry({ status: "assigned", assignedBotId: "bot1" })],
    [{ id: "bot1", name: "Bot", userId: "missing-user" }],
    [],
  );
  assert.equal(out[0].assignedBotOwnerId, "missing-user", "the id itself is still reported");
  assert.equal(out[0].assignedBotOwnerName, null);
  assert.equal(out[0].assignedBotOwnerUsername, null);
});

test("preserves every entry's own fields (id, sheetId, status, createdAt) unchanged", () => {
  const out = buildSheetPoolView(
    [entry({ id: "s1", sheetId: "raw-id", status: "available", createdAt: new Date("2026-01-02T03:04:05.000Z") })],
    [],
    [],
  );
  assert.equal(out[0].id, "s1");
  assert.equal(out[0].sheetId, "raw-id");
  assert.equal(out[0].status, "available");
  assert.equal(out[0].createdAt, "2026-01-02T03:04:05.000Z");
});

test("multiple entries resolve independently, including two sheets assigned to bots owned by the same person", () => {
  const out = buildSheetPoolView(
    [
      entry({ id: "s1", status: "assigned", assignedBotId: "bot1" }),
      entry({ id: "s2", status: "assigned", assignedBotId: "bot2" }),
      entry({ id: "s3", status: "available" }),
    ],
    [
      { id: "bot1", name: "Shop Bot", userId: "user1" },
      { id: "bot2", name: "Support Bot", userId: "user1" },
    ],
    [{ id: "user1", name: "Ali", telegramUsername: "ali_r" }],
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].assignedBotOwnerUsername, "ali_r");
  assert.equal(out[1].assignedBotOwnerUsername, "ali_r");
  assert.equal(out[2].assignedBotOwnerUsername, null);
});
