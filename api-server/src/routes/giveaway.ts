/**
 * routes/giveaway.ts — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Campaign CRUD (pre-draw fields only), cancellation, and entrant/winner
 * drill-down for the `giveaway` plugin. Thin Express wiring over
 * `lib/giveawayStore.ts`, same split as `routes/drip.ts` over `dripStore.ts`.
 * The draw itself is not exposed here — see the store's header comment.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as giveawayStore from "../lib/giveawayStore.js";

const router = Router();
const PLUGIN_ID = "giveaway";

router.get("/bots/:botId/giveaways", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ giveaways: await giveawayStore.listGiveaways(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list giveaways");
  }
});

router.post("/bots/:botId/giveaways", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const giveaway = await giveawayStore.createGiveaway(spreadsheetId, req.body ?? {});
    res.status(201).json({ giveaway });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create giveaway");
  }
});

router.patch("/bots/:botId/giveaways/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const giveaway = await giveawayStore.updateGiveaway(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ giveaway });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update giveaway");
  }
});

router.post("/bots/:botId/giveaways/:id/cancel", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const giveaway = await giveawayStore.cancelGiveaway(spreadsheetId, req.params.id);
    res.json({ giveaway });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to cancel giveaway");
  }
});

router.delete("/bots/:botId/giveaways/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await giveawayStore.deleteGiveaway(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete giveaway");
  }
});

router.get("/bots/:botId/giveaways/:id/entrants", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ entrants: await giveawayStore.listEntrants(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list entrants");
  }
});

router.get("/bots/:botId/giveaways/:id/winners", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ winners: await giveawayStore.getWinners(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list winners");
  }
});

router.get("/bots/:botId/giveaways-stats", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ stats: await giveawayStore.getStats(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read giveaway stats");
  }
});

export default router;
