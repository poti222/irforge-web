/**
 * routes/marketplace.ts — فهرست مارکت‌پلیس.
 *
 * جدول `marketplace_items` هیچ‌وقت seed نمی‌شد، پس این فهرست همیشه خالی بود.
 * حالا قبل از هر خواندن، `ensurePluginItemsSynced` پلاگین‌های کاتالوگ منتشرشده‌ی
 * بات را به آیتم تبدیل می‌کند (TTL دار، پس هر درخواست یک sync نیست).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, marketplaceItemsTable } from "@workspace/db";
import { eq, like, or } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "./auth";
import { ensurePluginItemsSynced, syncPluginMarketplaceItems } from "../lib/marketplaceSync.js";
import {
  CUSTOM_BUILD, PLUGIN_PRICES, quoteCustomBuild,
} from "../lib/pluginPricing.js";
import { getPluginCatalog } from "../lib/pluginCatalog.js";

const router = Router();

function formatItem(item: any) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    price: item.price,
    isFree: item.isFree,
    author: item.author,
    version: item.version,
    rating: item.rating,
    installCount: item.installCount,
    tags: item.tags,
    icon: item.icon,
    featured: item.featured,
    createdAt: item.createdAt.toISOString(),
  };
}

// GET /api/marketplace/items
router.get("/marketplace/items", requireAuth, async (req: any, res) => {
  try {
    await ensurePluginItemsSynced();
    const { category, search } = req.query;
    let items = await db.select().from(marketplaceItemsTable);
    if (category) {
      items = items.filter(i => i.category === category);
    }
    if (search) {
      const q = (search as string).toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    }
    res.json(items.map(formatItem));
  } catch (err) {
    logger.error({ err }, "List marketplace error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/marketplace/items/:itemId
router.get("/marketplace/items/:itemId", requireAuth, async (req: any, res) => {
  try {
    await ensurePluginItemsSynced();
    const items = await db.select().from(marketplaceItemsTable).where(eq(marketplaceItemsTable.id, req.params.itemId)).limit(1);
    if (!items[0]) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(formatItem(items[0]));
  } catch (err) {
    logger.error({ err }, "Get marketplace item error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/marketplace/featured
router.get("/marketplace/featured", requireAuth, async (req: any, res) => {
  try {
    await ensurePluginItemsSynced();
    const items = await db.select().from(marketplaceItemsTable).where(eq(marketplaceItemsTable.featured, true));
    res.json(items.map(formatItem));
  } catch (err) {
    logger.error({ err }, "Get featured items error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/marketplace/pricing — قیمت‌نامه، تنها منبعی که فرانت باید بخواند.
 *
 * صفحه‌ی خرید بات و کارت‌های پلاگین همه از همین می‌خوانند تا عددی که کاربر
 * می‌بیند دقیقاً همان عددی باشد که سرور موقع پرداخت حساب می‌کند. هاردکد کردن
 * قیمت در فرانت یعنی دو منبع که از هم عقب می‌افتند.
 */
router.get("/marketplace/pricing", requireAuth, async (_req: any, res) => {
  try {
    const catalog = await getPluginCatalog();
    res.json({
      plugins: catalog.plugins.map((manifest) => ({
        id: manifest.id,
        name: manifest.name_fa || manifest.name,
        description: manifest.description,
        version: manifest.version,
        price: PLUGIN_PRICES[manifest.id] ?? 0,
        webSection: manifest.web_section ?? null,
      })),
      customBuild: CUSTOM_BUILD,
      catalogPublished: catalog.published,
    });
  } catch (err) {
    logger.error({ err }, "Marketplace pricing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/marketplace/quote-custom — قیمت یک بات سفارشی.
 *
 * فرانت همین را نشان می‌دهد و `POST /bots/wallet-purchase` هم دقیقاً همین تابع
 * را صدا می‌زند، پس «قیمتی که دیدم» و «قیمتی که پرداخت شد» نمی‌توانند از هم
 * جدا شوند.
 */
router.post("/marketplace/quote-custom", requireAuth, async (req: any, res) => {
  try {
    const catalog = await getPluginCatalog();
    const known = catalog.plugins.map((p) => p.id);
    res.json(quoteCustomBuild(req.body ?? {}, known));
  } catch (err) {
    logger.error({ err }, "Quote custom build error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** هم‌گام‌سازی دستی — برای وقتی که ادمین قیمت را عوض کرده و منتظر TTL نیست. */
router.post("/marketplace/sync-plugins", requireSuperAdmin, async (_req: any, res) => {
  try {
    res.json(await syncPluginMarketplaceItems());
  } catch (err) {
    logger.error({ err }, "Marketplace sync error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
