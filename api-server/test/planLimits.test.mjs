/**
 * test/planLimits.test.mjs — IRFORGE_PROMPT_V3 Phase 33.
 *
 * `getUserPlanLimits` reads two tables in sequence (`user_plans` then
 * `plans`), so the fake `db.select` here must answer differently depending
 * on *which* table object it was called with — not just return one fixed
 * row like the single-table fakes elsewhere in this suite.
 *
 * Same trick as `platformSettings.test.mjs`: `@workspace/db` is a real
 * Drizzle instance, so `db.select`/`db.insert` are replaced with fakes for
 * the duration of each test instead of touching a real Postgres.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
// countUserBots() now decrypts each bot's token to dedupe by it -- tokenCrypto.ts
// reads this into a module-level const at its own import time (see
// tokenCryptoSelfCheck.test.mjs's header comment), so it must be set before
// planLimits.ts (which imports tokenCrypto.ts) is first imported below.
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);

const { db, plansTable, userPlansTable, botsTable } = await import("@workspace/db");
const mod = await import("../src/lib/planLimits.ts");
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");

/**
 * @param {{ userPlan?: object | null, plan?: object | null }} rows
 */
function installDb({ userPlan = null, plan = null } = {}) {
  db.select = () => ({
    from: (table) => ({
      where: () => ({
        limit: async () => {
          if (table === userPlansTable) return userPlan ? [userPlan] : [];
          if (table === plansTable) return plan ? [plan] : [];
          return [];
        },
      }),
    }),
  });
}

function userPlanRow(overrides = {}) {
  return {
    id: "up_1",
    userId: "user_1",
    planId: "gold",
    planName: "طلایی",
    status: "active",
    expiresAt: null,
    renewsAt: null,
    ...overrides,
  };
}

function planRow(overrides = {}) {
  return {
    id: "gold",
    name: "طلایی",
    price: 199,
    interval: "monthly",
    features: [],
    maxBots: 10,
    maxPlugins: 25,
    maxUsers: 1000,
    ramGb: 2,
    cpuCores: 2,
    popular: false,
    ...overrides,
  };
}

test("بدون ردیف در user_plans → پیش‌فرضِ رایگان", async () => {
  installDb({ userPlan: null });

  const limits = await mod.getUserPlanLimits("user_1");
  assert.deepEqual(limits, mod.FREE_PLAN_LIMITS);
});

test("اشتراکِ فعال بدون تاریخ انقضا → محدودیت‌های همان پلن", async () => {
  installDb({ userPlan: userPlanRow(), plan: planRow() });

  const limits = await mod.getUserPlanLimits("user_1");
  assert.deepEqual(limits, { planId: "gold", maxBots: 10, maxPlugins: 25 });
});

test("اشتراکِ فعال با انقضای آینده → محدودیت‌های همان پلن", async () => {
  const future = new Date(Date.now() + 86_400_000);
  installDb({ userPlan: userPlanRow({ expiresAt: future }), plan: planRow() });

  const limits = await mod.getUserPlanLimits("user_1");
  assert.equal(limits.maxBots, 10);
});

test("اشتراکِ منقضی‌شده → سقوط به پیش‌فرضِ رایگان", async () => {
  const past = new Date(Date.now() - 86_400_000);
  installDb({ userPlan: userPlanRow({ expiresAt: past }), plan: planRow() });

  const limits = await mod.getUserPlanLimits("user_1");
  assert.deepEqual(limits, mod.FREE_PLAN_LIMITS);
});

test("وضعیتِ غیرِ active (لغوشده/معوق) → سقوط به پیش‌فرضِ رایگان", async () => {
  installDb({ userPlan: userPlanRow({ status: "canceled" }), plan: planRow() });

  const limits = await mod.getUserPlanLimits("user_1");
  assert.deepEqual(limits, mod.FREE_PLAN_LIMITS);
});

test("ردیفِ user_plans به یک plan_id حذف‌شده اشاره می‌کند → پیش‌فرضِ رایگان با planId واقعی", async () => {
  installDb({ userPlan: userPlanRow({ planId: "deleted-plan" }), plan: null });

  const limits = await mod.getUserPlanLimits("user_1");
  assert.deepEqual(limits, { planId: "deleted-plan", maxBots: 1, maxPlugins: 5 });
});

test("خطای دیتابیس در حین select → throw می‌شود (این تابع خودش قورت نمی‌دهد)", async () => {
  db.select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          throw new Error("connection refused");
        },
      }),
    }),
  });

  await assert.rejects(() => mod.getUserPlanLimits("user_1"));
});

// ─── countUserBots — dedup by decrypted token ──────────────────────────────
// Bug report: creating one bot produced several Postgres rows for it (a
// check-then-insert race, fixed in routes/bots.ts::withTokenCreationLock),
// and this raw count(*) counted every one of them — a user whose token
// happened to duplicate could get wrongly blocked from creating a
// legitimate additional bot ("bot_limit_reached") despite really owning
// fewer bots than their plan allows.

function installBotsDb(tokens) {
  db.select = () => ({
    from: (table) => ({
      where: async () => {
        if (table !== botsTable) return [];
        return tokens.map((t) => ({ token: encryptToken(t) }));
      },
    }),
  });
}

test("سه ردیفِ هم‌توکن یک بات شمرده می‌شود، نه سه‌تا", async () => {
  installBotsDb(["123:aaa", "123:aaa", "123:aaa"]);
  assert.equal(await mod.countUserBots("user_1"), 1);
});

test("توکن‌های واقعاً متفاوت جدا شمرده می‌شوند", async () => {
  installBotsDb(["123:aaa", "456:bbb", "789:ccc"]);
  assert.equal(await mod.countUserBots("user_1"), 3);
});

test("بدون هیچ باتی → صفر", async () => {
  installBotsDb([]);
  assert.equal(await mod.countUserBots("user_1"), 0);
});

test("ردیفِ رمزگشایی‌نشدنی (خراب/دستکاری‌شده) به‌جای گم‌شدن، جداگانه شمرده می‌شود", async () => {
  db.select = () => ({
    from: (table) => ({
      where: async () => {
        if (table !== botsTable) return [];
        // یک IV نامعتبر (باید ۱۲ بایت باشد) — decryptToken واقعاً throw می‌کند،
        // برخلافِ رشته‌ی «۳ تکه نیست» که خودش به‌عنوانِ توکنِ قدیمیِ رمزنشده
        // پذیرفته می‌شود (decryptToken's legacy-row fallback).
        return [{ token: encryptToken("123:aaa") }, { token: "aabb:ccdd:eeff" }];
      },
    }),
  });
  assert.equal(await mod.countUserBots("user_1"), 2, "یک بات واقعی + یک ردیفِ خراب که نمی‌شود رمزگشایی کرد");
});
