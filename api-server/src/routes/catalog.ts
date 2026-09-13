/**
 * routes/catalog.ts — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Category/item/option CRUD plus fulfillment-config get/set for the `catalog`
 * plugin. Thin Express wiring over `lib/catalogStore.ts`, same split as
 * `routes/giveaway.ts` over `giveawayStore.ts`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as catalogStore from "../lib/catalogStore.js";

const router = Router();
const PLUGIN_ID = "catalog";

// ─── دسته‌بندی ───────────────────────────────────────────────────────────────

router.get("/bots/:botId/catalog/categories", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ categories: await catalogStore.listCategories(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list categories");
  }
});

router.post("/bots/:botId/catalog/categories", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const category = await catalogStore.createCategory(spreadsheetId, req.body ?? {}, req.userId);
    res.status(201).json({ category });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create category");
  }
});

router.patch("/bots/:botId/catalog/categories/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const category = await catalogStore.updateCategory(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ category });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update category");
  }
});

router.delete("/bots/:botId/catalog/categories/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await catalogStore.deleteCategory(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete category");
  }
});

// ─── کالا/سرویس ──────────────────────────────────────────────────────────────

router.get("/bots/:botId/catalog/items", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const includeArchived = req.query?.includeArchived === "1" || req.query?.includeArchived === "true";
    res.json({ items: await catalogStore.listItems(spreadsheetId, { includeArchived }) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list items");
  }
});

router.get("/bots/:botId/catalog/items/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.getItem(spreadsheetId, req.params.id);
    if (!item) { res.status(404).json({ error: "این کالا/سرویس پیدا نشد." }); return; }
    res.json({ item });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to load item");
  }
});

router.post("/bots/:botId/catalog/items", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.createItem(spreadsheetId, req.body ?? {}, req.userId);
    res.status(201).json({ item });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create item");
  }
});

router.patch("/bots/:botId/catalog/items/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.updateItem(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ item });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update item");
  }
});

router.post("/bots/:botId/catalog/items/:id/archive", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.archiveItem(spreadsheetId, req.params.id);
    res.json({ item });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to archive item");
  }
});

router.delete("/bots/:botId/catalog/items/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await catalogStore.deleteItemHard(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete item");
  }
});

// ─── تنظیمات تحویل (fulfillment) ─────────────────────────────────────────────

router.get("/bots/:botId/catalog/items/:id/fulfillment", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.getItem(spreadsheetId, req.params.id);
    if (!item) { res.status(404).json({ error: "این کالا/سرویس پیدا نشد." }); return; }
    res.json({ fulfillment_type: item.fulfillment_type, config: catalogStore.getFulfillmentConfig(item) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to load fulfillment config");
  }
});

router.put("/bots/:botId/catalog/items/:id/fulfillment", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.setFulfillmentConfig(spreadsheetId, req.params.id, req.body?.config ?? {});
    res.json({ fulfillment_type: item.fulfillment_type, config: catalogStore.getFulfillmentConfig(item) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save fulfillment config");
  }
});

// ─── پلن/گزینه ───────────────────────────────────────────────────────────────

router.get("/bots/:botId/catalog/items/:itemId/options", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const includeInactive = req.query?.includeInactive === "1" || req.query?.includeInactive === "true";
    res.json({ options: await catalogStore.listOptions(spreadsheetId, req.params.itemId, { includeInactive }) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list options");
  }
});

router.post("/bots/:botId/catalog/items/:itemId/options", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const option = await catalogStore.createOption(spreadsheetId, req.params.itemId, req.body ?? {});
    res.status(201).json({ option });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create option");
  }
});

router.patch("/bots/:botId/catalog/options/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const option = await catalogStore.updateOption(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ option });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update option");
  }
});

router.post("/bots/:botId/catalog/options/:id/deactivate", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const option = await catalogStore.deactivateOption(spreadsheetId, req.params.id);
    res.json({ option });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to deactivate option");
  }
});

router.delete("/bots/:botId/catalog/options/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await catalogStore.deleteOptionHard(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete option");
  }
});

// ─── فروخته‌شده‌هایِ استخرِ آیتمِ یکتا (pool) — IRFORGE_POOL_QTY_SOLDLIST_STOREFRONT_PROMPT بخش ۲ ──

router.get("/bots/:botId/catalog/items/:id/pool/sold", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const q = typeof req.query?.q === "string" ? req.query.q : undefined;
    const sold = await catalogStore.listPoolSold(spreadsheetId, req.params.id, { q });
    res.json({ sold });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list sold pool items");
  }
});

// ─── مدیریتِ موجودیِ استخر از سایت — IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش C، آیتمِ ۵ ──

router.get("/bots/:botId/catalog/items/:id/pool", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json(await catalogStore.getPoolSummary(spreadsheetId, req.params.id));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to load pool summary");
  }
});

router.post("/bots/:botId/catalog/items/:id/pool/items", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);

    // «افزودنِ انبوهِ متنی» (`text`، هر خط یک آیتم) یا ورودیِ ساخت‌یافته
    // (`entries`، برایِ وقتی file_id از قبل در دست است) — دقیقاً دو مسیرِ
    // بات خودش (fsm_pool_add_bulk_text در برابرِ fsm_pool_add_one_item).
    if (typeof req.body?.text === "string") {
      const separator = typeof req.body?.separator === "string" && req.body.separator ? req.body.separator : "\n";
      const created = await catalogStore.addPoolItemsFromText(spreadsheetId, req.params.id, req.body.text, separator);
      res.status(201).json({ created });
      return;
    }
    if (Array.isArray(req.body?.entries)) {
      const created = await catalogStore.addPoolItems(spreadsheetId, req.params.id, req.body.entries);
      res.status(201).json({ created });
      return;
    }
    res.status(400).json({ error: "یا «text» (افزودنِ انبوهِ متنی) یا «entries» (آرایه‌ی ساخت‌یافته) لازم است." });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to add pool items");
  }
});

router.delete("/bots/:botId/catalog/items/:id/pool/items/:poolId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const removed = await catalogStore.deletePoolItem(spreadsheetId, req.params.id, req.params.poolId);
    if (!removed) {
      res.status(409).json({ error: "این آیتم پیدا نشد یا دیگر available نیست (فقط آیتم‌هایِ available قابلِ حذفند).", code: "not_deletable" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete pool item");
  }
});

router.put("/bots/:botId/catalog/items/:id/pool/threshold", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const item = await catalogStore.setPoolThreshold(spreadsheetId, req.params.id, Number(req.body?.lowThreshold));
    res.json(item);
  } catch (err) {
    sendBotConfigError(res, err, "Failed to set low-stock threshold");
  }
});

export default router;
