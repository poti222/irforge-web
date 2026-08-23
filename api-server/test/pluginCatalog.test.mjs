/**
 * test/pluginCatalog.test.mjs — کاتالوگ پلاگین‌ها و لایه‌ی CRUD داده‌شان.
 *
 * چیزهایی که این تست نگه می‌دارد:
 *   ۱. کاتالوگ از تب `plugin_catalog` رجیستری خوانده می‌شود — یعنی یک پلاگین
 *      تازه در بات، بدون تغییر یک خط کد سایت دیده می‌شود. این کل نکته‌ی
 *      حذفِ لیست دستی `PLUGIN_CATALOG` بود.
 *   ۲. اگر آن تب در دسترس نباشد (رجیستری تنظیم نشده، بات هنوز بالا نیامده،
 *      خطای گوگل)، فهرست پایه برمی‌گردد و `published:false` — نه یک فهرست
 *      خالی که به کاربر دروغ بگوید «پلاگینی وجود ندارد».
 *   ۳. سلولِ خرابِ روی شیت کل فهرست را از کار نمی‌اندازد.
 *   ۴. ولیدیشن مجموعه‌های پلاگین: فیلد اجباری، بازه‌ی عددی، گزینه‌ی نامعتبر.
 *   ۵. شناسه‌ها همان قالب بات را دارند (`<prefix>_<hex12>`) — وگرنه رکوردی که
 *      سایت می‌سازد با رکوردهای خود بات ناهمگون می‌شد.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// `@workspace/db` موقع import بدون DATABASE_URL throw می‌کند. pg.Pool تنبل است
// و این تست هیچ کوئری‌ای نمی‌زند.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const catalogMod = await import("../src/lib/pluginCatalog.ts");
const collectionsMod = await import("../src/lib/pluginCollections.ts");

/** یک مانیفستِ کاملِ نمونه، به همان شکلی که publisher پایتون می‌نویسد. */
const BOOKING_ROW = {
  id: "booking",
  name: "Booking",
  name_fa: "رزرو نوبت",
  description: "رزرو نوبت با سرویس و بازه‌ی زمانی.",
  version: "1.0.0",
  author: "IrForge",
  required_sheets: ["booking_services", "booking_slots", "booking_reservations"],
  permissions: ["booking.view", "booking.manage"],
  default_enabled: false,
  web_section: "booking",
};

/** لایه‌ی شیت جعلی برای تب `plugin_catalog`. */
function fakeCatalogSheet(rows, { throws = false } = {}) {
  return {
    async readTabRows(_sid, tab) {
      if (throws) throw new Error("Google says no");
      assert.equal(tab, catalogMod.CATALOG_TAB);
      return rows.map(([key, value]) => ({ key, value, raw: false }));
    },
  };
}

function useSheet(rows, opts) {
  catalogMod.resetPluginCatalogCacheForTests();
  Object.assign(catalogMod.catalogSheetLayer, fakeCatalogSheet(rows, opts));
}

test("کاتالوگ منتشرشده‌ی بات خوانده می‌شود، نه یک لیست دستی", async () => {
  process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";
  useSheet([
    ["booking", BOOKING_ROW],
    ["__meta__", { published_at: "2026-08-17T00:00:00Z", count: 1, plugin_ids: ["booking"] }],
  ]);

  const { plugins, published } = await catalogMod.getPluginCatalog();

  assert.equal(published, true);
  assert.equal(plugins.length, 1, "ردیف __meta__ نباید به‌عنوان پلاگین شمرده شود");
  assert.equal(plugins[0].id, "booking");
  assert.equal(plugins[0].name_fa, "رزرو نوبت");
  assert.equal(plugins[0].web_section, "booking");
  assert.deepEqual(plugins[0].permissions, ["booking.view", "booking.manage"]);
});

test("پلاگینی که فقط در بات هست، بدون تغییر کد سایت دیده می‌شود", async () => {
  process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";
  // یک پلاگین فرضی که هیچ‌جای سورس سایت اسمش نیامده.
  useSheet([
    ["quantum", { id: "quantum", name: "Quantum", name_fa: "کوانتوم", default_enabled: true }],
  ]);

  const manifest = await catalogMod.getPluginManifest("quantum");
  assert.ok(manifest, "پلاگین ناشناخته برای سایت هم باید از کاتالوگ بیاید");
  assert.equal(manifest.name_fa, "کوانتوم");

  const defaults = await catalogMod.defaultEnabledMap();
  assert.equal(defaults.quantum, true, "default_enabled باید از مانیفست بیاید، نه false ثابت");
  assert.equal(await catalogMod.pluginLabel("quantum"), "کوانتوم");
});

test("تب خالی → فهرست پایه با published:false، نه فهرست خالی", async () => {
  process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";
  useSheet([]);

  const { plugins, published } = await catalogMod.getPluginCatalog();
  assert.equal(published, false);
  assert.ok(plugins.length > 0, "«هنوز نمی‌دانیم» نباید به‌شکل «هیچ پلاگینی نیست» دیده شود");
  assert.ok(plugins.some((p) => p.id === "wallet"));
});

test("خطای شیت → فهرست پایه، بدون throw", async () => {
  process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";
  useSheet([], { throws: true });

  const { plugins, published } = await catalogMod.getPluginCatalog();
  assert.equal(published, false);
  assert.ok(plugins.length > 0);
});

test("رجیستری تنظیم‌نشده → فهرست پایه، بدون تلاش برای خواندن", async () => {
  delete process.env.REGISTRY_SPREADSHEET_ID;
  delete process.env.SHEETS_REGISTRY_ID;
  catalogMod.resetPluginCatalogCacheForTests();
  Object.assign(catalogMod.catalogSheetLayer, {
    async readTabRows() {
      throw new Error("نباید صدا زده شود");
    },
  });

  const { plugins, published } = await catalogMod.getPluginCatalog();
  assert.equal(published, false);
  assert.ok(plugins.length > 0);
});

test("سلول خراب روی شیت، کل فهرست را از کار نمی‌اندازد", async () => {
  process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";
  useSheet([
    ["broken", "این یک رشته است نه آبجکت"],
    ["alsobroken", null],
    ["booking", BOOKING_ROW],
  ]);

  const { plugins, published } = await catalogMod.getPluginCatalog();
  assert.equal(published, true);
  assert.deepEqual(plugins.map((p) => p.id), ["booking"]);
});

test("مانیفست ناقص، پیش‌فرض بی‌خطر می‌گیرد", async () => {
  process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";
  useSheet([["bare", { id: "bare" }]]);

  const [plugin] = (await catalogMod.getPluginCatalog()).plugins;
  assert.equal(plugin.id, "bare");
  assert.equal(plugin.name, "bare", "نامِ نبوده باید به id سقوط کند");
  assert.deepEqual(plugin.required_sheets, []);
  assert.deepEqual(plugin.permissions, []);
  assert.equal(plugin.default_enabled, false);
});

// ─── مجموعه‌های داده‌ی پلاگین ────────────────────────────────────────────────

test("هر مجموعه به یک پلاگین شناخته‌شده و یک تب یکتا وصل است", () => {
  const tabs = new Set();
  for (const spec of collectionsMod.COLLECTIONS) {
    assert.ok(spec.plugin, `${spec.key} پلاگین ندارد`);
    assert.ok(spec.tab, `${spec.key} تب ندارد`);
    assert.ok(!tabs.has(spec.tab), `تب «${spec.tab}» دو بار اعلام شده`);
    tabs.add(spec.tab);

    // هر ستون جدول باید یک فیلد واقعی باشد، وگرنه UI یک ستون همیشه‌خالی
    // رندر می‌کند.
    const keys = new Set([...spec.fields.map((f) => f.key), "created_at", "updated_at", "id"]);
    for (const column of spec.listColumns) {
      assert.ok(keys.has(column), `ستون «${column}» در ${spec.key} فیلد ندارد`);
    }
  }
});

test("شناسه‌ها همان قالب بات را دارند", () => {
  const withPrefix = collectionsMod.newRecordId("svc");
  assert.match(withPrefix, /^svc_[0-9a-f]{12}$/, "قالب plugins/_common/store.py:new_id");

  const withoutPrefix = collectionsMod.newRecordId("");
  assert.match(withoutPrefix, /^[0-9a-f]{12}$/);

  // یکتایی — دو فراخوانی پشت‌سرهم نباید یکی باشند.
  assert.notEqual(collectionsMod.newRecordId("tag"), collectionsMod.newRecordId("tag"));
});

test("مجموعه‌های فقط‌خواندنی، همان‌هایی هستند که بات شمارنده/کلید ترکیبی دارد", () => {
  const readonly = collectionsMod.COLLECTIONS.filter((c) => c.readonly).map((c) => c.key);
  // حساب امتیاز: نوشتن مستقیم، لِجِر `loyalty_events` را دور می‌زد.
  assert.ok(readonly.includes("loyalty-accounts"));
  // تخصیص برچسب: کلیدش ترکیبی است (`<user_id>:<tag_id>`).
  assert.ok(readonly.includes("crm-user-tags"));
});

test("فیلدهای شمارنده‌ی بات، readonly اعلام شده‌اند", () => {
  // اگر سایت اجازه‌ی نوشتن روی این‌ها را بدهد، عددی که بات نگه می‌دارد خراب می‌شود.
  // درپ (drip-campaigns) از فاز ۱۹ به بعد اینجا نیست — یک lib/dripStore.ts
  // اختصاصی دارد (مثل booking/address) که sent_count را اصلاً در ورودی
  // create/update نمی‌پذیرد، نه اینکه با type:"readonly" نشانش بدهد.
  const counters = {
    giveaways: "entry_count",
    surveys: "response_count",
  };
  for (const [collection, field] of Object.entries(counters)) {
    const spec = collectionsMod.getCollection(collection);
    assert.ok(spec, `${collection} پیدا نشد`);
    const found = spec.fields.find((f) => f.key === field);
    assert.ok(found, `${collection} فیلد ${field} ندارد`);
    assert.equal(found.type, "readonly", `${collection}.${field} باید readonly باشد`);
  }
});

test("مجموعه‌ی ناشناخته null برمی‌گرداند (روت ۴۰۴ می‌دهد)", () => {
  assert.equal(collectionsMod.getCollection("nope"), null);
});

test("مجموعه‌های هر پلاگین قابل استخراج‌اند", () => {
  // IRFORGE_PROMPT_V3 Phase 17 — booking-slots/booking-reservations یک
  // UI/روتِ اختصاصی گرفتند (BookingSection.tsx / routes/booking.ts)،
  // درست مثل تیکت. فقط booking-services روی سیستم عمومی مانده.
  const booking = collectionsMod.collectionsOfPlugin("booking").map((c) => c.key);
  assert.deepEqual(booking.sort(), ["booking-services"]);
  assert.deepEqual(collectionsMod.collectionsOfPlugin("ticket"), [],
    "تیکت سکشن اختصاصی خودش را دارد (botSupportTickets.ts)");
});
