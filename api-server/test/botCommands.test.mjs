/**
 * test/botCommands.test.mjs
 *
 * Two additions to routes/botCommands.ts covered here:
 *
 *  - Plugin-registered command targets (`lib/pluginCommandTargets.ts`,
 *    mirroring `lib/pluginPanelTypes.ts`/`lib/pluginButtonActions.ts`) —
 *    until now `GET /commands/targets` only ever returned four core
 *    built-ins (admin/broadcast/stats/backup), even though the bot itself
 *    (`handlers/custom_commands.py::_execute_target` via
 *    `extensions.dispatch_custom_command_target`) has supported seventeen
 *    plugin-registered targets all along.
 *
 *  - Command ordering (`order` field on `CustomCommand`, `effectiveOrder`,
 *    `sortCommands`, `POST /commands/:command/reorder`) — the route itself
 *    needs a live authenticated request + a real bot sheet (same reason the
 *    route handlers aren't unit-tested directly elsewhere in this repo).
 *    This file covers the pure decision functions: `effectiveOrder` (a
 *    command's sort key — its explicit `order`, or its `created_at` for
 *    commands created before this field existed) and `sortCommands`.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "e".repeat(64);

const { __testables } = await import("../src/routes/botCommands.ts");
const { effectiveOrder, sortCommands, validateCommandName } = __testables;
const { PLUGIN_COMMAND_TARGETS } = await import("../src/lib/pluginCommandTargets.ts");

function cmd(command, overrides = {}) {
  return {
    command,
    target: "admin",
    description: "",
    admin_only: false,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── PLUGIN_COMMAND_TARGETS ───────────────────────────────────────────────

test("PLUGIN_COMMAND_TARGETS: every entry has a non-empty pluginId, key, and label", () => {
  assert.ok(PLUGIN_COMMAND_TARGETS.length > 0);
  for (const t of PLUGIN_COMMAND_TARGETS) {
    assert.ok(t.pluginId, `missing pluginId on ${JSON.stringify(t)}`);
    assert.ok(t.key, `missing key on ${JSON.stringify(t)}`);
    assert.ok(t.label, `missing label on ${JSON.stringify(t)}`);
  }
});

test("PLUGIN_COMMAND_TARGETS: no duplicate keys (would silently shadow one another in the target picker)", () => {
  const keys = PLUGIN_COMMAND_TARGETS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, `duplicate keys in: ${keys.join(", ")}`);
});

test("PLUGIN_COMMAND_TARGETS: gameserver_cs2 is included (had a panel type + button action but no command target before this fix)", () => {
  const entry = PLUGIN_COMMAND_TARGETS.find((t) => t.pluginId === "gameserver_cs2");
  assert.ok(entry, "gameserver_cs2 must now register a custom command target");
  assert.equal(entry.key, "gameserver_cs2");
});

test("PLUGIN_COMMAND_TARGETS: keys are all valid per validateTarget's built-in shape (^[a-z][a-z0-9_]{0,31}$)", () => {
  for (const t of PLUGIN_COMMAND_TARGETS) {
    assert.ok(/^[a-z][a-z0-9_]{0,31}$/.test(t.key), `key "${t.key}" would be rejected by validateTarget`);
  }
});

// ─── effectiveOrder / sortCommands ────────────────────────────────────────

test("effectiveOrder: explicit numeric order wins", () => {
  assert.equal(effectiveOrder(cmd("a", { order: 42 })), 42);
});

test("effectiveOrder: falls back to created_at (parsed) when order is missing — legacy commands", () => {
  const c = cmd("a", { created_at: "2020-05-01T00:00:00.000Z" });
  assert.equal(effectiveOrder(c), Date.parse("2020-05-01T00:00:00.000Z"));
});

test("sortCommands: explicit order beats an unrelated created_at ordering", () => {
  const newer = cmd("newer", { created_at: "2026-01-01T00:00:00.000Z", order: 1 });
  const older = cmd("older", { created_at: "2020-01-01T00:00:00.000Z", order: 2 });
  const sorted = sortCommands([older, newer]);
  assert.deepEqual(sorted.map((c) => c.command), ["newer", "older"]);
});

test("sortCommands: legacy (order-less) commands fall back to creation order, oldest first", () => {
  const first = cmd("first", { created_at: "2020-01-01T00:00:00.000Z" });
  const second = cmd("second", { created_at: "2021-01-01T00:00:00.000Z" });
  const sorted = sortCommands([second, first]);
  assert.deepEqual(sorted.map((c) => c.command), ["first", "second"]);
});

test("sortCommands: a freshly created command (Date.now()-based order) always sorts after legacy ones", () => {
  const legacy = cmd("legacy", { created_at: "2020-01-01T00:00:00.000Z" });
  const fresh = cmd("fresh", { created_at: new Date().toISOString(), order: Date.now() });
  const sorted = sortCommands([fresh, legacy]);
  assert.deepEqual(sorted.map((c) => c.command), ["legacy", "fresh"]);
});

test("sortCommands: does not mutate its input array", () => {
  const list = [cmd("b", { order: 2 }), cmd("a", { order: 1 })];
  const original = [...list];
  sortCommands(list);
  assert.deepEqual(list, original);
});

// ─── validateCommandName (pre-existing, kept honest by __testables) ──────

test("validateCommandName: accepts lowercase/digits/underscore, strips a leading slash", () => {
  assert.equal(validateCommandName("/wallet_1"), "wallet_1");
});

test("validateCommandName: lowercases mixed-case input rather than rejecting it", () => {
  assert.equal(validateCommandName("Wallet"), "wallet");
});

test("validateCommandName: rejects spaces, symbols, and empty names", () => {
  assert.throws(() => validateCommandName("my command"));
  assert.throws(() => validateCommandName("wallet!"));
  assert.throws(() => validateCommandName(""));
});
