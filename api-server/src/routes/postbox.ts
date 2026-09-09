/**
 * routes/postbox.ts — IRFORGE_POSTBOX_PROMPT Phase B1
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin Express wiring over `lib/postboxStore.ts`, same split as
 * `routes/catalog.ts` over `catalogStore.ts`. A dedicated route file rather
 * than the generic `pluginCollections.ts` CRUD layer, for the same reason
 * catalog needed one: `publish`/`edit-buttons` aren't plain field-list CRUD
 * (broken-translation-button guard, cross-tab writes, sanitization), and
 * `body_html` needs `sanitizeTelegramHtml()` applied at every write, which
 * the generic layer's field-type system has no concept of.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as postboxStore from "../lib/postboxStore.js";

const router = Router();
const PLUGIN_ID = "autoposter";

// ─── پیام‌ها ─────────────────────────────────────────────────────────────────

router.get("/bots/:botId/postbox/messages", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ messages: await postboxStore.listMessages(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list postbox messages");
  }
});

router.get("/bots/:botId/postbox/messages/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const message = await postboxStore.getMessage(spreadsheetId, req.params.id);
    if (!message) { res.status(404).json({ error: "این پیام پیدا نشد." }); return; }
    const [translations, buttons, targets] = await Promise.all([
      postboxStore.listTranslations(spreadsheetId, req.params.id),
      postboxStore.listButtons(spreadsheetId, req.params.id),
      postboxStore.listTargets(spreadsheetId, req.params.id),
    ]);
    res.json({ message, translations, buttons, targets });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to load postbox message");
  }
});

router.post("/bots/:botId/postbox/messages", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const message = await postboxStore.createComposedMessage(spreadsheetId, req.body ?? {});
    res.status(201).json({ message });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create postbox message");
  }
});

router.patch("/bots/:botId/postbox/messages/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const message = await postboxStore.updateComposedMessage(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ message });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update postbox message");
  }
});

router.delete("/bots/:botId/postbox/messages/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await postboxStore.deleteMessage(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete postbox message");
  }
});

// ─── ترجمه‌ها ────────────────────────────────────────────────────────────────

router.post("/bots/:botId/postbox/messages/:messageId/translations", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const translation = await postboxStore.createTranslation(spreadsheetId, req.params.messageId, req.body ?? {});
    res.status(201).json({ translation });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create translation");
  }
});

router.patch("/bots/:botId/postbox/messages/:messageId/translations/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const translation = await postboxStore.updateTranslation(spreadsheetId, req.params.messageId, req.params.id, req.body ?? {});
    res.json({ translation });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update translation");
  }
});

router.delete("/bots/:botId/postbox/messages/:messageId/translations/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const removed = await postboxStore.deleteTranslation(spreadsheetId, req.params.messageId, req.params.id);
    if (!removed) { res.status(404).json({ error: "این ترجمه پیدا نشد." }); return; }
    res.status(204).end();
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete translation");
  }
});

// ─── دکمه‌ها ──────────────────────────────────────────────────────────────────

router.post("/bots/:botId/postbox/messages/:messageId/buttons", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const button = await postboxStore.createButton(spreadsheetId, req.params.messageId, req.body ?? {});
    res.status(201).json({ button });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create button");
  }
});

router.patch("/bots/:botId/postbox/messages/:messageId/buttons/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const button = await postboxStore.updateButton(spreadsheetId, req.params.messageId, req.params.id, req.body ?? {});
    res.json({ button });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update button");
  }
});

router.delete("/bots/:botId/postbox/messages/:messageId/buttons/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const removed = await postboxStore.deleteButton(spreadsheetId, req.params.messageId, req.params.id);
    if (!removed) { res.status(404).json({ error: "این دکمه پیدا نشد." }); return; }
    res.status(204).end();
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete button");
  }
});

// ─── کانال‌هایِ شناخته‌شده (برایِ پیشنهاد در دیالوگِ انتشار) ────────────────────

router.get("/bots/:botId/postbox/channels", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ channels: await postboxStore.listKnownChannels(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list known channels");
  }
});

// ─── انتشار / ویرایشِ دکمه‌هایِ پستِ منتشرشده ─────────────────────────────────

router.post("/bots/:botId/postbox/messages/:messageId/publish", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const channels = Array.isArray(req.body?.channels) ? req.body.channels : [];
    const slowMode = Boolean(req.body?.slow_mode);
    const results = await postboxStore.publishMessage(spreadsheetId, req.params.messageId, channels, slowMode);
    res.status(201).json({ results });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to publish");
  }
});

router.post("/bots/:botId/postbox/messages/:messageId/edit-buttons", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await postboxStore.requestButtonEdit(spreadsheetId, req.params.messageId);
    res.status(202).json({ queued: true });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to queue button edit");
  }
});

export default router;
