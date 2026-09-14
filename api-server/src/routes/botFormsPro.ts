/**
 * routes/botFormsPro.ts — IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT بخشِ ۲.
 *
 * فقط‌خواندنی، روی `lib/formsProStore.ts`: فهرستِ فرم‌هایِ پلاگینِ
 * `forms_pro` (ساخته‌شده از کنسولِ ادمینِ بات) + آرشیوِ پاسخ‌هایِ هر فرم،
 * با جست‌وجویِ ساده و خروجیِ CSV.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError, BotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import { sendCsv } from "../lib/csv.js";
import * as formsProStore from "../lib/formsProStore.js";

const router = Router();
const PLUGIN_ID = "forms_pro";

router.get("/bots/:botId/formspro/forms", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const forms = await formsProStore.listForms(spreadsheetId);
    res.json({ forms });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list forms_pro forms");
  }
});

router.get("/bots/:botId/formspro/forms/:formId/submissions", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);

    const form = await formsProStore.getForm(spreadsheetId, req.params.formId);
    if (!form) throw new BotConfigError(404, "این فرم پیدا نشد.", "form_not_found");

    const search = String(req.query.search ?? "");
    const submissions = await formsProStore.listSubmissions(spreadsheetId, req.params.formId, search);

    if (String(req.query.format ?? "") === "csv") {
      const questionLabels = (form.questions ?? []).map((q) => q.label);
      const rows: unknown[][] = [
        ["id", "user_id", "username", ...questionLabels, "created_at"],
        ...submissions.map((s) => [
          s.id, s.user_id, s.username ?? "", ...(s.answers ?? []), s.created_at ?? "",
        ]),
      ];
      sendCsv(res, `forms_pro-${req.params.formId}-submissions.csv`, rows);
      return;
    }

    res.json({ form, submissions });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list forms_pro submissions");
  }
});

export default router;
