/**
 * routes/survey.ts — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Survey/quiz definition (including real question authoring), publish
 * gating, and response results. Thin Express wiring over
 * `lib/surveyStore.ts`, same split as `routes/drip.ts` over `dripStore.ts`.
 * Answering a survey stays bot-only — no submit endpoint lives here.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as surveyStore from "../lib/surveyStore.js";

const router = Router();
const PLUGIN_ID = "survey";

router.get("/bots/:botId/surveys", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ surveys: await surveyStore.listSurveys(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list surveys");
  }
});

router.post("/bots/:botId/surveys", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const survey = await surveyStore.createSurvey(spreadsheetId, req.body ?? {});
    res.status(201).json({ survey });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create survey");
  }
});

router.patch("/bots/:botId/surveys/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const survey = await surveyStore.updateSurvey(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ survey });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update survey");
  }
});

router.post("/bots/:botId/surveys/:id/publish", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const active = Boolean(req.body?.active);
    const survey = await surveyStore.setActive(spreadsheetId, req.params.id, active);
    res.json({ survey });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to publish survey");
  }
});

router.delete("/bots/:botId/surveys/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await surveyStore.deleteSurvey(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete survey");
  }
});

router.post("/bots/:botId/surveys/:id/questions", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const survey = await surveyStore.addQuestion(spreadsheetId, req.params.id, req.body ?? {});
    res.status(201).json({ survey });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to add question");
  }
});

router.patch("/bots/:botId/surveys/:id/questions/:questionId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const survey = await surveyStore.updateQuestion(
      spreadsheetId, req.params.id, Number(req.params.questionId), req.body ?? {}
    );
    res.json({ survey });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update question");
  }
});

router.delete("/bots/:botId/surveys/:id/questions/:questionId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const survey = await surveyStore.removeQuestion(spreadsheetId, req.params.id, Number(req.params.questionId));
    res.json({ survey });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to remove question");
  }
});

router.get("/bots/:botId/surveys/:id/responses", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ responses: await surveyStore.listResponses(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list survey responses");
  }
});

router.get("/bots/:botId/surveys/:id/results", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ results: await surveyStore.getResults(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to compute survey results");
  }
});

router.get("/bots/:botId/surveys-stats", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ stats: await surveyStore.getStats(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read survey stats");
  }
});

export default router;
