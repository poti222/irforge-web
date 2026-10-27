/**
 * routes/files.ts — کتابخانه‌ی فایل‌ها (پلاگین `files`): ساخت/ویرایش/حذفِ «فایل = لینک».
 * لایه‌ی نازکِ Express روی `lib/filesStore.ts` (همان تقسیم drip/booking).
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as filesStore from "../lib/filesStore.js";

const router = Router();
const PLUGIN_ID = "files";

router.get("/bots/:botId/files/bundles", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ bundles: await filesStore.listBundles(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list files");
  }
});

router.post("/bots/:botId/files/bundles", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const bundle = await filesStore.createBundle(spreadsheetId, req.params.botId, req.body ?? {});
    res.status(201).json({ bundle });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to start file collection");
  }
});

router.post("/bots/:botId/files/bundles/:id/resend", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ sent: await filesStore.resendPrompt(spreadsheetId, req.params.botId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to resend prompt");
  }
});

router.patch("/bots/:botId/files/bundles/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ bundle: await filesStore.updateBundle(spreadsheetId, req.params.id, req.body ?? {}) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update file");
  }
});

router.delete("/bots/:botId/files/bundles/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await filesStore.deleteBundle(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete file");
  }
});

export default router;
