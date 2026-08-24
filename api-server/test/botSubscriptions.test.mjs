/**
 * test/botSubscriptions.test.mjs — IRFORGE_PROMPT_V3 Phase 22
 *
 * lib/botSubscriptions.ts is a read-only mirror of bot/utils/subscriptions.py's
 * effective_plan_id()/plan_has_feature() — same tabs (`tenant_subscriptions`,
 * `plan_features`), same fallback-to-DEFAULT_PLANS behavior when a row hasn't
 * been seeded yet, same grace-period window. This test proves the mirror
 * matches, using the exact fake-sheet harness botConfig.test.mjs established
 * (`botConfig.sheetLayer` is the same shared object `getEntity` reads through,
 * so no separate mock is needed for lib/botSubscriptions.ts).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const subs = await import("../src/lib/botSubscriptions.ts");

const SHEET = "SHEET1";

function fakeSheet(initial = {}) {
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) {
    tabs.set(tab, new Map(Object.entries(rows)));
  }
  return {
    tabs,
    layer: {
      async readTabRows(_sid, tab) {
        const rows = tabs.get(tab);
        if (!rows) return [];
        return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
      },
      async upsertRow(_sid, tab, key, value) {
        if (!tabs.has(tab)) tabs.set(tab, new Map());
        tabs.get(tab).set(key, JSON.parse(JSON.stringify(value)));
        return { created: true };
      },
      async deleteRow() {
        return false;
      },
      async listTabs() {
        return [...tabs.keys()];
      },
    },
  };
}

function install(sheet) {
  Object.assign(botConfig.sheetLayer, sheet.layer);
}

// ─── effectivePlanId ────────────────────────────────────────────────────────

test("بدون ردیفِ tenant_subscriptions → پلن رایگان (bronze)", async () => {
  install(fakeSheet({}));
  assert.equal(await subs.effectivePlanId(SHEET), "bronze");
});

test("اشتراکِ فعال → همان plan_id", async () => {
  install(fakeSheet({
    tenant_subscriptions: { [SHEET]: { tenant_id: SHEET, plan_id: "gold", status: "active" } },
  }));
  assert.equal(await subs.effectivePlanId(SHEET), "gold");
});

test("اشتراکِ لغوشده ولی داخل بازه‌ی grace → پلن قبلی هنوز اعمال می‌شود", async () => {
  const stillInGrace = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // ۱ روز پیش
  install(fakeSheet({
    tenant_subscriptions: {
      [SHEET]: { tenant_id: SHEET, plan_id: "diamond", status: "canceled", current_period_end: stillInGrace },
    },
  }));
  assert.equal(await subs.effectivePlanId(SHEET), "diamond");
});

test("اشتراکِ لغوشده و grace تمام‌شده → سقوط به bronze", async () => {
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  install(fakeSheet({
    tenant_subscriptions: {
      [SHEET]: { tenant_id: SHEET, plan_id: "diamond", status: "canceled", current_period_end: longAgo },
    },
  }));
  assert.equal(await subs.effectivePlanId(SHEET), "bronze");
});

// ─── planHasFeature("multi_language") ──────────────────────────────────────

test("بدون ردیفِ plan_features → پیش‌فرضِ کدی: bronze ندارد", async () => {
  install(fakeSheet({}));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "bronze"), false);
});

test("بدون ردیفِ plan_features → پیش‌فرضِ کدی: silver/gold دارند", async () => {
  install(fakeSheet({}));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "silver"), true);
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "gold"), true);
});

test("diamond همیشه true است (پیش‌فرضِ wildcard)", async () => {
  install(fakeSheet({}));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "diamond"), true);
});

test("ردیفِ صریحِ plan_features روی پیش‌فرضِ کدی غالب است", async () => {
  install(fakeSheet({
    plan_features: {
      "silver:multi_language": { plan_id: "silver", feature_key: "multi_language", enabled: false },
    },
  }));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "silver"), false);
});

test("ردیفِ wildcard صریح (plan:*) هر feature را باز می‌کند", async () => {
  install(fakeSheet({
    plan_features: { "bronze:*": { plan_id: "bronze", feature_key: "*", enabled: true } },
  }));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "bronze"), true);
});

test("پلنِ ناشناخته بدون هیچ ردیفی → false", async () => {
  install(fakeSheet({}));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language", "unknown_plan"), false);
});

test("بدون planId صریح، effectivePlanId تننت به‌کار می‌رود", async () => {
  install(fakeSheet({
    tenant_subscriptions: { [SHEET]: { tenant_id: SHEET, plan_id: "gold", status: "active" } },
  }));
  assert.equal(await subs.planHasFeature(SHEET, "multi_language"), true);
});

// ─── getSubscriptionSummary (Phase 32 — dashboard plan card) ───────────────

test("بدون ردیفِ tenant_subscriptions → خلاصه‌ی پلنِ رایگان با پیش‌فرضِ کدی", async () => {
  install(fakeSheet({}));
  const summary = await subs.getSubscriptionSummary(SHEET);
  assert.equal(summary.planId, "bronze");
  assert.equal(summary.planName, "برنزی");
  assert.equal(summary.priceMonthly, 0);
  assert.equal(summary.status, "active");
  assert.equal(summary.currentPeriodEnd, null);
  assert.equal(summary.inGrace, false);
  assert.equal(summary.daysRemaining, null);
});

test("اشتراکِ فعال با تاریخِ پایانِ آینده → daysRemaining مثبت", async () => {
  const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  install(fakeSheet({
    tenant_subscriptions: {
      [SHEET]: { tenant_id: SHEET, plan_id: "gold", status: "active", current_period_end: in10Days },
    },
  }));
  const summary = await subs.getSubscriptionSummary(SHEET);
  assert.equal(summary.planId, "gold");
  assert.equal(summary.planName, "طلایی");
  assert.equal(summary.priceMonthly, 199);
  assert.equal(summary.status, "active");
  assert.equal(summary.inGrace, false);
  assert.ok(summary.daysRemaining >= 9 && summary.daysRemaining <= 10);
});

test("اشتراکِ لغوشده ولی داخل بازه‌ی grace → inGrace true", async () => {
  const stillInGrace = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  install(fakeSheet({
    tenant_subscriptions: {
      [SHEET]: { tenant_id: SHEET, plan_id: "diamond", status: "canceled", current_period_end: stillInGrace },
    },
  }));
  const summary = await subs.getSubscriptionSummary(SHEET);
  assert.equal(summary.status, "canceled");
  assert.equal(summary.inGrace, true);
  assert.equal(summary.planId, "diamond"); // خلاصه پلنِ ثبت‌شده را نشان می‌دهد، نه effective plan
});

test("سطرِ صریحِ subscription_plans روی پیش‌فرضِ کدی غالب است", async () => {
  install(fakeSheet({
    tenant_subscriptions: { [SHEET]: { tenant_id: SHEET, plan_id: "gold", status: "active" } },
    subscription_plans: { gold: { plan_id: "gold", name: "Custom Gold", price_monthly: 250 } },
  }));
  const summary = await subs.getSubscriptionSummary(SHEET);
  assert.equal(summary.planName, "Custom Gold");
  assert.equal(summary.priceMonthly, 250);
});

test("پلنِ ناشناخته بدون هیچ ردیفی → نامِ خودِ plan_id به‌عنوانِ fallback", async () => {
  install(fakeSheet({
    tenant_subscriptions: { [SHEET]: { tenant_id: SHEET, plan_id: "custom_plan", status: "active" } },
  }));
  const summary = await subs.getSubscriptionSummary(SHEET);
  assert.equal(summary.planName, "custom_plan");
  assert.equal(summary.priceMonthly, 0);
});

test("current_period_end نامعتبر → daysRemaining به‌جای NaN، null است", async () => {
  install(fakeSheet({
    tenant_subscriptions: {
      [SHEET]: { tenant_id: SHEET, plan_id: "gold", status: "active", current_period_end: "not-a-date" },
    },
  }));
  const summary = await subs.getSubscriptionSummary(SHEET);
  assert.equal(summary.daysRemaining, null);
});
