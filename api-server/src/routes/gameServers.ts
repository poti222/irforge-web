/**
 * routes/gameServers.ts — IRFORGE_CS2_RCON_PLUGIN_PROMPT Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD for the `gameserver_cs2` plugin's server list. Thin Express wiring
 * (auth, plugin gate, error mapping) over `lib/gameServerStore.ts`, same
 * split as `routes/addresses.ts` over `addressStore.ts`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import * as gameServerStore from "../lib/gameServerStore.js";

const router = Router();
const PLUGIN_ID = "gameserver_cs2";

router.get("/bots/:botId/gameservers", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ servers: await gameServerStore.listServers(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list game servers");
  }
});

router.post("/bots/:botId/gameservers", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const server = await gameServerStore.createServer(spreadsheetId, req.body ?? {});
    res.status(201).json({ server });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create game server");
  }
});

router.patch("/bots/:botId/gameservers/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const server = await gameServerStore.updateServer(spreadsheetId, req.params.id, req.body ?? {});
    res.json({ server });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update game server");
  }
});

router.delete("/bots/:botId/gameservers/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await gameServerStore.deleteServer(spreadsheetId, req.params.id) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete game server");
  }
});

export default router;
