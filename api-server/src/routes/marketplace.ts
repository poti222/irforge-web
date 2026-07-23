import { logger } from "../lib/logger";
import { Router } from "express";
import { db, marketplaceItemsTable } from "@workspace/db";
import { eq, like, or } from "drizzle-orm";
import { requireAuth } from "./auth";

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
    const items = await db.select().from(marketplaceItemsTable).where(eq(marketplaceItemsTable.featured, true));
    res.json(items.map(formatItem));
  } catch (err) {
    logger.error({ err }, "Get featured items error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
