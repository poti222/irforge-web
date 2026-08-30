/**
 * lib/pluginPricing.ts — قیمت پلاگین‌ها و قیمت‌گذاری بات سفارشی.
 * ─────────────────────────────────────────────────────────────────────────────
 * **این فایل تنها منبع قیمت است.** نه فرانت، نه سبد خرید، نه هیچ‌جای دیگر
 * نباید عددی از خودش دربیاورد.
 *
 * چرا این‌قدر تأکید: `POST /bots/wallet-purchase` تا امروز `amount` را از
 * **کلاینت** می‌گرفت و همان را از کیف پول کم می‌کرد (کامنت خودش هم می‌گوید
 * «هرچه checkout بفرستد»). با یک قیمت ثابتِ پکیج، این حداکثر یک ایراد بود؛
 * با بات سفارشی که قیمتش به رم و پردازنده و فهرست پلاگین‌های انتخابی بستگی
 * دارد، تکیه بر عدد کلاینت یعنی هر کسی می‌تواند بات کامل را با مبلغ صفر
 * بخرد. پس همین‌جا محاسبه می‌شود و روت خرید از `quoteCustomBuild` می‌پرسد،
 * نه از بدنه‌ی درخواست.
 *
 * قیمت جزو مانیفست بات نیست و نباید باشد: مانیفست می‌گوید پلاگین **چه کار
 * می‌کند** (و در بات تعریف می‌شود)، قیمت یک تصمیم تجاریِ سایت است. اگر قیمت
 * در مانیفست بود، هر تغییر قیمت یک دیپلوی بات لازم داشت.
 *
 * پلاگینی که در جدول زیر نباشد **رایگان** حساب می‌شود، نه اینکه غیرقابل
 * فروش. پس یک پلاگین تازه در بات، بدون قیمت‌گذاری هم در سایت کار می‌کند و
 * فقط رایگان است — که رفتار بی‌خطرتری از «قابل خرید نیست» است.
 */

/** ریال؟ نه — تومان، همان واحدی که کل سایت با `formatToman` نشان می‌دهد. */
export type Toman = number;

/**
 * قیمت هر پلاگین.
 *
 * منطق سطح‌بندی: پلاگینی که یک کسب‌وکار را می‌گرداند (فروش، پول، عضویت،
 * نوبت) گران‌تر است؛ پلاگینی که یک قابلیت جانبیِ خوش‌آیند است ارزان.
 * قرعه‌کشی و نظرسنجی عمداً کم‌قیمت‌اند — بیشتر ابزار تعامل‌اند تا زیرساخت
 * درآمد.
 */
export const PLUGIN_PRICES: Record<string, Toman> = {
  // ── زیرساخت درآمد: بدون این‌ها بات نمی‌فروشد ──
  catalog:      150_000,
  subscription: 130_000,
  booking:      130_000,
  membership:   120_000,
  wallet:       120_000,
  invoice:      110_000,

  // ── هوش مصنوعی — امکانِ گران به‌خاطر هزینه‌ی خودِ سرویس ──
  ai_assist:    140_000,

  // ── عملیات و نگه‌داشت مشتری ──
  ticket:         90_000,
  affiliate:      90_000,
  analytics:      85_000,
  loyalty:        80_000,
  // با کلیدِ خودِ صاحبِ بات (BYOK، مثلِ ai_assist)، پس هزینه‌ی واقعیِ Google
  // Translate روی خودِ اوست — قیمتِ این پلاگین صرفاً بابتِ خودِ قابلیت است.
  translate_post: 75_000,
  autoposter:     65_000,
  crm:            70_000,
  drip:           70_000,
  inventory:      70_000,
  events:         70_000,
  group_tools:    55_000,
  address:        50_000,

  // ── جانبی و ارزان ──
  gamification:  40_000,
  forms_pro:     40_000,
  discount:      35_000,
  referral:      35_000,
  files:         30_000,
  waitlist:      30_000,
  giveaway:      25_000,
  survey:        25_000,
  feedback:      25_000,
};

export function pluginPrice(pluginId: string): Toman {
  return PLUGIN_PRICES[pluginId] ?? 0;
}

export function isPluginFree(pluginId: string): boolean {
  return pluginPrice(pluginId) <= 0;
}

// ─── بات سفارشی ─────────────────────────────────────────────────────────────

/**
 * قیمت‌گذاری بات سفارشی.
 *
 * تا امروز صفحه‌ی سفارشی می‌گفت «قیمت‌گذاری پکیج سفارشی به‌زودی اضافه می‌شود»
 * و با مبلغ صفر به سبد می‌رفت. این اعداد آن را واقعی می‌کنند: یک پایه، به‌علاوه‌ی
 * منابعِ بیشتر از حدِ پایه، به‌علاوه‌ی پلاگین‌های انتخابی.
 *
 * پایه با نقره‌ای (۱۵۰٬۰۰۰ با ۱ گیگ/۱ هسته) هم‌تراز است تا سفارشیِ حداقلی
 * ارزان‌تر از پکیج آماده درنیاید — وگرنه پکیج‌ها بی‌معنی می‌شدند.
 */
export const CUSTOM_BUILD = {
  basePrice:        500_000 as Toman,
  /** رم و هسته‌ای که در قیمت پایه هست؛ مازادش حساب می‌شود. */
  includedRamGb:    1,
  includedCpuCores: 1,
  pricePerRamGb:    60_000 as Toman,
  pricePerCpuCore:  50_000 as Toman,
  /** سقف خودسرویس — بالاتر از این، پلنِ سفارشیِ ادمین است. */
  maxRamGb:         8,
  maxCpuCores:      8,
} as const;

export type CustomBuildSpec = {
  ramGb: number;
  cpuCores: number;
  pluginIds: string[];
};

export type CustomBuildQuote = {
  base: Toman;
  ramGb: number;
  cpuCores: number;
  extraRamGb: number;
  extraCpuCores: number;
  resources: Toman;
  plugins: Array<{ id: string; price: Toman }>;
  pluginsTotal: Toman;
  total: Toman;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * قیمت یک بات سفارشی.
 *
 * ورودی از کلاینت می‌آید، پس همه‌چیز clamp می‌شود: رم/هسته در بازه‌ی مجاز، و
 * فهرست پلاگین‌ها یکتا (تکرار یک پلاگین نباید دو بار حساب شود). پلاگین ناشناخته
 * قیمت صفر می‌گیرد، پس فرستادن یک id الکی چیزی به کسی نمی‌دهد.
 *
 * `knownPlugins` اگر داده شود، فهرست مجاز است — پلاگینی که در کاتالوگ منتشرشده
 * نیست کاملاً کنار گذاشته می‌شود تا کسی نتواند با یک id ساختگی، بعداً ادعای
 * نصب کند.
 */
export function quoteCustomBuild(
  spec: Partial<CustomBuildSpec>,
  knownPlugins?: Iterable<string>,
): CustomBuildQuote {
  const ramGb = clampInt(spec.ramGb, 1, CUSTOM_BUILD.maxRamGb, CUSTOM_BUILD.includedRamGb);
  const cpuCores = clampInt(spec.cpuCores, 1, CUSTOM_BUILD.maxCpuCores, CUSTOM_BUILD.includedCpuCores);

  const allowed = knownPlugins ? new Set(knownPlugins) : null;
  const ids = [...new Set(Array.isArray(spec.pluginIds) ? spec.pluginIds.map(String) : [])]
    .filter((id) => (allowed ? allowed.has(id) : true));

  const extraRamGb = Math.max(0, ramGb - CUSTOM_BUILD.includedRamGb);
  const extraCpuCores = Math.max(0, cpuCores - CUSTOM_BUILD.includedCpuCores);
  const resources =
    extraRamGb * CUSTOM_BUILD.pricePerRamGb + extraCpuCores * CUSTOM_BUILD.pricePerCpuCore;

  const plugins = ids.map((id) => ({ id, price: pluginPrice(id) }));
  const pluginsTotal = plugins.reduce((sum, p) => sum + p.price, 0);

  return {
    base: CUSTOM_BUILD.basePrice,
    ramGb,
    cpuCores,
    extraRamGb,
    extraCpuCores,
    resources,
    plugins,
    pluginsTotal,
    total: CUSTOM_BUILD.basePrice + resources + pluginsTotal,
  };
}

/**
 * قیمت پلاگین‌های انتخاب‌شده روی یک پکیج *آماده* (نقره‌ای/طلایی/الماسی).
 *
 * پکیج آماده قیمت ثابت دارد و منابعش هم ثابت است، پس فقط پلاگین‌ها به آن
 * اضافه می‌شوند.
 */
/**
 * سقفِ تعداد پلاگینی که هنگام خرید روی هر پکیجِ آماده *رایگان* حساب می‌شود —
 * آینه‌ی `maxPlugins` در `irforge/src/lib/bot-tiers.ts` (همان الگوی
 * `BOT_TIER_PRICES` بالا؛ تست drift پایین همین فایل برابری‌شان را چک می‌کند).
 *
 * **همه‌ی پلاگین‌ها پولی‌اند** (جدولِ بالا) — این سقف دیگر «چند تا از
 * پلاگین‌های رایگان را می‌شود برداشت» نیست، بلکه «کدام‌ها را از میان
 * پولی‌ها به انتخابِ خودت رایگان حساب کنیم»: کاربر هر تعداد پلاگین که
 * بخواهد انتخاب می‌کند، و از میانشان تا همین سقف (به ترتیبِ همان انتخاب)
 * رایگان می‌شوند؛ باقی به قیمتِ خودشان اضافه می‌شوند. برخلافِ رفتارِ قبلی،
 * دیگر چیزی «کنار گذاشته» نمی‌شود — هرچه انتخاب شود نصب می‌شود، فقط بعضی
 * رایگان و بعضی پولی. «سفارشی» عمداً اینجا نیست: بات سفارشی سقفی برای
 * تعداد پلاگین ندارد (خودِ `bot-tiers.ts` هم چنین فیلدی برایش تعریف نکرده).
 */
export const BOT_TIER_MAX_FREE_PLUGINS: Record<string, number> = {
  standard: 3,
  pro:      6,
};

export function quotePluginAddons(
  pluginIds: unknown,
  knownPlugins?: Iterable<string>,
  maxFreePlugins: number = Infinity,
): { plugins: Array<{ id: string; price: Toman }>; total: Toman; droppedFreePluginIds: string[] } {
  const allowed = knownPlugins ? new Set(knownPlugins) : null;
  const ids = [...new Set(Array.isArray(pluginIds) ? pluginIds.map(String) : [])]
    .filter((id) => (allowed ? allowed.has(id) : true));

  // پلاگینی که خودش ذاتاً رایگان است (در جدولِ قیمت نیست — مثلاً پلاگینِ
  // تازه‌ای در بات که هنوز قیمت‌گذاری نشده) همیشه رایگان می‌ماند و از سهمیه‌ی
  // زیر چیزی کم نمی‌کند؛ آن سهمیه فقط برای پلاگین‌های واقعاً پولی است.
  const intrinsicallyFreeIds = ids.filter((id) => pluginPrice(id) <= 0);
  const paidIds = ids.filter((id) => pluginPrice(id) > 0);

  // اولین N تای پولی‌ها — به همان ترتیبی که کاربر انتخاب کرده — رایگان
  // حساب می‌شوند؛ مازاد به قیمتِ خودش اضافه می‌شود. هیچ‌کدام کنار گذاشته
  // نمی‌شود، پس `droppedFreePluginIds` در این مدل همیشه خالی است — فیلد را
  // برای سازگاریِ عقب‌رو (call siteهای موجود) نگه داشته‌ایم.
  const freeQuotaIds = new Set(paidIds.slice(0, Math.max(0, maxFreePlugins)));

  const plugins = [
    ...intrinsicallyFreeIds.map((id) => ({ id, price: 0 })),
    ...paidIds.map((id) => ({ id, price: freeQuotaIds.has(id) ? 0 : pluginPrice(id) })),
  ];
  return {
    plugins,
    total: plugins.reduce((sum, p) => sum + p.price, 0),
    droppedFreePluginIds: [],
  };
}

// ─── پکیج‌های آماده ─────────────────────────────────────────────────────────

/**
 * قیمت پکیج‌های آماده.
 *
 * آینه‌ی `price` در `irforge/src/lib/bot-tiers.ts` — که بقیه‌ی محتوای نمایشیِ
 * پکیج (امکانات، آیکون، شرح) را نگه می‌دارد و باید همان‌جا بماند. فقط عدد
 * قیمت اینجا هم لازم است، چون *سرور* باید بتواند مبلغ را حساب کند و نه
 * کلاینت. تست `pluginPricing.test.mjs` برابری این دو را چک می‌کند، پس عوض
 * کردن یکی بدون دیگری تست را می‌شکند.
 */
export const BOT_TIER_PRICES: Record<string, Toman> = {
  standard: 500_000,
  pro:      1_100_000,
};

/** مشخصات ساختی که کلاینت همراه خرید می‌فرستد. */
export type BuildSpec = {
  tierId?: string;
  ramGb?: number;
  cpuCores?: number;
  pluginIds?: string[];
};

export type ResolvedPrice = {
  total: Toman;
  /** از کجا آمد — برای لاگ و برای اینکه رفتار قابل توضیح باشد. */
  source: "custom-build" | "tier" | "client-amount";
  pluginIds: string[];
  /** میراثِ مدلِ قبلی (سقفِ پلاگینِ رایگان) — در مدلِ تازه چیزی کنار گذاشته نمی‌شود، پس همیشه خالی است. */
  droppedFreePluginIds?: string[];
  breakdown?: CustomBuildQuote | { tier: Toman; plugins: Toman };
};

/**
 * مبلغ قابل پرداختِ یک خرید بات — **از سرور، نه از بدنه‌ی درخواست.**
 *
 * `POST /bots/wallet-purchase` تا امروز `amount` کلاینت را کم می‌کرد. با
 * پکیج ثابت این یک ایراد بود؛ با بات سفارشی و افزودنِ پلاگین‌های قیمت‌دار،
 * یعنی هر کسی می‌توانست همه‌چیز را با صفر بخرد. پس:
 *
 *   - اگر `buildSpec.tierId === "custom"` → کامل از `quoteCustomBuild`.
 *   - اگر `tierId` یک پکیج شناخته‌شده باشد → قیمت پکیج + پلاگین‌های انتخابی.
 *   - وگرنه → همان `amount` کلاینت (مسیر قدیمی، دست‌نخورده).
 *
 * مسیر سوم عمداً حفظ شده: خریدهایی که از جای دیگری (بدون spec) می‌آیند نباید
 * با این تغییر بشکنند. ولی هر مسیری که این فاز اضافه می‌کند spec می‌فرستد،
 * پس در عمل قیمتش سروری است.
 */
export function resolvePurchasePrice(
  body: { amount?: unknown; buildSpec?: BuildSpec | null },
  knownPlugins?: Iterable<string>,
): ResolvedPrice {
  const spec = body.buildSpec;

  if (spec && spec.tierId === "custom") {
    const quote = quoteCustomBuild(spec, knownPlugins);
    return {
      total: quote.total,
      source: "custom-build",
      pluginIds: quote.plugins.map((p) => p.id),
      breakdown: quote,
    };
  }

  if (spec && spec.tierId && spec.tierId in BOT_TIER_PRICES) {
    const tier = BOT_TIER_PRICES[spec.tierId];
    const maxFreePlugins = BOT_TIER_MAX_FREE_PLUGINS[spec.tierId] ?? Infinity;
    const addons = quotePluginAddons(spec.pluginIds, knownPlugins, maxFreePlugins);
    return {
      total: tier + addons.total,
      source: "tier",
      pluginIds: addons.plugins.map((p) => p.id),
      droppedFreePluginIds: addons.droppedFreePluginIds,
      breakdown: { tier, plugins: addons.total },
    };
  }

  return {
    total: Math.max(0, Number(body.amount) || 0),
    source: "client-amount",
    pluginIds: [],
  };
}
