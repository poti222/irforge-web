/**
 * routes/pluginLicences.ts — «چه پلاگین‌هایی دارم و روی کدام بات نشسته‌اند».
 * ─────────────────────────────────────────────────────────────────────────────
 * هر خرید یک‌طرفه و چسبیده به همان بات است: `POST /bots/:id/plugins` یک
 * ردیف `installed_plugins` با همان `bot_id` می‌سازد و تمام.
 *
 * **جابه‌جاییِ یک لایسنس بینِ بات‌ها عمداً حذف شده** — درخواستِ صریح: «کسی
 * نتواند پلاگین را به بات دیگری منتقل کند؛ فقط باید بخرد». پلاگینی که روی
 * بات دیگرِ همین کاربر نصب است، همین‌جا (`GET`) با `owned: true` دیده
 * می‌شود، ولی راهی برای انتقالش به این بات نیست — تنها راه، خریدِ جدا برای
 * همین بات است (`POST /bots/:id/plugins`).
 */
import { Router } from "express";
import { db, installedPluginsTable, botsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { getPluginCatalog } from "../lib/pluginCatalog.js";
import {
  ensurePluginItemsSynced,
  marketplaceItemIdFor,
  pluginIdFromItemId,
} from "../lib/marketplaceSync.js";
import { pluginPrice } from "../lib/pluginPricing.js";
import { sendBotConfigError } from "../lib/botConfig.js";

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

export default router;
