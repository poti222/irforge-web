/**
 * test/botConfig.test.mjs — قرارداد لایه‌ی `botConfig` (فاز ۱).
 *
 * سه ادعایی که کل مهاجرتِ پنل ادمین روی آن‌ها ایستاده:
 *   ۱. `patchSettings` کلیدهای لمس‌نشده را حفظ می‌کند (باگ B11 — بات کل تب را
 *      clear می‌کند و `__plugin_states__` را می‌کشد؛ سایت حق ندارد این کار را بکند).
 *   ۲. `putEntity` مقدار را عیناً به لایه‌ی شیت می‌دهد تا JSON شود.
 *   ۳. شکست cache-bust باعث throw نمی‌شود.
 * به‌علاوه round-trip چیدمان دکمه‌ها (`row_start`) که فاز ۹ روی آن ساخته می‌شود.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 * (با tsx لود می‌شود تا مستقیم روی سورس TS اجرا شود، نه روی باندل.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// `@workspace/db` موقع import اگر DATABASE_URL نباشد throw می‌کند. یک مقدار
// ساختگی می‌گذاریم؛ pg.Pool تنبل است و تا وقتی کوئری نزنیم وصل نمی‌شود، و این
// تست هیچ‌وقت `resolveBotSheet` (تنها مصرف‌کننده‌ی db) را صدا نمی‌زند.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
// cache-bust باید در این تست خاموش باشد مگر جایی که خودمان روشنش کنیم.
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const botTypes = await import("../src/lib/botTypes.ts");

/** یک شیت جعلی در حافظه با همان قرارداد key/value تب‌های بات. */
function fakeSheet(initial = {}) {
  /** @type {Map<string, Map<string, unknown>>} */
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) {
    tabs.set(tab, new Map(Object.entries(rows)));
  }
  const calls = { upsert: [], delete: [], read: 0 };
  return {
    tabs,
    calls,
    layer: {
      async readTabRows(_sid, tab) {
        calls.read += 1;
        const rows = tabs.get(tab);
        if (!rows) return [];
        return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
      },
      async upsertRow(_sid, tab, key, value) {
        calls.upsert.push({ tab, key, value });
        if (!tabs.has(tab)) tabs.set(tab, new Map());
        const rows = tabs.get(tab);
        const created = !rows.has(key);
        // عیناً همان چیزی که tenantSheets روی سلول می‌گذارد: JSON.stringify
        rows.set(key, JSON.parse(JSON.stringify(value)));
        return { created };
      },
      async deleteRow(_sid, tab, key) {
        calls.delete.push({ tab, key });
        const rows = tabs.get(tab);
        if (!rows || !rows.has(key)) return false;
        rows.delete(key);
        return true;
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

test("patchSettings کلیدهای لمس‌نشده را حفظ می‌کند (باگ B11)", async () => {
  const sheet = fakeSheet({
    bot_settings: {
      welcome_msg: "قدیمی",
      __plugin_states__: { wallet: true, referral: false },
      payment_cfg: { card: "6037-****" },
      maintenance: false,
    },
  });
  install(sheet);

  await botConfig.patchSettings("SHEET1", { welcome_msg: "جدید", maintenance: true });

  const rows = sheet.tabs.get("bot_settings");
  assert.equal(rows.get("welcome_msg"), "جدید", "کلید هدف باید عوض شود");
  assert.equal(rows.get("maintenance"), true);
  assert.deepEqual(
    rows.get("__plugin_states__"),
    { wallet: true, referral: false },
    "__plugin_states__ نباید لمس شود — این دقیقاً باگ B11 است"
  );
  assert.deepEqual(rows.get("payment_cfg"), { card: "6037-****" }, "کلید ناشناخته باید سالم بماند");
  assert.ok(rows.has("updated_at"), "updated_at باید ست شود (مثل _save_settings بات)");

  // هیچ‌وقت نباید چیزی شبیه «بازنویسی کل تب» رخ دهد: فقط upsert تک‌کلیدی.
  const touched = sheet.calls.upsert.map((c) => c.key);
  assert.deepEqual(touched, ["welcome_msg", "maintenance", "updated_at"]);
  assert.equal(sheet.calls.delete.length, 0, "patchSettings هرگز نباید سطری حذف کند");
});

test("واترمارک و حالت تعمیر روی هم اثر نمی‌گذارند", async () => {
  // گزارش کاربر: «روشن‌کردن یکی، دیگری را خراب می‌کند». سمت سرور چنین چیزی
  // ممکن نیست — نوشتن کلیدبه‌کلید است — و این تست همان را قفل می‌کند تا اگر
  // روزی کسی `patchSettings` را به بازنویسی کل تب برگرداند، همین‌جا بیفتد.
  // ریشه‌ی واقعی سمت کلاینت بود (`useDraft`، هویت ناپایدارِ منبع).
  const sheet = fakeSheet({
    bot_settings: {
      watermark: "پاورقی من",
      watermark_enabled: true,
      maintenance: false,
      maintenance_msg: "بعداً بیا",
    },
  });
  install(sheet);

  // فقط حالت تعمیر را روشن کن.
  await botConfig.patchSettings("SHEET1", { maintenance: true });

  const rows = sheet.tabs.get("bot_settings");
  assert.equal(rows.get("maintenance"), true);
  assert.equal(rows.get("watermark_enabled"), true, "واترمارک نباید خاموش شود");
  assert.equal(rows.get("watermark"), "پاورقی من", "متن واترمارک نباید پاک شود");

  // حالا فقط واترمارک را خاموش کن.
  await botConfig.patchSettings("SHEET1", { watermark_enabled: false });
  assert.equal(rows.get("watermark_enabled"), false);
  assert.equal(rows.get("maintenance"), true, "حالت تعمیر نباید برگردد");
  assert.equal(rows.get("maintenance_msg"), "بعداً بیا");
});

test("readSettings پیش‌فرض‌های models.py را پر می‌کند و شکل کامل می‌دهد", async () => {
  const sheet = fakeSheet({ bot_settings: { welcome_msg: "سلام" } });
  install(sheet);

  const settings = await botConfig.readSettings("SHEET1");
  assert.equal(settings.welcome_msg, "سلام");
  assert.equal(settings.currency, "تومان", "کلید غایب باید با پیش‌فرض پر شود");
  assert.equal(settings.working_hours.open_time, "09:00");
  assert.deepEqual(settings.working_hours.days, [0, 1, 2, 3, 4], "0=دوشنبه … 6=یکشنبه");
  assert.equal(settings.anti_flood.max_messages, 5);
  assert.deepEqual(settings.force_join_channels, []);
  assert.equal(settings.home_panel_id, null);
});

test("readSettings مقدار ناقص working_hours را با پیش‌فرض merge می‌کند", async () => {
  const sheet = fakeSheet({ bot_settings: { working_hours: { enabled: true, days: [5, 6] } } });
  install(sheet);

  const settings = await botConfig.readSettings("SHEET1");
  assert.equal(settings.working_hours.enabled, true);
  assert.deepEqual(settings.working_hours.days, [5, 6]);
  assert.equal(settings.working_hours.close_time, "21:00", "کلید غایب از پیش‌فرض می‌آید");
});

test("putEntity مقدار را عیناً به لایه‌ی شیت می‌دهد و getEntity همان را برمی‌گرداند", async () => {
  const sheet = fakeSheet({});
  install(sheet);

  const panel = botTypes.newPanel({ title: "خانه", type: "text", content: "سلام" });
  const { created } = await botConfig.putEntity("SHEET1", "panels", panel.id, panel);
  assert.equal(created, true);

  const stored = sheet.tabs.get("panels").get(panel.id);
  assert.deepEqual(stored, JSON.parse(JSON.stringify(panel)), "مقدار باید JSON-serializable و بدون تغییر باشد");

  const back = await botConfig.getEntity("SHEET1", "panels", panel.id);
  assert.equal(back.title, "خانه");
  assert.equal(back.is_active, true);
  assert.equal(back.parent_id, null);

  const again = await botConfig.putEntity("SHEET1", "panels", panel.id, { ...panel, title: "خانه ۲" });
  assert.equal(again.created, false, "بار دوم باید آپدیت باشد نه ساخت");

  assert.equal(await botConfig.removeEntity("SHEET1", "panels", panel.id), true);
  assert.equal(await botConfig.removeEntity("SHEET1", "panels", panel.id), false, "حذف دوباره = false");
});

test("شکست cache-bust باعث throw نمی‌شود", async () => {
  const sheet = fakeSheet({ bot_settings: { welcome_msg: "x" } });
  install(sheet);

  // یک دیتابیس که قطعاً وجود ندارد: پورت ۱ روی لوکال‌هاست.
  process.env.BOT_CACHE_DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nope";
  const cacheBust = await import("../src/lib/botCacheBust.ts");
  assert.equal(cacheBust.cacheBustEnabled(), true);
  assert.equal(
    cacheBust.cacheKey("SHEET1", "bot_settings"),
    "SHEET1:bot_settings",
    "کلید کش باید دقیقاً `${spreadsheetId}:${tab}` باشد (sheets_manager.py:126)"
  );

  // نوشتن باید موفق شود حتی وقتی cache-bust شکست می‌خورد.
  const result = await botConfig.patchSettings("SHEET1", { welcome_msg: "y" });
  assert.equal(result.welcome_msg, "y", "نوشتن روی شیت نباید قربانی شکست cache-bust شود");
  assert.equal(await cacheBust.bustTabCache("SHEET1", "bot_settings"), false, "شکست باید false بدهد، نه throw");

  await cacheBust.closeCacheBustPool();
  delete process.env.BOT_CACHE_DATABASE_URL;
});

test("assertSheetsAuthoritative بدون BUSINESS_DATABASE_URL باز است (fail-open)", async () => {
  botConfig.resetCutoverCacheForTests();
  delete process.env.BUSINESS_DATABASE_URL;
  await botConfig.assertSheetsAuthoritative("panels"); // نباید throw کند
  assert.equal(await botConfig.isEntityOnPostgres("panels"), false);
});

test("round-trip چیدمان دکمه‌ها: rows → buttons → rows بدون تغییر", async () => {
  const { newButton, buttonsToRows, rowsToButtons, normalizeButtonLayout } = botTypes;

  const rows = [
    [newButton({ label: "الف" }), newButton({ label: "ب" })],
    [newButton({ label: "ج" })],
    [newButton({ label: "د" }), newButton({ label: "ه" }), newButton({ label: "و" })],
  ];

  const flat = rowsToButtons(rows);
  assert.deepEqual(
    flat.map((b) => [b.label, b.row, b.col, b.row_start]),
    [
      ["الف", 0, 0, true],
      ["ب", 0, 1, false],
      ["ج", 1, 0, true],
      ["د", 2, 0, true],
      ["ه", 2, 1, false],
      ["و", 2, 2, false],
    ],
    "row/col باید از row_start بازسازی شوند (معادل _apply_row_starts)"
  );

  const backToRows = buttonsToRows(flat);
  assert.deepEqual(
    backToRows.map((r) => r.map((b) => b.label)),
    rows.map((r) => r.map((b) => b.label)),
    "round-trip باید بدون تغییر باشد"
  );

  // ورودی قدیمیِ بات (بدون row_start، فقط row) باید درست migrate شود —
  // معادل _migrate_row_starts.
  const legacy = [
    { label: "۱", action: "panel", value: "", row: 0, col: 0 },
    { label: "۲", action: "panel", value: "", row: 0, col: 1 },
    { label: "۳", action: "panel", value: "", row: 1, col: 0 },
  ];
  const migrated = normalizeButtonLayout(legacy);
  assert.deepEqual(
    migrated.map((b) => [b.row, b.col, b.row_start]),
    [
      [0, 0, true],
      [0, 1, false],
      [1, 0, true],
    ],
    "دکمه‌های قدیمی بدون row_start باید از روی row گروه‌بندی شوند"
  );
  assert.deepEqual(
    buttonsToRows(migrated).map((r) => r.map((b) => b.label)),
    [["۱", "۲"], ["۳"]]
  );
});

test("normalizeButtonLayout هیچ فیلد اضافه‌ای را دور نمی‌ریزد", async () => {
  const withStyle = botTypes.normalizeButtonLayout([
    { label: "خرید", action: "sell", value: "p1", row: 0, col: 0, row_start: true, style: "success" },
  ]);
  assert.equal(withStyle[0].style, "success", "style باید حفظ شود (در models.Button نیست ولی روی دیسک هست)");
});

test("نبودِ کردنشیال گوگل، ۵۰۳ با پیام روشن می‌دهد نه ۵۰۰ مبهم", async () => {
  const sheets = await import("../src/lib/sheets.ts");

  // این دقیقاً همان `Error` ای است که `getAuth()` می‌سازد.
  const real = new Error(
    "Google Sheets not configured. Set GOOGLE_CREDENTIALS_JSON (preferred), or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY (legacy)."
  );
  assert.equal(sheets.isSheetsNotConfiguredError(real), true);
  assert.equal(sheets.isSheetsNotConfiguredError(new Error("GOOGLE_CREDENTIALS_JSON is missing client_email or private_key.")), true);

  // و نباید هر خطای دیگری را بی‌جهت به «تنظیم نشده» ترجمه کند.
  assert.equal(sheets.isSheetsNotConfiguredError(new Error("Unable to parse range: 'forms'!A:B")), false);
  assert.equal(sheets.isSheetsNotConfiguredError(new Error("boom")), false);
  assert.equal(sheets.isSheetsNotConfiguredError(null), false);

  // خروجی واقعی روی یک res جعلی — این چیزی است که کاربر می‌بیند.
  const seen = {};
  const res = {
    status(code) { seen.code = code; return this; },
    json(body) { seen.body = body; return this; },
  };
  botConfig.sendBotConfigError(res, real, "Failed to read bot settings");
  assert.equal(seen.code, 503, "۵۰۳ چون سرویس در دسترس نیست، نه اینکه درخواست بد بوده");
  assert.equal(seen.body.code, "sheets_not_configured");
  assert.match(seen.body.error, /GOOGLE_CREDENTIALS_JSON/);
});
