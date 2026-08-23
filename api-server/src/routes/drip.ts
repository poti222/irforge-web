/**
 * routes/drip.ts — IRFORGE_PROMPT_V3 Phase 19
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD for the `drip` plugin's campaigns, plus safety settings and the
 * "test send to myself" action. Thin Express wiring over `lib/dripStore.ts`,
 * same split as `routes/addresses.ts` over `addressStore.ts`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as dripStore from "../lib/dripStore.js";

const router = Router();
const PLUGIN_ID = "drip";

router.get("/bots/:botId/drip/campaigns", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ campaigns: await dripStore.listCampaigns(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list drip campaigns");
  }
});

router.post("/bots/:botId/drip/campaigns", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const campaign = await dripStore.createCampaign(spreadsheetId, req.params.botId, req.body ?? {});
    res.status(201).json({ campaign });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create drip campaign");
  }
});

router.patch("/bots/:botId/drip/campaigns/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const campaign = await dripStore.updateCampaign(spreadsheetId, req.params.botId, req.params.id, req.body ?? {});
    res.json({ campaign });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update drip campaign");
  }
});

router.post("/bots/:botId/drip/campaigns/:id/toggle", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const campaign = await dripStore.toggleCampaign(spreadsheetId, req.params.id);
    res.json({ campaign });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to toggle drip campaign");
  }
});

router.delete("/bots/:botId/drip/campaigns/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await dripStore.deleteCampaign(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete drip campaign");
  }
});

router.post("/bots/:botId/drip/campaigns/:id/test", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const campaign = await dripStore.getCampaign(spreadsheetId, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: "این کمپین پیدا نشد.", code: "campaign_not_found" });
      return;
    }
    const target = String(req.body?.target ?? "").trim();
    const chatId = target
      ? await dripStore.resolveTestTarget(req.params.botId, target)
      : campaign.audience_mode === "single_chat" && campaign.audience_value
        ? campaign.audience_value
        : null;
    if (!chatId) {
      res.status(400).json({
        error: "شناسه‌ی مقصدِ تست را وارد کنید (یا مخاطبِ کمپین را روی «یک chat مشخص» بگذارید).",
        code: "no_test_target",
      });
      return;
    }
    await dripStore.sendTestMessage(req.params.botId, chatId, campaign);
    res.json({ sent: true });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to send test message");
  }
});

router.get("/bots/:botId/drip/stats", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ stats: await dripStore.getStats(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read drip stats");
  }
});

router.get("/bots/:botId/drip/settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ config: await dripStore.getSafetyConfig(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read drip settings");
  }
});

router.put("/bots/:botId/drip/settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ config: await dripStore.setSafetyConfig(spreadsheetId, req.body ?? {}) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save drip settings");
  }
});

export default router;
