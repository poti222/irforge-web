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

export default router;
