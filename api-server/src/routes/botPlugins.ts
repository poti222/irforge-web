/**
 * routes/botPlugins.ts — پلاگین‌ها، با منبع حقیقتِ درست برای هر چیز (باگ B14).
 * ─────────────────────────────────────────────────────────────────────────────
 * دو چیز جدا بودند و با یک اسم صدا زده می‌شدند:
 *
 *   - **خرید/نصب از مارکت‌پلیس** → جدول `installed_plugins` روی Postgres سایت.
 *     این واقعاً مال سایت است و همان‌جا می‌ماند.
 *   - **فعال/غیرفعال بودن روی خود بات** → کلید `__plugin_states__` داخل تب
 *     `bot_settings` (`utils/plugin_manager.py:34`). این تنها چیزی است که
 *     runtime بات می‌خواند.
 *
 * تا امروز سایت فقط اولی را می‌دید، پس «فعال» در سایت هیچ ربطی به «فعال» در بات
 * نداشت. حالا `GET` هر دو را کنار هم برمی‌گرداند و `PATCH` **فقط**
 * `__plugin_states__` را می‌نویسد.
 *
 * ⚠️ `is_enabled` بات: اگر یک plugin_id در `__plugin_states__` نباشد، از
 * `default_enabled` مانیفست استفاده می‌کند (خط ۱۵۸) — نه `false`. پس «وضعیت
 * تعیین‌نشده» با «غیرفعال» یکی نیست و کاتالوگ زیر همین را منعکس می‌کند.
 *
 * **کاتالوگ دیگر اینجا دستی نگه داشته نمی‌شود.** قبلاً یک آرایه‌ی
 * `PLUGIN_CATALOG` در همین فایل بود، با این کامنت: «سایت نمی‌تواند پایتون را
 * import کند، پس این لیست دستی نگه داشته می‌شود؛ هر پلاگین جدید در بات باید
 * اینجا هم اضافه شود.» و طبیعتاً نمی‌شد. حالا از `lib/pluginCatalog.ts` می‌آید
 * که کاتالوگ منتشرشده‌ی خودِ بات را می‌خواند.
 *
 * IRFORGE_PROMPT_V3 Phase 33 — دو چکِ سرورِ تازه در `PATCH`، قبل‌تر هیچ‌کدام
 * وجود نداشت:
 *   - پلاگینِ پولی: باید در `installed_plugins` خریده شده باشد. تا امروز فقط
 *     `PluginsManager.tsx` سمت کلاینت `purchased || isFree` را فیلتر می‌کرد؛
 *     یک `PATCH` دستی هر پلاگین پولی را بدون خرید روشن می‌کرد.
 *   - پلاگینِ رایگان: تعداد پلاگین‌های رایگانِ فعال روی این بات نباید از
 *     `maxPlugins` پلنِ صاحبِ بات (`lib/planLimits.ts`، از `plansTable`/
 *     `userPlansTable`) رد شود. پلاگین‌های پولی/خریداری‌شده هرگز جزو این
 *     سهمیه نیستند.
 */
import { Router } from "express";
import { db, installedPluginsTable, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { logger } from "../lib/logger.js";
import { getPluginCatalog } from "../lib/pluginCatalog.js";
import { marketplaceItemIdFor, ensurePluginItemsSynced } from "../lib/marketplaceSync.js";
import { pluginPrice } from "../lib/pluginPricing.js";
import { getUserPlanLimits } from "../lib/planLimits.js";
import {
  resolveBotSheet,
  getEntity,
  putEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";

const router = Router();
const SETTINGS_TAB = "bot_settings";
const PLUGIN_STATES_KEY = "__plugin_states__";

async function readStates(spreadsheetId: string): Promise<Record<string, boolean>> {
  const raw = await getEntity<Record<string, unknown>>(spreadsheetId, SETTINGS_TAB, PLUGIN_STATES_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) out[key] = Boolean(value);
  return out;
}

/**
 * همان تطبیقِ item_id↔اسم که در `GET /plugins` است — اینجا هم لازم است چون
 * `PATCH` باید قبل از `enabled: true` بداند این پلاگینِ پولی واقعاً خریده
 * شده یا نه (تا امروز این چک فقط سمت کلاینت بود، نگاه کن به `PluginsManager.tsx`).
 */
async function isPluginPurchased(botId: string, pluginId: string, manifestName?: string): Promise<boolean> {
  const itemId = marketplaceItemIdFor(pluginId);
  const purchased = await db
    .select()
    .from(installedPluginsTable)
    .where(eq(installedPluginsTable.botId, botId));
  return purchased.some(
    (p) =>
      p.marketplaceItemId === itemId ||
      p.name.toLowerCase() === pluginId ||
      (manifestName && p.name.toLowerCase() === manifestName.toLowerCase()),
  );
}

router.get("/bots/:botId/plugins", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const [states, catalog] = await Promise.all([
      readStates(spreadsheetId),
      getPluginCatalog(),
    ]);

    // تا آیتم‌های مارکت‌پلیس ساخته نشده باشند، دکمه‌ی خرید روی کارت پلاگین به
    // یک آیتم ناموجود اشاره می‌کرد و ۴۰۴ می‌گرفت.
    await ensurePluginItemsSynced();

    const purchased = await db
      .select()
      .from(installedPluginsTable)
      .where(eq(installedPluginsTable.botId, req.params.botId));

    // پیوند خرید↔پلاگین از روی `marketplace_item_id` (که `plugin-<id>` است)
    // برقرار می‌شود، نه از روی اسم. تطبیق اسمی — که قبلاً تنها راه بود — با
    // اولین تغییرِ نمایشیِ نام یک پلاگین، خریدِ ثبت‌شده را بی‌صاحب می‌کرد.
    const purchasedByItemId = new Map(purchased.map((p) => [p.marketplaceItemId, p]));
    // …ولی ردیف‌های قدیمی که پیش از این تغییر ثبت شده‌اند item_id درستی ندارند،
    // پس تطبیق اسمی به‌عنوان fallback می‌ماند تا خریدِ گذشته گم نشود.
    const purchasedByName = new Map(purchased.map((p) => [p.name.toLowerCase(), p]));

    const plugins = catalog.plugins.map((manifest) => {
      const explicit = manifest.id in states;
      const itemId = marketplaceItemIdFor(manifest.id);
      const bought =
        purchasedByItemId.get(itemId) ??
        purchasedByName.get(manifest.id) ??
        purchasedByName.get(manifest.name.toLowerCase()) ??
        null;
      const price = pluginPrice(manifest.id);
      return {
        ...manifest,
        /** آنچه بات واقعاً می‌بیند. */
        enabled: explicit ? states[manifest.id] : manifest.default_enabled,
        /** آیا وضعیت صریحاً ست شده یا از پیش‌فرض مانیفست می‌آید. */
        explicit,
        purchased: Boolean(bought),
        purchasedAt: bought ? bought.installedAt.toISOString() : null,
        /** همیشه پر است (نه فقط وقتی خریده شده) تا دکمه‌ی خرید بداند چه بخرد. */
        marketplaceItemId: itemId,
        price,
        isFree: price <= 0,
        /**
         * سکشنی از workspace که این پلاگین بازش می‌کند — از خودِ مانیفست.
         * کارت پلاگین با همین می‌گوید «بعد از روشن‌کردن، در بخش … پیدایش می‌کنی».
         */
        webSection: manifest.web_section ?? null,
      };
    });

    // کلیدهایی که در `__plugin_states__` هستند ولی در کاتالوگ نیستند: یا پلاگین
    // جدیدی در بات اضافه شده و کاتالوگ منتشرشده هنوز به‌روز نشده، یا یک کلید
    // دستی. نمایش داده می‌شوند تا بی‌صدا گم نشوند.
    const unknown = Object.keys(states).filter((id) => !catalog.plugins.some((p) => p.id === id));

    res.json({
      plugins,
      unknown,
      states,
      /**
       * false یعنی کاتالوگ از بات خوانده نشد و فهرست پایه استفاده شده — پس
       * ممکن است ناقص باشد. UI این را می‌گوید به‌جای اینکه یک فهرست ناقص را
       * قطعی جا بزند.
       */
      catalogPublished: catalog.published,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list plugins");
  }
});

/**
 * فقط `__plugin_states__` را آپدیت می‌کند — کلیدبه‌کلید روی همان یک سطر، پس
 * بقیه‌ی کلیدهای `bot_settings` (و بقیه‌ی پلاگین‌ها) دست‌نخورده می‌مانند (B11).
 * جدول `installed_plugins` اینجا اصلاً لمس نمی‌شود؛ خرید مسیر خودش را دارد.
 */
router.patch("/bots/:botId/plugins/:pluginId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const pluginId = String(req.params.pluginId);
    const catalog = await getPluginCatalog();
    const known = catalog.plugins.some((p) => p.id === pluginId);
    const states = await readStates(spreadsheetId);
    // یک کلید ناشناخته فقط وقتی پذیرفته می‌شود که از قبل روی شیت باشد — یعنی
    // خود بات ساخته‌اش. وگرنه کلاینت می‌توانست هر کلیدی را آنجا بکارد.
    if (!known && !(pluginId in states))
      throw new BotConfigError(404, "این پلاگین شناخته‌شده نیست.", "plugin_not_found");

    if (typeof req.body?.enabled !== "boolean")
      throw new BotConfigError(400, "مقدار `enabled` باید true یا false باشد.");

    // وابستگی‌های اعلام‌شده‌ی مانیفست: بات هم موقع enable همین را چک می‌کند
    // (`plugin_runtime.missing_dependencies`) و در آن حالت **بی‌صدا** رد
    // می‌کند — یعنی سوییچ سایت روشن می‌شد و بات نادیده می‌گرفت.
    if (req.body.enabled) {
      const manifest = catalog.plugins.find((p) => p.id === pluginId);
      const missing = (manifest?.dependencies ?? []).filter((dep) => {
        const depManifest = catalog.plugins.find((p) => p.id === dep);
        return !(dep in states ? states[dep] : (depManifest?.default_enabled ?? false));
      });
      if (missing.length > 0) {
        const names = missing
          .map((dep) => catalog.plugins.find((p) => p.id === dep)?.name_fa ?? dep)
          .join("، ");
        throw new BotConfigError(
          409,
          `این پلاگین به «${names}» نیاز دارد. اول آن را روشن کنید.`,
          "missing_dependencies",
        );
      }

      const wasEnabled = pluginId in states ? states[pluginId] : (manifest?.default_enabled ?? false);
      const price = pluginPrice(pluginId);

      if (price > 0) {
        // پولی: تا امروز این‌جا هیچ چکِ سروری نبود — کلاینت `purchased ||
        // isFree` را خودش حساب می‌کرد (`PluginsManager.tsx`) و اینجا هرچه
        // بفرستد پذیرفته می‌شد. یعنی یک `PATCH` دستی می‌توانست هر پلاگین
        // پولی را بدون خرید روشن کند.
        if (!(await isPluginPurchased(req.params.botId, pluginId, manifest?.name))) {
          throw new BotConfigError(402, "این پلاگین پولی است و هنوز خریداری نشده.", "plugin_not_purchased");
        }
      } else if (!wasEnabled) {
        // رایگان و فعلاً خاموش → روشن‌کردنش ممکن است از سقفِ «تعداد پلاگین
        // رایگان» پلنِ صاحبِ بات رد شود. پلاگین‌های پولی/خریداری‌شده هرگز جزو
        // این سهمیه شمرده نمی‌شوند.
        const [ownerRow] = await db
          .select({ userId: botsTable.userId })
          .from(botsTable)
          .where(eq(botsTable.id, req.params.botId))
          .limit(1);
        const limits = await getUserPlanLimits(ownerRow?.userId ?? req.userId);
        const enabledFreeCount = catalog.plugins.filter((p) => {
          if (p.id === pluginId) return false;
          const isEnabled = p.id in states ? states[p.id] : p.default_enabled;
          return isEnabled && pluginPrice(p.id) <= 0;
        }).length;
        if (enabledFreeCount + 1 > limits.maxPlugins) {
          throw new BotConfigError(
            403,
            `پلن فعلی شما حداکثر ${limits.maxPlugins} پلاگین رایگان روی هر بات را پشتیبانی می‌کند.`,
            "plugin_limit_reached",
          );
        }
      }
    }

    const next = { ...states, [pluginId]: req.body.enabled };
    await putEntity(spreadsheetId, SETTINGS_TAB, PLUGIN_STATES_KEY, next);

    // شمارنده‌ی نمایشی سایت. شکستش نباید نوشتنِ موفق روی شیت را خراب کند.
    try {
      await db
        .update(botsTable)
        .set({ pluginCount: Object.values(next).filter(Boolean).length })
        .where(eq(botsTable.id, req.params.botId));
    } catch (err) {
      logger.warn({ err }, "plugin count sync failed (ignored)");
    }

    res.json({ pluginId, enabled: req.body.enabled, states: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to toggle plugin");
  }
});

export default router;
