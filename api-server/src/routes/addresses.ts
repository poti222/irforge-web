/**
 * routes/addresses.ts — IRFORGE_PROMPT_V3 Phase 18
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD for the new `address` plugin's `addresses` tab. Thin Express wiring
 * (auth, plugin gate, error mapping) over `lib/addressStore.ts`, same split
 * as `routes/booking.ts` over `bookingStore.ts`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as addressStore from "../lib/addressStore.js";

const router = Router();
const PLUGIN_ID = "address";

router.get("/bots/:botId/addresses", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ addresses: await addressStore.listAddresses(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list addresses");
  }
});

router.post("/bots/:botId/addresses", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const address = await addressStore.createAddress(spreadsheetId, req.body ?? {});
    res.status(201).json({ address });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create address");
  }
});

router.patch("/bots/:botId/addresses/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const address = await addressStore.updateAddress(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ address });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update address");
  }
});

router.delete("/bots/:botId/addresses/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await addressStore.deleteAddress(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete address");
  }
});

router.get("/bots/:botId/addresses/settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ config: await addressStore.getAddressConfig(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read address settings");
  }
});

router.put("/bots/:botId/addresses/settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const config = await addressStore.setAddressConfig(spreadsheetId, String(req.body?.map_provider ?? ""));
    res.json({ config });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save address settings");
  }
});

export default router;
