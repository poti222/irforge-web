/**
 * test/pluginOwners.test.mjs — IRFORGE_PROMPT_V3 Phase 38.
 *
 * `ownerUserIdsForPlugin()` decides who gets notified when a release note is
 * published (`routes/pluginReleaseNotes.ts`). The one thing worth a test is
 * the dedup: a user with the same plugin on three bots must get exactly one
 * user id back, not three — otherwise they'd get the same notification
 * three times.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db, installedPluginsTable, botsTable } = await import("@workspace/db");
const mod = await import("../src/lib/pluginOwners.ts");

function installDb({ installs = [], owners = [] } = {}) {
  db.select = () => ({
    from: (table) => ({
      where: async () => {
        if (table === installedPluginsTable) return installs;
        if (table === botsTable) return owners;
        return [];
      },
    }),
  });
}

test("پلاگینِ نصب‌نشده روی هیچ باتی → آرایه‌ی خالی، بدون کوئریِ بات", async () => {
  installDb({ installs: [] });
  const ids = await mod.ownerUserIdsForPlugin("booking");
  assert.deepEqual(ids, []);
});

test("یک بات، یک مالک", async () => {
  installDb({
    installs: [{ botId: "bot_1" }],
    owners: [{ userId: "user_1" }],
  });
  const ids = await mod.ownerUserIdsForPlugin("booking");
  assert.deepEqual(ids, ["user_1"]);
});

test("همان کاربر روی چند بات → فقط یک‌بار در نتیجه", async () => {
  installDb({
    installs: [{ botId: "bot_1" }, { botId: "bot_2" }, { botId: "bot_3" }],
    owners: [{ userId: "user_1" }, { userId: "user_1" }, { userId: "user_1" }],
  });
  const ids = await mod.ownerUserIdsForPlugin("booking");
  assert.deepEqual(ids, ["user_1"]);
});

test("چند کاربرِ متفاوت، هر کدام یک‌بار", async () => {
  installDb({
    installs: [{ botId: "bot_1" }, { botId: "bot_2" }],
    owners: [{ userId: "user_1" }, { userId: "user_2" }],
  });
  const ids = await mod.ownerUserIdsForPlugin("booking");
  assert.deepEqual(new Set(ids), new Set(["user_1", "user_2"]));
  assert.equal(ids.length, 2);
});
