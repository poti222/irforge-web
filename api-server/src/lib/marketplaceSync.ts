/**
 * lib/marketplaceSync.ts — پلاگین‌های بات را به آیتم مارکت‌پلیس تبدیل می‌کند.
 * ─────────────────────────────────────────────────────────────────────────────
 * جدول `marketplace_items` وجود داشت ولی **هیچ‌جا پر نمی‌شد** — نه seed ای، نه
 * migration ای، نه روتی برای ساختنش. یعنی صفحه‌ی مارکت‌پلیس و بخش «افزودن
 * پلاگین» همیشه خالی بودند و `POST /bots/:botId/plugins` هم همیشه
 * «Marketplace item not found» می‌داد، چون آیتمی وجود نداشت که خریده شود.
 *
 * این ماژول آن شکاف را پر می‌کند: هر پلاگینِ کاتالوگ منتشرشده‌ی بات
 * (`lib/pluginCatalog.ts`) یک ردیف مارکت‌پلیس می‌شود، با قیمتی از
 * `lib/pluginPricing.ts`.
 *
 * شناسه‌ی آیتم عمداً `plugin-<pluginId>` است و نه یک UUID
 * ─────────────────────────────────────────────────────────
 * قبلاً `routes/botPlugins.ts` برای فهمیدن «این پلاگین خریده شده یا نه» اسم را
 * مقایسه می‌کرد (`installed_plugins.name` با `manifest.id` یا `manifest.name`).
 * یعنی عوض‌شدن نمایشیِ اسم یک پلاگین، خریدِ ثبت‌شده را بی‌صاحب می‌کرد. با
 * شناسه‌ی مشتق‌شده از plugin_id، پیوند خرید↔پلاگین ساختاری است نه حدسی.
 *
 * idempotent است: هر بار اجرا، ردیف موجود را با قیمت/نسخه/توضیح تازه آپدیت
 * می‌کند و ردیف نبوده را می‌سازد. `installCount` و `rating` **دست‌نخورده**
 * می‌مانند — آن‌ها داده‌ی واقعیِ سایت‌اند، نه چیزی که از مانیفست بیاید.
 */
import { db, marketplaceItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPluginCatalog, type PluginManifest } from "./pluginCatalog.js";
import { pluginPrice } from "./pluginPricing.js";
import { logger } from "./logger.js";

export const PLUGIN_ITEM_PREFIX = "plugin-";
export const PLUGIN_CATEGORY = "plugin";

/** شناسه‌ی آیتم مارکت‌پلیس یک پلاگین. */
export function marketplaceItemIdFor(pluginId: string): string {
  return `${PLUGIN_ITEM_PREFIX}${pluginId}`;
}

/** عکسِ تابع بالا — `null` اگر این آیتم مال پلاگین نباشد. */
export function pluginIdFromItemId(itemId: string | null | undefined): string | null {
  if (!itemId || !itemId.startsWith(PLUGIN_ITEM_PREFIX)) return null;
  const pluginId = itemId.slice(PLUGIN_ITEM_PREFIX.length);
  return pluginId || null;
}

/** برچسب‌های آیتم — برای جست‌وجو و فیلتر در مارکت‌پلیس. */
function tagsFor(manifest: PluginManifest): string[] {
  const tags = [manifest.id];
  if (manifest.web_section) tags.push(manifest.web_section);
  if (pluginPrice(manifest.id) <= 0) tags.push("free");
  return tags;
}

let lastSyncAt = 0;
/** فاصله‌ی حداقلِ دو sync. کاتالوگ از کد بات می‌آید و بین دیپلوی‌ها ثابت است. */
const SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** فقط برای تست‌ها. */
export function resetMarketplaceSyncForTests(): void {
  lastSyncAt = 0;
}

export type SyncResult = { created: number; updated: number; skipped: number };

/**
 * کاتالوگ پلاگین‌ها → ردیف‌های `marketplace_items`.
 *
 * **هرگز throw نمی‌کند.** این تابع روی مسیر خواندنِ مارکت‌پلیس صدا زده می‌شود؛
 * یک خطای گذرا نباید صفحه‌ی مارکت‌پلیس را ۵۰۰ کند — در بدترین حالت فهرست
 * همان چیزی می‌ماند که از قبل در جدول بود.
 */
export async function syncPluginMarketplaceItems(): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0 };

  let catalog: Awaited<ReturnType<typeof getPluginCatalog>>;
  try {
    catalog = await getPluginCatalog();
  } catch (err) {
    logger.warn({ err }, "marketplaceSync: خواندن کاتالوگ شکست خورد");
    return result;
  }

  // کاتالوگِ fallback را sync نمی‌کنیم. آن فهرست ناقص است (فقط چهار پلاگین
  // قدیمی) و نوشتنش روی جدول یعنی قیمت‌گذاریِ ناقص را به‌عنوان حقیقت ثبت
  // کرده‌ایم — بعدش هم معلوم نیست کدام ردیف واقعی بوده و کدام حدس.
  if (!catalog.published) {
    logger.debug("marketplaceSync: کاتالوگ منتشرشده در دسترس نیست؛ sync رد شد");
    result.skipped = catalog.plugins.length;
    return result;
  }

  for (const manifest of catalog.plugins) {
    const id = marketplaceItemIdFor(manifest.id);
    const price = pluginPrice(manifest.id);
    const values = {
      name: manifest.name_fa || manifest.name || manifest.id,
      description: manifest.description || "",
      category: PLUGIN_CATEGORY,
      price,
      isFree: price <= 0,
      author: manifest.author || "IrForge",
      version: manifest.version || "1.0.0",
      tags: tagsFor(manifest),
      icon: manifest.web_section ?? null,
    };

    try {
      const [existing] = await db
        .select({ id: marketplaceItemsTable.id })
        .from(marketplaceItemsTable)
        .where(eq(marketplaceItemsTable.id, id))
        .limit(1);

      if (existing) {
        // عمداً `installCount`/`rating`/`featured` ست نمی‌شوند: آن‌ها داده‌ی
        // خودِ سایت‌اند و یک sync نباید صفرشان کند.
        await db.update(marketplaceItemsTable).set(values).where(eq(marketplaceItemsTable.id, id));
        result.updated += 1;
      } else {
        await db.insert(marketplaceItemsTable).values({ id, ...values });
        result.created += 1;
      }
    } catch (err) {
      logger.warn({ err, pluginId: manifest.id }, "marketplaceSync: ردیف این پلاگین ذخیره نشد");
      result.skipped += 1;
    }
  }

  if (result.created || result.updated) {
    logger.info(
      { created: result.created, updated: result.updated },
      "marketplaceSync: آیتم‌های پلاگین هم‌گام شدند",
    );
  }
  return result;
}

/**
 * نسخه‌ی TTL دار برای مسیرهای خواندن.
 *
 * مارکت‌پلیس ممکن است پرترافیک باشد و sync روی هر درخواست یعنی یک UPDATE
 * به‌ازای هر پلاگین به‌ازای هر بازدید. `force` برای روت super-admin است که
 * می‌خواهد همین حالا هم‌گام شود.
 */
export async function ensurePluginItemsSynced(force = false): Promise<SyncResult | null> {
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return null;
  // پیش از await ست می‌شود تا چند درخواست هم‌زمان، چند sync موازی راه نیندازند.
  lastSyncAt = Date.now();
  try {
    return await syncPluginMarketplaceItems();
  } catch (err) {
    logger.warn({ err }, "marketplaceSync: ensure شکست خورد");
    return null;
  }
}
