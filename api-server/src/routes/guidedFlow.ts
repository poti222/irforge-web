/**
 * routes/guidedFlow.ts — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT فازِ B1
 * ─────────────────────────────────────────────────────────────────────────────
 * سیمِ نازکِ Express رویِ `lib/guidedFlowStore.ts` — همان تقسیمِ
 * `routes/booking.ts` رویِ `bookingStore.ts`: منطقِ واقعی در ماژولِ lib
 * می‌ماند تا بدونِ لایه‌ی HTTP هم قابلِ تست باشد.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError, BotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as gfStore from "../lib/guidedFlowStore.js";

const router = Router();
const PLUGIN_ID = "guided_flow";

// ── گفت‌وگوها ────────────────────────────────────────────────────────────

router.get("/bots/:botId/guided-flow/flows", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ flows: await gfStore.listFlows(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list guided flows");
  }
});

router.post("/bots/:botId/guided-flow/flows", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const flow = await gfStore.createFlow(spreadsheetId, String(req.body?.title ?? ""));
    res.status(201).json({ flow });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create guided flow");
  }
});

router.patch("/bots/:botId/guided-flow/flows/:flowId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const body = req.body ?? {};
    const changes: Parameters<typeof gfStore.updateFlow>[2] = {};
    if (body.title !== undefined) changes.title = String(body.title);
    if (body.start_step_id !== undefined) changes.start_step_id = String(body.start_step_id);
    if (body.is_active !== undefined) changes.is_active = Boolean(body.is_active);
    const flow = await gfStore.updateFlow(spreadsheetId, req.params.flowId, changes);
    res.json({ flow });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update guided flow");
  }
});

router.delete("/bots/:botId/guided-flow/flows/:flowId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await gfStore.deleteFlow(spreadsheetId, req.params.flowId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete guided flow");
  }
});

router.get("/bots/:botId/guided-flow/flows/:flowId/stats", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ stats: await gfStore.flowStats(spreadsheetId, req.params.flowId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to load guided flow stats");
  }
});

// ── گام‌ها ───────────────────────────────────────────────────────────────

router.get("/bots/:botId/guided-flow/flows/:flowId/steps", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ steps: await gfStore.listSteps(spreadsheetId, req.params.flowId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list guided flow steps");
  }
});

router.post("/bots/:botId/guided-flow/flows/:flowId/steps", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const body = req.body ?? {};
    const step = await gfStore.createStep(spreadsheetId, {
      flow_id: req.params.flowId,
      step_type: body.step_type,
      question_text: body.question_text,
      options: body.options,
      media: body.media,
      body_html: body.body_html,
      buttons: body.buttons,
      default_to_step_id: body.default_to_step_id,
    });
    res.status(201).json({ step });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create guided flow step");
  }
});

router.patch("/bots/:botId/guided-flow/steps/:stepId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const step = await gfStore.updateStep(spreadsheetId, req.params.stepId, req.body ?? {});
    res.json({ step });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update guided flow step");
  }
});

router.delete("/bots/:botId/guided-flow/steps/:stepId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await gfStore.deleteStep(spreadsheetId, req.params.stepId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete guided flow step");
  }
});

// ── یال‌ها (transitions) ─────────────────────────────────────────────────

router.get("/bots/:botId/guided-flow/steps/:stepId/transitions", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ transitions: await gfStore.listTransitions(spreadsheetId, req.params.stepId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list guided flow transitions");
  }
});

router.post("/bots/:botId/guided-flow/steps/:stepId/transitions", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const body = req.body ?? {};
    if (!body.to_step_id) throw new BotConfigError(400, "گامِ مقصد مشخص نشده است.", "no_to_step");
    const transition = await gfStore.createTransition(
      spreadsheetId, req.params.stepId, String(body.to_step_id),
      body.condition ?? {}, Number(body.priority ?? 0),
    );
    res.status(201).json({ transition });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create guided flow transition");
  }
});

router.patch("/bots/:botId/guided-flow/transitions/:transitionId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const transition = await gfStore.updateTransition(spreadsheetId, req.params.transitionId, req.body ?? {});
    res.json({ transition });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update guided flow transition");
  }
});

router.delete("/bots/:botId/guided-flow/transitions/:transitionId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await gfStore.deleteTransition(spreadsheetId, req.params.transitionId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete guided flow transition");
  }
});

export default router;
