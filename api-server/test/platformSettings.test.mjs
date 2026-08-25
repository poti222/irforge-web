/**
 * test/platformSettings.test.mjs — جدول key/value تنظیمات پلتفرم.
 *
 * چیزهایی که این تست نگه می‌دارد:
 *   ۱. سه لایه‌ی مقدار: ردیفِ دیتابیس > env > پیش‌فرضِ ثابت.
 *   ۲. خطای دیتابیس (یا نبودِ ردیف) هرگز throw نمی‌کند — فقط پیش‌فرض برمی‌گردد؛
 *      این دقیقاً همان دلیلی‌ست که صفحه‌ی کیف پول/فوتر نباید ۵۰۰ بدهند.
 *   ۳. ادغام کلیدبه‌کلید است: یک ردیفِ ذخیره‌شده‌ی ناقص (قبل از افزوده‌شدنِ یک
 *      فیلد جدید) نباید آن فیلد را `undefined` به کلاینت بفرستد.
 *   ۴. `tutorialLinks` (فاز ۲۱): ردیفِ نیمه‌پر (بدون label یا url) هرگز ذخیره
 *      نمی‌شود، id غایب خودکار ساخته می‌شود، id موجود دست‌نخورده می‌ماند.
 *
 * `db.select`/`db.insert` اینجا با یک fake جایگزین می‌شوند — دقیقاً همان
 * ترفندِ `catalogSheetLayer` در pluginCatalog.test.mjs، چون `@workspace/db`
 * یک نمونه‌ی Drizzle واقعی است و این تست نباید به یک Postgres واقعی وصل شود.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// `@workspace/db` موقع import بدون DATABASE_URL throw می‌کند.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db, platformSettingsTable } = await import("@workspace/db");
const mod = await import("../src/lib/platformSettings.ts");

/**
 * `db.select()`/`db.insert()` را برای طول یک تست جایگزین می‌کند.
 * `row` — یا یک ردیفِ خام (`{key, value}`) یا `null` (یعنی «هنوز ذخیره نشده»)
 * یا یک تابع که پرتاب می‌کند (برای شبیه‌سازی خطای دیتابیس).
 */
function installDb(row) {
  const inserted = [];
  db.select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          if (typeof row === "function") return row();
          return row ? [row] : [];
        },
      }),
    }),
  });
  db.insert = (table) => ({
    values: (value) => {
      inserted.push({ table, value });
      return { onConflictDoUpdate: async () => {} };
    },
  });
  return inserted;
}

function fakeRow(key, value) {
  return { key, value: JSON.stringify(value) };
}

// ─── payment_methods ────────────────────────────────────────────────────────

test("payment_methods: بدون ردیف در دیتابیس → پیش‌فرضِ env", async () => {
  delete process.env.USDT_DEPOSIT_ADDRESS;
  installDb(null);

  const settings = await mod.getPaymentMethods();
  assert.equal(settings.usdt.address, "");
  assert.equal(settings.usdt.network, "TRC20");
  assert.equal(settings.usdt.enabled, true);
  assert.equal(settings.card.enabled, true);
});

test("payment_methods: ردیفِ ذخیره‌شده روی پیش‌فرض سوار می‌شود", async () => {
  installDb(fakeRow(mod.PAYMENT_METHODS_KEY, {
    usdt: { address: "TAbc123", enabled: false },
    card: { number: "6037-xxxx", holder: "علی" },
  }));

  const settings = await mod.getPaymentMethods();
  assert.equal(settings.usdt.address, "TAbc123");
  assert.equal(settings.usdt.enabled, false, "فیلد ذخیره‌شده باید غالب باشد");
  assert.equal(settings.usdt.network, "TRC20", "فیلدِ نیامده باید از پیش‌فرض بیاید");
  assert.equal(settings.card.number, "6037-xxxx");
  assert.equal(settings.card.holder, "علی");
  assert.equal(settings.card.enabled, true, "فیلدِ نیامده باید از پیش‌فرض بیاید");
});

test("payment_methods: خطای دیتابیس → پیش‌فرض، بدون throw", async () => {
  installDb(() => {
    throw new Error("connection refused");
  });

  const settings = await mod.getPaymentMethods();
  assert.equal(settings.usdt.address, "");
  assert.equal(settings.card.enabled, true);
});

test("payment_methods: setPaymentMethods روی همان کلید upsert می‌کند", async () => {
  const inserted = installDb(null);

  const saved = await mod.setPaymentMethods(
    { usdt: { address: "TZZZ", network: "TRC20", enabled: true } },
    "user_1",
  );

  assert.equal(saved.usdt.address, "TZZZ");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].value.key, mod.PAYMENT_METHODS_KEY);
  assert.equal(inserted[0].value.updatedBy, "user_1");
  assert.equal(JSON.parse(inserted[0].value.value).usdt.address, "TZZZ");
});

// ─── support_links (فاز ۲۱) ─────────────────────────────────────────────────

test("support_links: بدون ردیف در دیتابیس → پیش‌فرضِ hardcode‌شده", async () => {
  delete process.env.EDUCATION_CHANNEL_URL;
  delete process.env.INSTAGRAM_URL;
  installDb(null);

  const settings = await mod.getSupportLinks();
  assert.equal(settings.educationChannelUrl, "https://t.me/irforge_Education");
  assert.equal(settings.instagramHandle, "@ir_forge");
  assert.equal(settings.tutorialLinks.length, 1);
  assert.equal(settings.tutorialLinks[0].id, "education-channel");
});

test("support_links: خطای دیتابیس → پیش‌فرض، بدون throw", async () => {
  installDb(() => {
    throw new Error("ECONNREFUSED");
  });

  const settings = await mod.getSupportLinks();
  assert.equal(settings.instagramUrl, "https://instagram.com/ir_forge");
});

test("support_links: ردیفِ ذخیره‌شده روی پیش‌فرض سوار می‌شود", async () => {
  installDb(fakeRow(mod.SUPPORT_LINKS_KEY, {
    educationChannelHandle: "@my_channel",
    tutorialLinks: [{ id: "getting-started", label: "شروع کار", url: "https://example.com/1" }],
  }));

  const settings = await mod.getSupportLinks();
  assert.equal(settings.educationChannelHandle, "@my_channel");
  assert.equal(settings.educationChannelUrl, "https://t.me/irforge_Education", "فیلدِ نیامده باید از پیش‌فرض بیاید");
  assert.equal(settings.tutorialLinks.length, 1);
  assert.equal(settings.tutorialLinks[0].label, "شروع کار");
});

test("support_links: رشته‌ی خالی در ردیفِ ذخیره‌شده به پیش‌فرض سقوط می‌کند", async () => {
  installDb(fakeRow(mod.SUPPORT_LINKS_KEY, { educationChannelUrl: "   " }));

  const settings = await mod.getSupportLinks();
  assert.equal(settings.educationChannelUrl, "https://t.me/irforge_Education");
});

test("support_links: tutorialLinks غیرآرایه → آرایه‌ی پیش‌فرض", async () => {
  installDb(fakeRow(mod.SUPPORT_LINKS_KEY, { tutorialLinks: "نه یک آرایه" }));

  const settings = await mod.getSupportLinks();
  assert.equal(settings.tutorialLinks.length, 1);
  assert.equal(settings.tutorialLinks[0].id, "education-channel");
});

test("support_links: لینکِ بدون label یا بدون url هرگز ذخیره نمی‌شود", async () => {
  const inserted = installDb(null);

  const saved = await mod.setSupportLinks({
    tutorialLinks: [
      { label: "", url: "https://example.com/a" },
      { label: "بدون آدرس", url: "" },
      { label: "معتبر", url: "https://example.com/b" },
    ],
  }, "admin_1");

  assert.equal(saved.tutorialLinks.length, 1);
  assert.equal(saved.tutorialLinks[0].label, "معتبر");
  assert.equal(inserted[0].value.key, mod.SUPPORT_LINKS_KEY);
});

test("support_links: id غایب خودکار ساخته می‌شود، id موجود دست‌نخورده می‌ماند", async () => {
  installDb(null);

  const saved = await mod.setSupportLinks({
    tutorialLinks: [
      { label: "بدون id", url: "https://example.com/a" },
      { id: "keep-me", label: "با id", url: "https://example.com/b" },
    ],
  }, "admin_1");

  assert.ok(saved.tutorialLinks[0].id, "باید یک id خودکار بگیرد");
  assert.notEqual(saved.tutorialLinks[0].id, "");
  assert.equal(saved.tutorialLinks[1].id, "keep-me");
});

test("support_links: label/url بلند به سقفِ طول برش می‌خورند", async () => {
  installDb(null);

  const saved = await mod.setSupportLinks({
    tutorialLinks: [{ label: "ط".repeat(200), url: "https://example.com/" + "a".repeat(600) }],
  }, "admin_1");

  assert.equal(saved.tutorialLinks[0].label.length, 80);
  assert.equal(saved.tutorialLinks[0].url.length, 500);
});

// ─── currency_display (فاز ۳۹) ──────────────────────────────────────────────

test("currency_display: بدون ردیف و بدون نرخِ تتر → فهرستِ خالی", async () => {
  delete process.env.USDT_TOMAN_RATE;
  installDb(null);

  const settings = await mod.getCurrencyDisplay();
  assert.deepEqual(settings.rates, []);
});

test("currency_display: بدون ردیفِ ذخیره‌شده، ولی نرخِ تتر تنظیم شده → دلار از همان نرخ پیشنهاد می‌شود", async () => {
  process.env.USDT_TOMAN_RATE = "850000";
  installDb(null);

  const settings = await mod.getCurrencyDisplay();
  assert.equal(settings.rates.length, 1);
  assert.equal(settings.rates[0].code, "USD");
  assert.equal(settings.rates[0].tomanPerUnit, 850000);
  delete process.env.USDT_TOMAN_RATE;
});

test("currency_display: ردیفِ ذخیره‌شده حرفِ آخر است، حتی اگر نرخِ تتر هم تنظیم شده باشد", async () => {
  process.env.USDT_TOMAN_RATE = "850000";
  installDb(fakeRow(mod.CURRENCY_DISPLAY_KEY, { rates: [{ code: "EUR", label: "یورو", tomanPerUnit: 900000 }] }));

  const settings = await mod.getCurrencyDisplay();
  assert.equal(settings.rates.length, 1);
  assert.equal(settings.rates[0].code, "EUR");
  assert.equal(settings.rates[0].tomanPerUnit, 900000);
  delete process.env.USDT_TOMAN_RATE;
});

test("currency_display: خطای دیتابیس → فهرستِ خالی، بدون throw", async () => {
  installDb(() => { throw new Error("ECONNREFUSED"); });

  const settings = await mod.getCurrencyDisplay();
  assert.deepEqual(settings.rates, []);
});

test("currency_display: کدِ نامعتبر یا برچسبِ خالی یا نرخِ غیرمثبت هرگز ذخیره نمی‌شود", async () => {
  const inserted = installDb(null);

  const saved = await mod.setCurrencyDisplay({
    rates: [
      { code: "U1", label: "دلار", tomanPerUnit: 850000 },        // کد باید فقط حروف باشد -> رد
      { code: "USD", label: "", tomanPerUnit: 850000 },           // برچسبِ خالی -> رد
      { code: "USD", label: "دلار", tomanPerUnit: 0 },            // نرخِ غیرمثبت -> رد
      { code: "USD", label: "دلار آمریکا", tomanPerUnit: 850000 }, // معتبر
    ],
  }, "admin_1");

  assert.equal(saved.rates.length, 1);
  assert.equal(saved.rates[0].code, "USD");
  assert.equal(inserted[0].value.key, mod.CURRENCY_DISPLAY_KEY);
});

test("currency_display: کدِ کوچک خودکار بزرگ می‌شود", async () => {
  installDb(null);
  const saved = await mod.setCurrencyDisplay({ rates: [{ code: "usd", label: "دلار", tomanPerUnit: 1 }] }, "admin_1");
  assert.equal(saved.rates[0].code, "USD");
});

test("currency_display: کدِ تکراری فقط یک‌بار می‌ماند", async () => {
  installDb(null);
  const saved = await mod.setCurrencyDisplay({
    rates: [
      { code: "USD", label: "اول", tomanPerUnit: 850000 },
      { code: "USD", label: "دوم", tomanPerUnit: 900000 },
    ],
  }, "admin_1");
  assert.equal(saved.rates.length, 1);
  assert.equal(saved.rates[0].label, "اول");
});
