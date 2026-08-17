/**
 * routes/pluginLicences.ts — «چه پلاگین‌هایی دارم و روی کدام بات نشسته‌اند».
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز خرید پلاگین یک‌طرفه و چسبیده به یک بات بود: `POST /bots/:id/plugins`
 * یک ردیف `installed_plugins` با همان `bot_id` می‌ساخت و تمام. اگر بات را عوض
 * می‌کردید یا پلاگین را روی بات اشتباهی می‌خریدید، پولتان همان‌جا گیر بود.
 *
 * مدل جدید: **یک خرید = یک لایسنس، هر لحظه روی یک بات، قابل جابه‌جایی.**
 *
 * چیزی که برای این تغییر لازم *نبود*: جدول تازه. یک ردیف `installed_plugins`
 * از قبل «این پلاگین روی این بات» است؛ جابه‌جایی فقط عوض‌کردن `bot_id` همان
 * ردیف است. یک جدول لایسنس جدا، همان داده را دو جا نگه می‌داشت و باید بین‌شان
 * هم‌گام می‌ماند.
 *
 * سه قاعده‌ای که سمت سرور اجرا می‌شوند:
 *
 *   ۱. **مالکیت هر دو بات.** جابه‌جایی از باتی که مال شما نیست، یا به باتی که
 *      مال شما نیست، رد می‌شود. بدون این، دانستن یک `botId` کافی بود تا کسی
 *      لایسنس دیگری را بدزدد یا روی بات خودش بنشاند.
 *   ۲. **یک لایسنس، یک بات.** انتقال به باتی که همان پلاگین را دارد، ۴۰۹
 *      می‌دهد — وگرنه دو ردیف برای یک لایسنس ساخته می‌شد و شمارش مالکیت خراب.
 *   ۳. **جابه‌جایی، وضعیت فعال‌بودن را با خودش نمی‌برد.** «خریده‌شده» در
 *      Postgres سایت است و «روشن» در `__plugin_states__` شیت هر تننت
 *      (`routes/botPlugins.ts`). بات مقصد ممکن است هنوز شیت نداشته باشد، و
 *      روشن‌کردن خودکار روی یک بات زنده هم تصمیم کاربر است نه ما.
 */
import { Router } from "express";
import { db, installedPluginsTable, botsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { logger } from "../lib/logger.js";
import { getPluginCatalog } from "../lib/pluginCatalog.js";
import {
  ensurePluginItemsSynced,
  marketplaceItemIdFor,
  pluginIdFromItemId,
} from "../lib/marketplaceSync.js";
import { pluginPrice } from "../lib/pluginPricing.js";
import { BotConfigError, sendBotConfigError } from "../lib/botConfig.js";

const router = Router();

/** بات‌های همین کاربر. پایه‌ی هر چک مالکیتی در این فایل. */
async function ownedBots(userId: string) {
  return db
    .select({ id: botsTable.id, name: botsTable.name, status: botsTable.status })
    .from(botsTable)
    .where(eq(botsTable.userId, userId));
}

/**
 * `plugin_id` یک ردیف نصب.
 *
 * ردیف‌های تازه `marketplace_item_id = plugin-<id>` دارند، ولی ردیف‌های قدیمی‌تر
 * فقط اسم داشتند — پس تطبیق اسمی به‌عنوان fallback می‌ماند تا خریدِ گذشته
 * بی‌صاحب نشود (همان چیزی که `routes/botPlugins.ts` هم رعایت می‌کند).
 */
function pluginIdOf(row: { marketplaceItemId: string; name: string }, knownIds: Set<string>): string | null {
  const fromItem = pluginIdFromItemId(row.marketplaceItemId);
  if (fromItem && knownIds.has(fromItem)) return fromItem;
  const byName = row.name.toLowerCase();
  return knownIds.has(byName) ? byName : null;
}

/**
 * GET /api/plugin-licences
 *
 * نمای حساب‌محور: هر پلاگینِ کاتالوگ، با اینکه آیا این کاربر داردش و روی کدام
 * بات نشسته. همین یک پاسخ، هر دو بخشِ UI را می‌سازد (داشته‌ها بالا،
 * نداشته‌ها پایین) و لیست بات‌ها را هم می‌دهد تا انتخابگر بات لازم نباشد
 * درخواست دوم بزند.
 */
router.get("/plugin-licences", requireAuth, async (req: any, res) => {
  try {
    await ensurePluginItemsSynced();

    const [catalog, bots] = await Promise.all([
      getPluginCatalog(),
      ownedBots(req.userId),
    ]);

    const knownIds = new Set(catalog.plugins.map((p) => p.id));
    const botIds = bots.map((b) => b.id);
    const botName = new Map(bots.map((b) => [b.id, b.name]));

    // نصب‌های همه‌ی بات‌های این کاربر. `inArray` با آرایه‌ی خالی در بعضی
    // نسخه‌های drizzle SQL نامعتبر می‌سازد، پس کاربرِ بی‌بات را زودتر رد می‌کنیم.
    const installs = botIds.length
      ? await db.select().from(installedPluginsTable).where(inArray(installedPluginsTable.botId, botIds))
      : [];

    /** plugin_id → نصب‌هایش (به‌طور طبیعی یکی، ولی داده‌ی قدیمی می‌تواند بیشتر باشد). */
    const byPlugin = new Map<string, typeof installs>();
    for (const row of installs) {
      const pluginId = pluginIdOf(row, knownIds);
      if (!pluginId) continue;
      const list = byPlugin.get(pluginId) ?? [];
      list.push(row);
      byPlugin.set(pluginId, list);
    }

    const plugins = catalog.plugins.map((manifest) => {
      const rows = byPlugin.get(manifest.id) ?? [];
      const price = pluginPrice(manifest.id);
      return {
        id: manifest.id,
        name: manifest.name,
        name_fa: manifest.name_fa,
        description: manifest.description,
        description_fa: manifest.description_fa,
        version: manifest.version,
        required_sheets: manifest.required_sheets,
        webSection: manifest.web_section ?? null,
        price,
        isFree: price <= 0,
        marketplaceItemId: marketplaceItemIdFor(manifest.id),
        /** آیا این کاربر روی *هر* باتی داردش. مرز دو بخش UI همین است. */
        owned: rows.length > 0,
        /** لایسنس‌ها: هر کدام روی کدام بات. */
        licences: rows.map((row) => ({
          licenceId: row.id,
          botId: row.botId,
          botName: botName.get(row.botId) ?? "",
          installedAt: row.installedAt.toISOString(),
        })),
      };
    });

    res.json({
      plugins,
      bots: bots.map((b) => ({ id: b.id, name: b.name, status: b.status })),
      catalogPublished: catalog.published,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list plugin licences");
  }
});

/**
 * PATCH /api/plugin-licences/:licenceId  { botId }
 *
 * انتقال یک لایسنس به بات دیگر — همان «از این بات بردار، روی آن یکی بگذار».
 */
router.patch("/plugin-licences/:licenceId", requireAuth, async (req: any, res) => {
  try {
    const targetBotId = String(req.body?.botId ?? "");
    if (!targetBotId) throw new BotConfigError(400, "بات مقصد مشخص نشده است.", "bot_required");

    const [licence] = await db
      .select()
      .from(installedPluginsTable)
      .where(eq(installedPluginsTable.id, String(req.params.licenceId)))
      .limit(1);
    if (!licence) throw new BotConfigError(404, "این لایسنس پیدا نشد.", "licence_not_found");

    const bots = await ownedBots(req.userId);
    const owned = new Set(bots.map((b) => b.id));

    // مالکیت **هر دو** سر انتقال. چک‌نکردن مبدأ یعنی هر کسی با دانستن یک
    // licenceId می‌توانست لایسنس دیگری را به بات خودش منتقل کند.
    if (!owned.has(licence.botId))
      throw new BotConfigError(403, "این لایسنس مال شما نیست.", "not_owner");
    if (!owned.has(targetBotId))
      throw new BotConfigError(403, "بات مقصد مال شما نیست.", "not_owner");

    if (licence.botId === targetBotId) {
      res.json({ licenceId: licence.id, botId: targetBotId, moved: false });
      return;
    }

    // بات مقصد از قبل همین پلاگین را دارد؟ انتقال، دو ردیف برای یک لایسنس
    // می‌ساخت.
    const [clash] = await db
      .select({ id: installedPluginsTable.id })
      .from(installedPluginsTable)
      .where(and(
        eq(installedPluginsTable.botId, targetBotId),
        eq(installedPluginsTable.marketplaceItemId, licence.marketplaceItemId),
      ))
      .limit(1);
    if (clash)
      throw new BotConfigError(409, "بات مقصد از قبل این پلاگین را دارد.", "already_installed");

    await db
      .update(installedPluginsTable)
      .set({ botId: targetBotId })
      .where(eq(installedPluginsTable.id, licence.id));

    // شمارنده‌ی نمایشیِ هر دو بات جابه‌جا شده. شکستش نباید انتقال را خراب کند.
    for (const botId of [licence.botId, targetBotId]) {
      try {
        const rows = await db
          .select({ id: installedPluginsTable.id })
          .from(installedPluginsTable)
          .where(eq(installedPluginsTable.botId, botId));
        await db.update(botsTable).set({ pluginCount: rows.length }).where(eq(botsTable.id, botId));
      } catch (err) {
        logger.warn({ err, botId }, "plugin count sync after move failed (ignored)");
      }
    }

    logger.info(
      { licenceId: licence.id, from: licence.botId, to: targetBotId },
      "plugin licence moved",
    );
    res.json({ licenceId: licence.id, botId: targetBotId, moved: true, from: licence.botId });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to move plugin licence");
  }
});

export default router;
