/**
 * routes/loyaltySettings.ts — تنظیمات اقتصادِ باشگاه مشتریان (فاز ۲۴).
 * ─────────────────────────────────────────────────────────────────────────────
 * چهار عددی که تا امروز فقط از داخل بات قابل تغییر بودند — ببینید
 * lib/loyaltySettingsStore.ts برای شکل ذخیره‌سازی و منطق ادغام.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import {
  resolveBotSheet,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import { getLoyaltySettings, setLoyaltySettings, SETTINGS_TAB } from "../lib/loyaltySettingsStore.js";

const router = Router();

router.get("/bots/:botId/loyalty-settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, "loyalty");
    res.json(await getLoyaltySettings(spreadsheetId));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read loyalty settings");
  }
});

router.put("/bots/:botId/loyalty-settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, "loyalty");
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const body = req.body ?? {};
    for (const key of ["currencyPerPoint", "redeemValue", "redeemMinPoints", "signupBonus"]) {
      if (key in body && Number(body[key]) < 0)
        throw new BotConfigError(400, "مقادیر باید صفر یا مثبت باشند.", "bad_value");
    }

    res.json(await setLoyaltySettings(spreadsheetId, body));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update loyalty settings");
  }
});

export default router;
