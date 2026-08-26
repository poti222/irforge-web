/**
 * routes/botSubscription.ts — IRFORGE_PROMPT_V3 Phase 32
 *
 * Read-only endpoint for the dashboard's plan card (BotPlanCard.tsx):
 * plan name, price, status, renewal date and days remaining. Actually
 * changing plans (upgrade/renew/downgrade) is a separate, later phase --
 * this route only ever reads `lib/botSubscriptions.ts`'s mirror of the
 * bot's own `utils/subscriptions.py`.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { getSubscriptionSummary } from "../lib/botSubscriptions.js";

const router = Router();

router.get("/bots/:botId/subscription", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const summary = await getSubscriptionSummary(spreadsheetId);
    res.json(summary);
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read bot subscription");
  }
});

export default router;
