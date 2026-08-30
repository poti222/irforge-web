/**
 * routes/translatePost.ts — website management for the `translate_post` bot
 * plugin (Google Translate API, 11-language channel posts). Thin Express
 * wiring over `lib/translatePostStore.ts`, same split as `routes/giveaway.ts`
 * over `giveawayStore.ts`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import { perUserRateLimit } from "../middleware/rateLimit.js";
import * as translatePostStore from "../lib/translatePostStore.js";

const router = Router();
const PLUGIN_ID = "translate_post";

router.get("/bots/:botId/translate-post/config", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json(await translatePostStore.getConfig(spreadsheetId));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read translate_post config");
  }
});

router.patch("/bots/:botId/translate-post/config", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const { channelId, apiKey, enabled } = req.body ?? {};
    const config = await translatePostStore.updateConfig(spreadsheetId, {
      channelId: typeof channelId === "string" ? channelId : undefined,
      apiKey: typeof apiKey === "string" ? apiKey : undefined,
      enabled: typeof enabled === "boolean" ? enabled : undefined,
    });
    res.json(config);
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update translate_post config");
  }
});

router.get("/bots/:botId/translate-post/posts", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ posts: await translatePostStore.listPosts(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list translate_post posts");
  }
});

router.post(
  "/bots/:botId/translate-post/publish",
  requireAuth,
  perUserRateLimit("translate_post_publish", 10, 60 * 60 * 1000),
  async (req: any, res) => {
    try {
      const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
      await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
      const sourceText = String(req.body?.sourceText ?? "");
      const result = await translatePostStore.publishPost(req.params.botId, spreadsheetId, sourceText);
      res.status(201).json(result);
    } catch (err) {
      sendBotConfigError(res, err, "Failed to publish translated post");
    }
  },
);

export default router;
