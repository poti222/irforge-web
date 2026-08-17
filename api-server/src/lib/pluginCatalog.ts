/**
 * lib/pluginCatalog.ts — کاتالوگ پلاگین‌ها، با یک منبع حقیقت.
 * ─────────────────────────────────────────────────────────────────────────────
 * مشکلی که این فایل حل می‌کند
 *
 * مانیفست هر پلاگین در بات تعریف می‌شود (`mainbot/plugins/<id>/plugin.py`،
 * `PLUGIN_MANIFEST`). سایت پایتون import نمی‌کند، پس تا امروز یک کپی **دستی**
 * از همان مانیفست‌ها در دو جای این ریپو نگه داشته می‌شد:
 *
 *   - `routes/botPlugins.ts` → آرایه‌ی `PLUGIN_CATALOG` (نام، توضیح، نسخه، شیت‌ها)
 *   - `lib/pluginGate.ts`    → نقشه‌های `DEFAULT_ENABLED` و `PLUGIN_LABEL`
 *
 * کامنت خودِ آن فایل هم می‌گفت «هر پلاگین جدید در بات باید اینجا هم اضافه
 * شود». نتیجه‌ی قابل پیش‌بینی: یک پلاگین تازه در بات، در سایت وجود نداشت —
 * نه در فهرست پلاگین‌ها دیده می‌شد و نه سکشن مربوطه‌اش باز می‌شد.
 *
 * راه‌حل
 *
 * بات موقع startup کاتالوگ کامل خودش را روی تب `plugin_catalog` **اسپردشیت
 * رجیستری** می‌نویسد (`mainbot/services/plugin_catalog_publisher.py`). هر دو
 * سرویس همان اسپردشیت را با `REGISTRY_SPREADSHEET_ID` می‌شناسند، پس این یک
 * کانال مشترکِ موجود است، نه یک وابستگی تازه. این ماژول همان را می‌خواند و
 * کش می‌کند.
 *
 * چرا شیت و نه یک HTTP endpoint روی بات: آن سرویس یک پروسه‌ی polling خالص
 * است (`python main.py`) و هیچ پورتی expose نمی‌کند؛ دادن endpoint به آن یعنی
 * وب‌سرور + دامنه‌ی عمومی + secret مشترک، که هیچ‌کدام امروز وجود ندارند.
 *
 * ⚠️ **fallback حتماً لازم است.** اگر رجیستری تنظیم نشده باشد، یا بات هنوز
 * یک بار بالا نیامده باشد که کاتالوگ را بنویسد، سایت نباید یک فهرست خالی
 * نشان دهد («هیچ پلاگینی وجود ندارد» یک دروغ است). در آن حالت `BASELINE`
 * زیر استفاده می‌شود: همان چهار پلاگینی که قبل از این تغییر هاردکد بودند.
 * تازه‌ها عمداً در BASELINE نیستند — یک فهرستِ کاملِ دستی دوباره همان مشکل
 * قبلی بود؛ BASELINE فقط یک تور نجات است تا سایت بدون بات هم کار کند.
 */
import { readTabRows } from "./tenantSheets.js";
import { registrySheetId } from "./sheetsSync.js";
import { logger } from "./logger.js";

export const CATALOG_TAB = "plugin_catalog";
const META_KEY = "__meta__";

/** مدت اعتبار کش. کاتالوگ از کدِ بات می‌آید، پس بین دو دیپلوی عوض نمی‌شود. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export type PluginManifest = {
  id: string;
  name: string;
  name_fa: string;
  /** انگلیسی. */
  description: string;
  /** فارسی. خالی یعنی مانیفست فقط یک زبان دارد و UI به `description` می‌افتد. */
  description_fa: string;
  version: string;
  author?: string;
  required_sheets: string[];
  permissions: string[];
  default_enabled: boolean;
  dependencies?: string[];
  events?: string[];
  /** کلید سکشنی در workspace که این پلاگین بازش می‌کند (از خود مانیفست). */
  web_section?: string;
};

/**
 * تور نجات: وضعیت پیش از این تغییر. فقط وقتی استفاده می‌شود که کاتالوگ
 * منتشرشده در دسترس نباشد.
 */
const BASELINE: PluginManifest[] = [
  {
    id: "catalog",
    name: "Catalog",
    name_fa: "فروشگاه / کاتالوگ",
    description: "Sell a product or service with categories, pricing, options and a full purchase flow.",
    description_fa: "فروش محصول یا خدمت با دسته‌بندی، قیمت‌گذاری، گزینه‌ها و فرایند خرید کامل.",
    version: "0.6.0",
    required_sheets: ["catalog_categories", "catalog_items", "catalog_item_options", "catalog_fulfillments"],
    permissions: ["catalog.view", "catalog.manage"],
    default_enabled: false,
  },
  {
    id: "discount",
    name: "Discount",
    name_fa: "کد تخفیف",
    description: "Coupon and discount codes for orders.",
    description_fa: "کدهای تخفیف و کوپن برای سفارش‌ها.",
    version: "1.0.0",
    required_sheets: ["discounts"],
    permissions: ["discounts.view", "discounts.create", "discounts.delete"],
    default_enabled: false,
  },
  {
    id: "referral",
    name: "Referral",
    name_fa: "سیستم رفرال",
    description: "Referral links with tracking and rewards.",
    description_fa: "لینک دعوت با ردیابی و پاداش.",
    version: "1.0.0",
    required_sheets: ["referrals"],
    permissions: ["referral.view", "referral.manage"],
    default_enabled: false,
  },
  {
    id: "wallet",
    name: "Wallet",
    name_fa: "کیف پول",
    description: "Per-user wallet with transaction history, manual top-up/withdrawal and order integration.",
    description_fa: "کیف پول هر کاربر با تاریخچه‌ی تراکنش، شارژ/برداشت دستی و اتصال به سفارش‌ها.",
    version: "1.3.0",
    required_sheets: ["wallets"],
    permissions: ["wallet.view", "wallet.manage"],
    default_enabled: false,
  },
];

type CacheEntry = { at: number; plugins: PluginManifest[]; published: boolean };
let cache: CacheEntry | null = null;

/** فقط برای تست‌ها — تا یک تست، کشِ تست قبلی را نبیند. */
export function resetPluginCatalogCacheForTests(): void {
  cache = null;
}

/** seam تست: تست‌ها این را `Object.assign` می‌کنند تا بدون گوگل اجرا شوند. */
export const catalogSheetLayer = { readTabRows };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * یک ردیف خامِ شیت → مانیفست.
 *
 * هر فیلدِ گم‌شده مقدار پیش‌فرضِ بی‌خطر می‌گیرد، و ردیفی که حتی `id` ندارد
 * کاملاً رد می‌شود: یک سلولِ دستی‌خراب‌شده روی شیت نباید کل فهرست پلاگین‌های
 * سایت را از کار بیندازد.
 */
function parseManifest(key: string, raw: unknown): PluginManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id ? row.id : key;
  if (!id) return null;

  const manifest: PluginManifest = {
    id,
    name: typeof row.name === "string" ? row.name : id,
    name_fa: typeof row.name_fa === "string" ? row.name_fa : (typeof row.name === "string" ? row.name : id),
    description: typeof row.description === "string" ? row.description : "",
    description_fa: typeof row.description_fa === "string" ? row.description_fa : "",
    version: typeof row.version === "string" ? row.version : "",
    required_sheets: isStringArray(row.required_sheets) ? row.required_sheets : [],
    permissions: isStringArray(row.permissions) ? row.permissions : [],
    default_enabled: Boolean(row.default_enabled),
  };
  if (typeof row.author === "string") manifest.author = row.author;
  if (isStringArray(row.dependencies)) manifest.dependencies = row.dependencies;
  if (isStringArray(row.events)) manifest.events = row.events;
  if (typeof row.web_section === "string" && row.web_section) manifest.web_section = row.web_section;
  return manifest;
}

/**
 * کاتالوگ پلاگین‌ها.
 *
 * `published` می‌گوید این از بات آمده یا از BASELINE — روت‌ها آن را به کلاینت
 * می‌دهند تا UI بتواند صادق باشد («فهرست ممکن است کامل نباشد») به‌جای اینکه
 * یک فهرست ناقص را قطعی جا بزند.
 *
 * **هرگز throw نمی‌کند.** خطای شیت → BASELINE، نه ۵۰۰.
 */
export async function getPluginCatalog(): Promise<{ plugins: PluginManifest[]; published: boolean }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { plugins: cache.plugins, published: cache.published };
  }

  const spreadsheetId = registrySheetId();
  if (!spreadsheetId) {
    logger.debug("pluginCatalog: REGISTRY_SPREADSHEET_ID تنظیم نشده؛ BASELINE استفاده شد");
    cache = { at: Date.now(), plugins: BASELINE, published: false };
    return { plugins: BASELINE, published: false };
  }

  try {
    const rows = await catalogSheetLayer.readTabRows(spreadsheetId, CATALOG_TAB);
    const plugins: PluginManifest[] = [];
    for (const row of rows) {
      if (row.key === META_KEY) continue;
      const manifest = parseManifest(row.key, row.value);
      if (manifest) plugins.push(manifest);
    }

    if (plugins.length === 0) {
      // تب هست ولی خالی است — بات هنوز یک بار بالا نیامده. این «صفر پلاگین»
      // نیست، «هنوز نمی‌دانیم» است.
      logger.info("pluginCatalog: تب plugin_catalog خالی است؛ BASELINE استفاده شد");
      cache = { at: Date.now(), plugins: BASELINE, published: false };
      return { plugins: BASELINE, published: false };
    }

    plugins.sort((a, b) => a.id.localeCompare(b.id));
    cache = { at: Date.now(), plugins, published: true };
    return { plugins, published: true };
  } catch (err) {
    logger.warn({ err }, "pluginCatalog: خواندن کاتالوگ منتشرشده شکست خورد؛ BASELINE استفاده شد");
    // کشِ کوتاه‌تر روی خطا: نمی‌خواهیم یک خطای گذرای گوگل، پنج دقیقه سایت را
    // روی BASELINE قفل کند.
    cache = { at: Date.now() - (CACHE_TTL_MS - 30_000), plugins: BASELINE, published: false };
    return { plugins: BASELINE, published: false };
  }
}

/** یک پلاگین با id — یا null. */
export async function getPluginManifest(pluginId: string): Promise<PluginManifest | null> {
  const { plugins } = await getPluginCatalog();
  return plugins.find((p) => p.id === pluginId) ?? null;
}

/** `default_enabled` هر پلاگین — همان چیزی که بات وقتی وضعیت صریحی نیست می‌خواند. */
export async function defaultEnabledMap(): Promise<Record<string, boolean>> {
  const { plugins } = await getPluginCatalog();
  const out: Record<string, boolean> = {};
  for (const plugin of plugins) out[plugin.id] = plugin.default_enabled;
  return out;
}

/** نام فارسی هر پلاگین، برای پیام خطا. */
export async function pluginLabel(pluginId: string): Promise<string> {
  const manifest = await getPluginManifest(pluginId);
  return manifest?.name_fa || manifest?.name || pluginId;
}
