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
 * به‌علاوه یک محافظ drift: قیمت پکیج‌های آماده در دو جا نوشته شده (سرور برای
 * محاسبه، فرانت برای نمایش). این تست برابری‌شان را چک می‌کند، پس عوض کردن یکی
 * بدون دیگری قابل merge نیست.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const pricing = await import("../src/lib/pluginPricing.ts");
const sync = await import("../src/lib/marketplaceSync.ts");

const {
  PLUGIN_PRICES, BOT_TIER_PRICES, BOT_TIER_MAX_FREE_PLUGINS, CUSTOM_BUILD,
  pluginPrice, isPluginFree, quoteCustomBuild, quotePluginAddons, resolvePurchasePrice,
} = pricing;

/** یک id پلاگین رایگان که در `PLUGIN_PRICES` نیست (پس `pluginPrice` صفر می‌دهد). */
const FREE_PLUGIN_IDS = ["freeplug-a", "freeplug-b", "freeplug-c", "freeplug-d"];

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
  assert.ok(minimum >= BOT_TIER_PRICES.standard);
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

test("سفارشی: مبلغ از spec حساب می‌شود و `amount` کلاینت نادیده گرفته می‌شود", () => {
  const resolved = resolvePurchasePrice({
    amount: 0, // ← تلاش برای صفر کردن
    buildSpec: { tierId: "custom", ramGb: 4, cpuCores: 4, pluginIds: ["catalog", "wallet"] },
  });
  const expected = quoteCustomBuild({ ramGb: 4, cpuCores: 4, pluginIds: ["catalog", "wallet"] }).total;

  assert.equal(resolved.source, "custom-build");
  assert.equal(resolved.total, expected);
  assert.ok(resolved.total > 0, "مبلغ صفرِ فرستاده‌شده نباید پذیرفته شود");
});

test("پکیج آماده: قیمت پکیج + پلاگین‌ها، نه `amount` کلاینت", () => {
  const resolved = resolvePurchasePrice({
    amount: 1,
    buildSpec: { tierId: "pro", pluginIds: ["ticket"] },
  });
  assert.equal(resolved.source, "tier");
  assert.equal(resolved.total, BOT_TIER_PRICES.pro + pluginPrice("ticket"));
});

test("بدون spec، مسیر قدیمی دست‌نخورده می‌ماند", () => {
  // خریدهایی که از جای دیگری می‌آیند نباید با این تغییر بشکنند.
  const resolved = resolvePurchasePrice({ amount: 250_000 });
  assert.equal(resolved.source, "client-amount");
  assert.equal(resolved.total, 250_000);
  assert.deepEqual(resolved.pluginIds, []);
});

test("مبلغ منفی از کلاینت پذیرفته نمی‌شود", () => {
  // وگرنه «خرید» می‌توانست به کیف پول اضافه کند.
  assert.equal(resolvePurchasePrice({ amount: -500_000 }).total, 0);
});

test("پکیج ناشناخته به مسیر amount می‌افتد، نه به قیمت صفر", () => {
  const resolved = resolvePurchasePrice({ amount: 99_000, buildSpec: { tierId: "platinum", pluginIds: [] } });
  assert.equal(resolved.source, "client-amount");
  assert.equal(resolved.total, 99_000);
});

test("پلاگین‌های پرداخت‌شده همان‌هایی هستند که نصب می‌شوند", () => {
  // روت خرید از همین فهرست برای ساختن ردیف‌های installed_plugins استفاده
  // می‌کند؛ اگر با آنچه حساب شده یکی نبود، کاربر پول چیزی را می‌داد که نصب
  // نمی‌شد (یا برعکس).
  const resolved = resolvePurchasePrice({
    buildSpec: { tierId: "custom", ramGb: 2, cpuCores: 2, pluginIds: ["booking", "crm", "booking"] },
  });
  assert.deepEqual(resolved.pluginIds.sort(), ["booking", "crm"]);
});

test("افزودنی روی پکیج آماده جدا هم قابل محاسبه است", () => {
  const addons = quotePluginAddons(["survey", "giveaway"]);
  assert.equal(addons.total, pluginPrice("survey") + pluginPrice("giveaway"));
  assert.equal(quotePluginAddons(null).total, 0, "ورودی غیرآرایه = صفر، نه خطا");
  assert.equal(quotePluginAddons("booking").total, 0);
});

// ─── سقفِ پلاگین رایگان (مشکل بزرگِ گزارش‌شده) ──────────────────────────────

test("quotePluginAddons: پلاگین‌های رایگان از سقف رد نمی‌شوند، پولی‌ها هیچ‌وقت سقف نمی‌خورند", () => {
  const many = [...FREE_PLUGIN_IDS, "booking", "crm"]; // ۴ رایگان + ۲ پولی
  const capped = quotePluginAddons(many, undefined, 2);

  // فقط ۲ تای اول از رایگان‌ها نگه داشته می‌شود؛ ۲ تای بعدی کنار گذاشته می‌شود.
  assert.deepEqual(capped.droppedFreePluginIds, FREE_PLUGIN_IDS.slice(2));
  const keptIds = capped.plugins.map((p) => p.id);
  assert.ok(keptIds.includes("booking") && keptIds.includes("crm"), "پولی‌ها هرگز کنار گذاشته نمی‌شوند");
  assert.equal(keptIds.filter((id) => FREE_PLUGIN_IDS.includes(id)).length, 2);
  // مازادِ کنارگذاشته‌شده رایگان بود، پس روی مبلغ اثری ندارد.
  assert.equal(capped.total, pluginPrice("booking") + pluginPrice("crm"));
});

test("quotePluginAddons: بدون سقف مشخص، همه‌ی رایگان‌ها می‌مانند (پیش‌فرض قدیمی دست‌نخورده)", () => {
  const addons = quotePluginAddons(FREE_PLUGIN_IDS);
  assert.deepEqual(addons.droppedFreePluginIds, []);
  assert.equal(addons.plugins.length, FREE_PLUGIN_IDS.length);
});

test("resolvePurchasePrice: پکیجِ آماده بیش از سقفِ پلاگین رایگانش را قبول نمی‌کند", () => {
  // استاندارد سقفش ۳ است — اینجا ۵ تا رایگان انتخاب شده.
  const resolved = resolvePurchasePrice({
    buildSpec: { tierId: "standard", pluginIds: [...FREE_PLUGIN_IDS, "freeplug-e"] },
  });
  assert.equal(resolved.source, "tier");
  assert.equal(resolved.pluginIds.length, BOT_TIER_MAX_FREE_PLUGINS.standard);
  assert.equal(resolved.droppedFreePluginIds.length, 5 - BOT_TIER_MAX_FREE_PLUGINS.standard);
  // پلاگین‌های رایگانِ مازاد قیمتی ندارند، پس مبلغ فقط قیمت پکیج می‌ماند —
  // نه اینکه رایگان‌های اضافه پولی حساب شوند و نه اینکه رایگان بمانند.
  assert.equal(resolved.total, BOT_TIER_PRICES.standard);
});

test("resolvePurchasePrice: پلاگین پولی هرگز جزو سقفِ رایگان پکیج حساب نمی‌شود", () => {
  // پرو سقفش ۱۰ رایگان است؛ اینجا ۱۰ رایگان + یک پولی انتخاب شده — پولی
  // نباید به‌خاطر پر بودن سهمیه‌ی رایگان کنار گذاشته شود.
  const tenFree = Array.from({ length: BOT_TIER_MAX_FREE_PLUGINS.pro }, (_, i) => `freeplug-${i}`);
  const resolved = resolvePurchasePrice({
    buildSpec: { tierId: "pro", pluginIds: [...tenFree, "booking"] },
  });
  assert.deepEqual(resolved.droppedFreePluginIds, []);
  assert.ok(resolved.pluginIds.includes("booking"));
  assert.equal(resolved.total, BOT_TIER_PRICES.pro + pluginPrice("booking"));
});

test("resolvePurchasePrice: بات سفارشی سقفِ پلاگین رایگان ندارد", () => {
  // «سفارشی» عمداً از این سقف مستثناست — قبلاً هم تست‌های بالا با بات سفارشی
  // چند پلاگین پولی جمع می‌زدند بدون هیچ محدودیتی؛ اینجا با رایگان هم همینه.
  const resolved = resolvePurchasePrice({
    buildSpec: { tierId: "custom", ramGb: 1, cpuCores: 1, pluginIds: FREE_PLUGIN_IDS },
  });
  assert.equal(resolved.pluginIds.length, FREE_PLUGIN_IDS.length);
});

// ─── محافظ drift بین سرور و فرانت ───────────────────────────────────────────

test("قیمت پکیج‌های آماده در سرور و فرانت یکی است", () => {
  // سرور برای محاسبه‌ی مبلغ از BOT_TIER_PRICES استفاده می‌کند و فرانت برای
  // نمایش از bot-tiers.ts. اگر از هم فاصله بگیرند، کاربر یک عدد می‌بیند و عدد
  // دیگری پرداخت می‌کند.
  const source = fs.readFileSync(
    new URL("../../irforge/src/lib/bot-tiers.ts", import.meta.url),
    "utf8",
  );

  for (const [tierId, serverPrice] of Object.entries(BOT_TIER_PRICES)) {
    const block = source.split(`id: "${tierId}"`)[1];
    assert.ok(block, `پکیج ${tierId} در bot-tiers.ts پیدا نشد`);
    const match = block.match(/price:\s*(\d+)/);
    assert.ok(match, `قیمت ${tierId} در bot-tiers.ts پیدا نشد`);
    assert.equal(
      Number(match[1]), serverPrice,
      `قیمت «${tierId}» در فرانت (${match[1]}) با سرور (${serverPrice}) یکی نیست`,
    );
  }
});

test("سقفِ پلاگین رایگان در سرور و فرانت یکی است", () => {
  // همان محافظِ drift بالا، این‌بار برای `maxPlugins` هر پکیج در bot-tiers.ts.
  const source = fs.readFileSync(
    new URL("../../irforge/src/lib/bot-tiers.ts", import.meta.url),
    "utf8",
  );

  for (const [tierId, serverMax] of Object.entries(BOT_TIER_MAX_FREE_PLUGINS)) {
    const block = source.split(`id: "${tierId}"`)[1];
    assert.ok(block, `پکیج ${tierId} در bot-tiers.ts پیدا نشد`);
    const match = block.match(/maxPlugins:\s*(\d+)/);
    assert.ok(match, `maxPlugins برای ${tierId} در bot-tiers.ts پیدا نشد`);
    assert.equal(
      Number(match[1]), serverMax,
      `سقفِ پلاگینِ رایگانِ «${tierId}» در فرانت (${match[1]}) با سرور (${serverMax}) یکی نیست`,
    );
  }
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
