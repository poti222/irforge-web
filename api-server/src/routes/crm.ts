/**
 * routes/crm.ts — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Tag catalog CRUD, user<->tag assignment, and per-user notes for the `crm`
 * plugin. Thin Express wiring over `lib/crmStore.ts`, same split as
 * `routes/addresses.ts` over `addressStore.ts`. User search itself is not
 * duplicated here — see `GET /bots/:botId/bot-users` in `routes/botUsers.ts`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as crmStore from "../lib/crmStore.js";

const router = Router();
const PLUGIN_ID = "crm";

router.get("/bots/:botId/crm/tags", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const [tags, counts] = await Promise.all([
      crmStore.listTags(spreadsheetId),
      crmStore.tagCounts(spreadsheetId),
    ]);
    res.json({ tags: tags.map((t) => ({ ...t, memberCount: counts[t.id] ?? 0 })) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list CRM tags");
  }
});

router.post("/bots/:botId/crm/tags", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const tag = await crmStore.createTag(spreadsheetId, req.body ?? {});
    res.status(201).json({ tag });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create CRM tag");
  }
});

router.patch("/bots/:botId/crm/tags/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const tag = await crmStore.updateTag(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ tag });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update CRM tag");
  }
});

router.delete("/bots/:botId/crm/tags/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await crmStore.deleteTag(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete CRM tag");
  }
});

router.get("/bots/:botId/crm/users/:userId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const [tags, notes] = await Promise.all([
      crmStore.tagsOfUser(spreadsheetId, req.params.userId),
      crmStore.notesOfUser(spreadsheetId, req.params.userId),
    ]);
    res.json({ tags, notes });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read CRM user profile");
  }
});

router.post("/bots/:botId/crm/users/:userId/tags", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const tagId = String(req.body?.tag_id ?? "");
    const link = await crmStore.assignTag(spreadsheetId, req.params.userId, tagId, req.userId);
    res.status(201).json({ link });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to assign CRM tag");
  }
});

router.delete("/bots/:botId/crm/users/:userId/tags/:tagId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await crmStore.unassignTag(spreadsheetId, req.params.userId, req.params.tagId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to unassign CRM tag");
  }
});

router.post("/bots/:botId/crm/users/:userId/notes", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const note = await crmStore.addNote(spreadsheetId, req.params.userId, req.body?.body, req.userId);
    res.status(201).json({ note });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to add CRM note");
  }
});

router.delete("/bots/:botId/crm/notes/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await crmStore.deleteNote(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete CRM note");
  }
});

router.get("/bots/:botId/crm/stats", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ stats: await crmStore.getStats(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read CRM stats");
  }
});

export default router;
