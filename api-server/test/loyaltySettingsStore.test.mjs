/**
 * test/loyaltySettingsStore.test.mjs — IRFORGE_PROMPT_V3 Phase 24
 *
 * تا امروز اقتصادِ باشگاه مشتریان (چند تومان = یک امتیاز، جایزه‌ی ثبت‌نام،
 * ارزشِ تبدیل امتیاز، حداقلِ تبدیل) فقط از داخل بات قابل تنظیم بود
 * (plugins/loyalty/handlers.py::cb_settings). این تست ذخیره‌سازی و ادغامِ
 * lib/loyaltySettingsStore.ts را — که آینه‌ی دقیقِ
 * plugins/loyalty/domain.py::DEFAULT_SETTINGS/get_settings/save_settings
 * است — می‌سنجد.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/loyaltySettingsStore.ts");

const SID = "SHEET1";

function fakeSheet(initial = {}) {
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) tabs.set(tab, new Map(Object.entries(rows)));
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
      async deleteRow() { return false; },
      async listTabs() { return [...tabs.keys()]; },
    },
  };
}

function install(sheet) {
  Object.assign(botConfig.sheetLayer, sheet.layer);
}

test("بدون ردیف در شیت → پیش‌فرضِ دقیقاً برابر با DEFAULT_SETTINGS بات", async () => {
  install(fakeSheet({}));
  const settings = await store.getLoyaltySettings(SID);
  assert.deepEqual(settings, {
    currencyPerPoint: 10000, signupBonus: 0, redeemValue: 500, redeemMinPoints: 100,
  });
});

test("ردیفِ ذخیره‌شده (شکلِ snake_case بات) درست خوانده می‌شود", async () => {
  install(fakeSheet({
    loyalty_settings: {
      config: { id: "config", value: { currency_per_point: 5000, redeem_value: 250 } },
    },
  }));
  const settings = await store.getLoyaltySettings(SID);
  assert.equal(settings.currencyPerPoint, 5000);
  assert.equal(settings.redeemValue, 250);
  assert.equal(settings.signupBonus, 0, "فیلدِ نیامده باید از پیش‌فرض بیاید");
  assert.equal(settings.redeemMinPoints, 100);
});

test("setLoyaltySettings مقدار camelCase از سایت را می‌پذیرد و روی همان کلید ذخیره می‌کند", async () => {
  const sheet = fakeSheet({});
  install(sheet);

  const saved = await store.setLoyaltySettings(SID, { currencyPerPoint: 8000, signupBonus: 20 });
  assert.equal(saved.currencyPerPoint, 8000);
  assert.equal(saved.signupBonus, 20);
  assert.equal(saved.redeemValue, 500, "فیلدِ نیامده باید از پیش‌فرض بیاید، نه صفر شود");

  const row = sheet.tabs.get("loyalty_settings").get("config");
  assert.equal(row.value.currency_per_point, 8000, "روی شیت باید به شکلِ snake_case (شکلِ بات) ذخیره شود");
  assert.equal(row.value.signup_bonus, 20);
});

test("مقدارِ غیرعددی به پیش‌فرض سقوط می‌کند، نه NaN", async () => {
  install(fakeSheet({}));
  const saved = await store.setLoyaltySettings(SID, { currencyPerPoint: "چند تا؟" });
  assert.equal(saved.currencyPerPoint, 10000);
});

test("خطای شیت روی خواندن → پیش‌فرض، بدون throw", async () => {
  install({
    layer: {
      async readTabRows() { throw new Error("Google says no"); },
      async upsertRow() { return { created: true }; },
      async deleteRow() { return false; },
      async listTabs() { return []; },
    },
  });
  const settings = await store.getLoyaltySettings(SID);
  assert.equal(settings.currencyPerPoint, 10000);
});
