/**
 * test/pluginPricing.test.mjs — قیمت‌گذاری پلاگین و بات سفارشی.
 *
 * ادعای اصلی که این تست نگه می‌دارد: **قیمت از سرور می‌آید، نه از کلاینت.**
 *
 * `POST /bots/wallet-purchase` تا پیش از این `amount` بدنه‌ی درخواست را از کیف
 * پول کم می‌کرد. با یک پکیج ثابت این حداکثر یک ایراد بود؛ با بات سفارشی که
 * قیمتش به رم، پردازنده و فهرست پلاگین‌های انتخابی بستگی دارد، یعنی هر کسی
 * می‌توانست بات کامل را با مبلغ صفر بخرد. تست‌های زیر همان مسیر را قفل می‌کنند.
 *
 * IRFORGE_PRODUCTS_SECTION_PROMPT Phase 2 — پکیجِ آماده (استاندارد/پرو) دیگر
 * از یک ثابتِ هاردکد نمی‌آید، از جدولِ `products` می‌آید (`getBotTierProduct()`)،
 * پس `resolvePurchasePrice()` async شد و این تست‌ها `db.select` را با یک
 * fakeی کوچک جایگزین می‌کنند — همان ترکِ استانداردِ این مجموعه‌تست
 * (`planLimits.test.mjs`/`platformSettings.test.mjs`: چون `@workspace/db` یک
 * نمونه‌ی واقعیِ Drizzle است، `db.select` فقط برای طولِ هر تست عوض می‌شود، نه
 * یک Postgresِ واقعی). محافظِ drift‌ِ قدیمی (مقایسه‌ی BOT_TIER_PRICES با
 * bot-tiers.ts) از بین رفت چون آن ثابت دیگر وجود ندارد — یک منبعِ واحد
 * (جدولِ products) دیگر چیزی برای drift‌کردن با آن ندارد.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db, productsTable } = await import("@workspace/db");
const pricing = await import("../src/lib/pluginPricing.ts");
const sync = await import("../src/lib/marketplaceSync.ts");

const {
  PLUGIN_PRICES, CUSTOM_BUILD,
  pluginPrice, isPluginFree, quoteCustomBuild, quotePluginAddons, resolvePurchasePrice, getBotTierProduct,
} = pricing;

/** یک id پلاگین رایگان که در `PLUGIN_PRICES` نیست (پس `pluginPrice` صفر می‌دهد). */
const FREE_PLUGIN_IDS = ["freeplug-a", "freeplug-b", "freeplug-c", "freeplug-d"];

// همان دو عددِ قدیمیِ BOT_TIER_PRICES، حالا فقط برای خواناییِ تست‌ها محلی —
// منبعِ واقعیِ قیمت دیگر همین‌جا نیست، جدولِ seed شده‌ی SEEDED_BOT_PRODUCTS است.
const STANDARD_PRICE_TOMAN = 500_000;
const PRO_PRICE_TOMAN = 1_100_000;

/** بازتابِ سیدِ اولیه‌ی migrate.mjs (PROGRESS.md's Phase 1/2) — همان دو ردیفِ واقعی، برای اینکه تست‌ها همان چیزی را می‌سنجند که در پروداکشن هم واقعاً نشسته. */
const SEEDED_BOT_PRODUCTS = {
  standard: { id: "standard", categoryId: "bot", price: 5_000_000, isActive: true, metadata: { maxFreePlugins: 3 } },
  pro:      { id: "pro",      categoryId: "bot", price: 11_000_000, isActive: true, metadata: { maxFreePlugins: 6 } },
};

/**
 * `getBotTierProduct()` هر بار دقیقاً یک `tierId` می‌خواهد، پس این fake نیازی
 * به parseکردنِ AST شرطِ Drizzleی `.where()` ندارد — کافی است بداند برای
 * *این* درخواست کدام ردیف (یا هیچ‌کدام) باید برگردد. هر تست، قبل از
 * فراخوانی، دقیقاً همان ردیفی را نصب می‌کند که انتظار دارد `getBotTierProduct`
 * ببیند — همان سادگیِ فِیکِ `planLimits.test.mjs`.
 */
function installBotTierRow(row) {
  db.select = () => ({
    from: (table) => ({
      where: () => ({
        limit: async () => (table === productsTable && row ? [row] : []),
      }),
    }),
  });
}

// ─── قیمت پلاگین ────────────────────────────────────────────────────────────

test("پلاگین ناشناخته رایگان است، نه غیرقابل‌فروش", () => {
  // رفتار بی‌خطرتر: یک پلاگین تازه در بات که هنوز قیمت‌گذاری نشده باید کار
  // کند و رایگان باشد، نه اینکه خرید/نصبش کاملاً ببندد.
  assert.equal(pluginPrice("a-plugin-nobody-priced"), 0);
  assert.equal(isPluginFree("a-plugin-nobody-priced"), true);
});

test("پلاگین‌های زیرساخت درآمد گران‌تر از جانبی‌ها هستند", () => {
  // ترتیب عمدی است، نه اتفاقی: چیزی که یک کسب‌وکار را می‌گرداند گران‌تر از
  // یک ابزار تعامل است.
  assert.ok(pluginPrice("catalog") > pluginPrice("loyalty"));
  assert.ok(pluginPrice("subscription") > pluginPrice("crm"));
  assert.ok(pluginPrice("loyalty") > pluginPrice("giveaway"));
  assert.ok(pluginPrice("giveaway") > 0, "ارزان یعنی کم، نه صفر");
});

test("هر پلاگین قیمت‌گذاری‌شده عددی مثبت و صحیح دارد", () => {
  for (const [id, price] of Object.entries(PLUGIN_PRICES)) {
    assert.ok(Number.isInteger(price), `${id} قیمت غیرصحیح دارد`);
    assert.ok(price > 0, `${id} قیمت صفر/منفی دارد`);
  }
});

// ─── بات سفارشی ─────────────────────────────────────────────────────────────

test("سفارشیِ حداقلی = قیمت پایه", () => {
  const quote = quoteCustomBuild({
    ramGb: CUSTOM_BUILD.includedRamGb,
    cpuCores: CUSTOM_BUILD.includedCpuCores,
    pluginIds: [],
  });
  assert.equal(quote.resources, 0);
  assert.equal(quote.pluginsTotal, 0);
  assert.equal(quote.total, CUSTOM_BUILD.basePrice);
});

test("سفارشیِ حداقلی ارزان‌تر از ارزان‌ترین پکیجِ آماده درنمی‌آید", () => {
  // وگرنه پکیج‌های آماده بی‌معنی می‌شدند: همه سفارشیِ حداقلی می‌خریدند.
  const minimum = quoteCustomBuild({ ramGb: 1, cpuCores: 1, pluginIds: [] }).total;
  assert.ok(minimum >= STANDARD_PRICE_TOMAN);
});

test("منابع بیشتر، قیمت را بالا می‌برد — دقیقاً به اندازه‌ی مازاد", () => {
  const quote = quoteCustomBuild({ ramGb: 4, cpuCores: 3, pluginIds: [] });
  assert.equal(quote.extraRamGb, 4 - CUSTOM_BUILD.includedRamGb);
  assert.equal(quote.extraCpuCores, 3 - CUSTOM_BUILD.includedCpuCores);
  assert.equal(
    quote.resources,
    quote.extraRamGb * CUSTOM_BUILD.pricePerRamGb + quote.extraCpuCores * CUSTOM_BUILD.pricePerCpuCore,
  );
  assert.equal(quote.total, CUSTOM_BUILD.basePrice + quote.resources);
});

test("افزودن و کم‌کردن پلاگین، مجموع را بالا و پایین می‌برد", () => {
  const base = quoteCustomBuild({ ramGb: 2, cpuCores: 2, pluginIds: [] }).total;
  const withOne = quoteCustomBuild({ ramGb: 2, cpuCores: 2, pluginIds: ["booking"] }).total;
  const withTwo = quoteCustomBuild({ ramGb: 2, cpuCores: 2, pluginIds: ["booking", "survey"] }).total;

  assert.equal(withOne, base + pluginPrice("booking"));
  assert.equal(withTwo, withOne + pluginPrice("survey"));
  // و برداشتنش دقیقاً به همان نقطه برمی‌گردد.
  assert.equal(quoteCustomBuild({ ramGb: 2, cpuCores: 2, pluginIds: [] }).total, base);
});

test("پلاگین تکراری دو بار حساب نمی‌شود", () => {
  const once = quoteCustomBuild({ ramGb: 1, cpuCores: 1, pluginIds: ["booking"] });
  const twice = quoteCustomBuild({ ramGb: 1, cpuCores: 1, pluginIds: ["booking", "booking"] });
  assert.equal(twice.total, once.total);
  assert.equal(twice.plugins.length, 1);
});

test("رم/هسته‌ی خارج از بازه clamp می‌شود، نه اینکه قیمت را منفی/نامحدود کند", () => {
  const tooBig = quoteCustomBuild({ ramGb: 9999, cpuCores: 9999, pluginIds: [] });
  assert.equal(tooBig.ramGb, CUSTOM_BUILD.maxRamGb);
  assert.equal(tooBig.cpuCores, CUSTOM_BUILD.maxCpuCores);

  const negative = quoteCustomBuild({ ramGb: -5, cpuCores: -5, pluginIds: [] });
  assert.equal(negative.ramGb, 1);
  assert.equal(negative.cpuCores, 1);
  assert.ok(negative.total >= CUSTOM_BUILD.basePrice);

  const garbage = quoteCustomBuild({ ramGb: "abc", cpuCores: null, pluginIds: [] });
  assert.ok(garbage.total >= CUSTOM_BUILD.basePrice, "ورودی بی‌معنی به پیش‌فرض می‌افتد");
});

test("پلاگینی که در کاتالوگ نیست، کنار گذاشته می‌شود", () => {
  // وگرنه کسی می‌توانست با یک id ساختگی بعداً ادعای نصب کند.
  const known = ["booking", "survey"];
  const quote = quoteCustomBuild(
    { ramGb: 1, cpuCores: 1, pluginIds: ["booking", "made-up-plugin"] },
    known,
  );
  assert.deepEqual(quote.plugins.map((p) => p.id), ["booking"]);
});

// ─── مبلغ قابل پرداخت ───────────────────────────────────────────────────────

test("سفارشی: مبلغ از spec حساب می‌شود و `amount` کلاینت نادیده گرفته می‌شود", async () => {
  const resolved = await resolvePurchasePrice({
    amount: 0, // ← تلاش برای صفر کردن
    buildSpec: { tierId: "custom", ramGb: 4, cpuCores: 4, pluginIds: ["catalog", "wallet"] },
  });
  const expected = quoteCustomBuild({ ramGb: 4, cpuCores: 4, pluginIds: ["catalog", "wallet"] }).total;

  assert.equal(resolved.source, "custom-build");
  assert.equal(resolved.total, expected);
  assert.ok(resolved.total > 0, "مبلغ صفرِ فرستاده‌شده نباید پذیرفته شود");
});

test("پکیج آماده: قیمت پکیج + پلاگین‌ها، نه `amount` کلاینت", async () => {
  // پرو سهمیه‌ی ۶ پلاگینِ رایگان دارد؛ ۶ تای اول اینجا آن سهمیه را پر
  // می‌کنند تا "ticket" (هفتمی) واقعاً پولی حساب شود — همان چیزی که این
  // تست می‌خواهد نشان دهد: مبلغ از amount کلاینت نمی‌آید.
  installBotTierRow(SEEDED_BOT_PRODUCTS.pro);
  const filler = ["survey", "giveaway", "feedback", "waitlist", "files", "discount"];
  const resolved = await resolvePurchasePrice({
    amount: 1,
    buildSpec: { tierId: "pro", pluginIds: [...filler, "ticket"] },
  });
  assert.equal(resolved.source, "tier");
  assert.equal(resolved.total, PRO_PRICE_TOMAN + pluginPrice("ticket"));
});

test("بدون spec، مسیر قدیمی دست‌نخورده می‌ماند", async () => {
  // خریدهایی که از جای دیگری می‌آیند نباید با این تغییر بشکنند.
  const resolved = await resolvePurchasePrice({ amount: 250_000 });
  assert.equal(resolved.source, "client-amount");
  assert.equal(resolved.total, 250_000);
  assert.deepEqual(resolved.pluginIds, []);
});

test("مبلغ منفی از کلاینت پذیرفته نمی‌شود", async () => {
  // وگرنه «خرید» می‌توانست به کیف پول اضافه کند.
  assert.equal((await resolvePurchasePrice({ amount: -500_000 })).total, 0);
});

test("پکیج ناشناخته به مسیر amount می‌افتد، نه به قیمت صفر", async () => {
  installBotTierRow(null); // "platinum" هیچ‌وقت در products وجود نداشته
  const resolved = await resolvePurchasePrice({ amount: 99_000, buildSpec: { tierId: "platinum", pluginIds: [] } });
  assert.equal(resolved.source, "client-amount");
  assert.equal(resolved.total, 99_000);
});

test("پکیجِ غیرفعال هم مثلِ ناموجود رفتار می‌کند، نه اینکه قیمتِ آخرین‌بار را نگه دارد", async () => {
  // IRFORGE_PRODUCTS_SECTION_PROMPT Phase 2 — getBotTierProduct() خودش
  // isActive=true را در where شرط می‌کند، پس یک ردیفِ غیرفعال برای این fake
  // یعنی «هیچ ردیفی برنگشت»، دقیقاً مثلِ tierId ناموجود.
  installBotTierRow(null);
  const resolved = await resolvePurchasePrice({ amount: 42_000, buildSpec: { tierId: "standard", pluginIds: [] } });
  assert.equal(resolved.source, "client-amount");
  assert.equal(resolved.total, 42_000);
});

test("پلاگین‌های پرداخت‌شده همان‌هایی هستند که نصب می‌شوند", async () => {
  // روت خرید از همین فهرست برای ساختن ردیف‌های installed_plugins استفاده
  // می‌کند؛ اگر با آنچه حساب شده یکی نبود، کاربر پول چیزی را می‌داد که نصب
  // نمی‌شد (یا برعکس).
  const resolved = await resolvePurchasePrice({
    buildSpec: { tierId: "custom", ramGb: 2, cpuCores: 2, pluginIds: ["booking", "crm", "booking"] },
  });
  assert.deepEqual(resolved.pluginIds.sort(), ["booking", "crm"]);
});

test("افزودنی روی پکیج آماده جدا هم قابل محاسبه است", () => {
  // maxFreePlugins=0 یعنی سهمیه‌ی رایگان صفر — این تست جمعِ خامِ قیمت‌ها را
  // می‌سنجد، نه رفتارِ سهمیه (که تست‌های خودش را پایین‌تر دارد).
  const addons = quotePluginAddons(["survey", "giveaway"], undefined, 0);
  assert.equal(addons.total, pluginPrice("survey") + pluginPrice("giveaway"));
  assert.equal(quotePluginAddons(null).total, 0, "ورودی غیرآرایه = صفر، نه خطا");
  assert.equal(quotePluginAddons("booking").total, 0);
});

// ─── سهمیه‌ی «پلاگین رایگانِ به‌انتخاب خودت» ────────────────────────────────
// همه‌ی پلاگین‌ها پولی‌اند (بالا). این سهمیه دیگر «چند رایگان می‌شود برداشت»
// نیست: کاربر هر چند پلاگینِ پولی که بخواهد انتخاب می‌کند، و اولین N تا
// (به ترتیبِ همان انتخاب) رایگان حساب می‌شوند — نه اینکه مازاد کنار گذاشته
// شود، فقط پولی می‌ماند.

test("quotePluginAddons: از میانِ پلاگین‌های انتخابی، اولین N تا (به ترتیبِ انتخاب) رایگان می‌شوند", () => {
  const chosen = ["survey", "giveaway", "loyalty", "crm"]; // هر ۴ تا پولی‌اند
  const addons = quotePluginAddons(chosen, undefined, 2);

  const byId = Object.fromEntries(addons.plugins.map((p) => [p.id, p.price]));
  assert.equal(byId.survey, 0, "اولین انتخاب رایگان است");
  assert.equal(byId.giveaway, 0, "دومین انتخاب هم رایگان است");
  assert.equal(byId.loyalty, pluginPrice("loyalty"), "سومی از سهمیه رد شده، پس پولی است");
  assert.equal(byId.crm, pluginPrice("crm"), "چهارمی هم پولی است");
  // هیچ‌کدام کنار گذاشته نمی‌شود — هر ۴ تا نصب می‌شوند.
  assert.equal(addons.plugins.length, 4);
  assert.deepEqual(addons.droppedFreePluginIds, []);
  assert.equal(addons.total, pluginPrice("loyalty") + pluginPrice("crm"));
});

test("quotePluginAddons: پلاگینِ ذاتاً رایگان (قیمت‌گذاری‌نشده) از سهمیه چیزی کم نمی‌کند", () => {
  // FREE_PLUGIN_IDS در جدولِ قیمت نیستند، پس صفرند و مستقل از سهمیه می‌مانند.
  const chosen = [...FREE_PLUGIN_IDS, "survey", "giveaway", "loyalty"];
  const addons = quotePluginAddons(chosen, undefined, 2);

  const byId = Object.fromEntries(addons.plugins.map((p) => [p.id, p.price]));
  for (const id of FREE_PLUGIN_IDS) assert.equal(byId[id], 0);
  assert.equal(byId.survey, 0);
  assert.equal(byId.giveaway, 0);
  assert.equal(byId.loyalty, pluginPrice("loyalty"), "سهمیه فقط بینِ پولی‌ها مصرف شد، نه رایگان‌های ذاتی");
  assert.equal(addons.total, pluginPrice("loyalty"));
});

test("quotePluginAddons: بدون سقف مشخص، همه‌ی رایگان‌های ذاتی می‌مانند (پیش‌فرض دست‌نخورده)", () => {
  const addons = quotePluginAddons(FREE_PLUGIN_IDS);
  assert.deepEqual(addons.droppedFreePluginIds, []);
  assert.equal(addons.plugins.length, FREE_PLUGIN_IDS.length);
});

test("resolvePurchasePrice: پکیجِ استاندارد اولین ۳ پلاگینِ انتخابی را رایگان می‌کند، نه بیشتر", async () => {
  installBotTierRow(SEEDED_BOT_PRODUCTS.standard);
  const chosen = ["survey", "giveaway", "feedback", "loyalty", "crm"]; // ۵ تا، سقف ۳
  const resolved = await resolvePurchasePrice({
    buildSpec: { tierId: "standard", pluginIds: chosen },
  });
  assert.equal(resolved.source, "tier");
  // هیچ‌کدام کنار گذاشته نمی‌شود — هر ۵ تا نصب می‌شوند.
  assert.equal(resolved.pluginIds.length, chosen.length);
  assert.deepEqual(resolved.droppedFreePluginIds, []);
  // فقط ۲ تای آخر (بعد از سهمیه‌ی ۳ تایی) پولی حساب می‌شوند.
  assert.equal(resolved.total, STANDARD_PRICE_TOMAN + pluginPrice("loyalty") + pluginPrice("crm"));
});

test("resolvePurchasePrice: انتخابِ کمتر یا برابرِ سهمیه یعنی همه‌شان رایگان‌اند", async () => {
  installBotTierRow(SEEDED_BOT_PRODUCTS.pro);
  const resolved = await resolvePurchasePrice({
    buildSpec: { tierId: "pro", pluginIds: ["survey", "giveaway"] }, // سقفِ پرو ۶ است
  });
  assert.equal(resolved.total, PRO_PRICE_TOMAN);
  assert.equal(resolved.pluginIds.length, 2);
});

test("resolvePurchasePrice: بات سفارشی سقفِ پلاگین رایگان ندارد", async () => {
  // «سفارشی» عمداً از این سقف مستثناست — قبلاً هم تست‌های بالا با بات سفارشی
  // چند پلاگین پولی جمع می‌زدند بدون هیچ محدودیتی؛ اینجا با رایگان هم همینه.
  const resolved = await resolvePurchasePrice({
    buildSpec: { tierId: "custom", ramGb: 1, cpuCores: 1, pluginIds: FREE_PLUGIN_IDS },
  });
  assert.equal(resolved.pluginIds.length, FREE_PLUGIN_IDS.length);
});

// ─── getBotTierProduct ──────────────────────────────────────────────────────

test("getBotTierProduct: قیمتِ ریالِ دیتابیس به تومان تبدیل می‌شود و maxFreePlugins از metadata می‌آید", async () => {
  installBotTierRow(SEEDED_BOT_PRODUCTS.standard);
  const product = await getBotTierProduct("standard");
  assert.equal(product.priceToman, STANDARD_PRICE_TOMAN);
  assert.equal(product.maxFreePlugins, 3);
});

test("getBotTierProduct: ردیفِ ناموجود یا غیرفعال null برمی‌گرداند، نه پرتاب خطا", async () => {
  installBotTierRow(null);
  assert.equal(await getBotTierProduct("does-not-exist"), null);
});

test("getBotTierProduct: metadataی بدونِ maxFreePlugins به Infinity می‌افتد، نه صفر", async () => {
  // یک محصولِ بات که هنوز این کلید را ندارد نباید همه‌ی پلاگین‌هایش پولی شود.
  installBotTierRow({ id: "standard", categoryId: "bot", price: 5_000_000, isActive: true, metadata: {} });
  const product = await getBotTierProduct("standard");
  assert.equal(product.maxFreePlugins, Infinity);
});

test("سقف منابع سفارشی در سرور و فرانت یکی است", () => {
  const source = fs.readFileSync(
    new URL("../../irforge/src/lib/bot-tiers.ts", import.meta.url),
    "utf8",
  );
  const ram = source.match(/CUSTOM_MAX_RAM_GB\s*=\s*(\d+)/);
  const cpu = source.match(/CUSTOM_MAX_CPU_CORES\s*=\s*(\d+)/);
  assert.equal(Number(ram[1]), CUSTOM_BUILD.maxRamGb);
  assert.equal(Number(cpu[1]), CUSTOM_BUILD.maxCpuCores);
});

// ─── پیوند مارکت‌پلیس ↔ پلاگین ──────────────────────────────────────────────

test("شناسه‌ی آیتم مارکت‌پلیس از plugin_id مشتق می‌شود و برگشت‌پذیر است", () => {
  // پیوند خرید↔پلاگین قبلاً با تطبیق **اسم** بود، که با اولین تغییر نمایشیِ
  // نام یک پلاگین، خریدِ ثبت‌شده را بی‌صاحب می‌کرد.
  for (const id of ["booking", "crm", "wallet"]) {
    const itemId = sync.marketplaceItemIdFor(id);
    assert.equal(sync.pluginIdFromItemId(itemId), id);
  }
  assert.equal(sync.pluginIdFromItemId("some-other-item"), null);
  assert.equal(sync.pluginIdFromItemId(null), null);
  assert.equal(sync.pluginIdFromItemId("plugin-"), null, "پیشوند تنها یک شناسه نیست");
});
