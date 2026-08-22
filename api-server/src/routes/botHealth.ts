/**
 * routes/botHealth.ts — سلامت‌سنجی کل بات (فاز ۲۴).
 *
 * خروجی `panelOps.panelHealth` را می‌گیرد و چهار دسته چک دیگر رویش سوار می‌کند
 * که هرکدام یک شکستِ **بی‌صدا** را پیدا می‌کنند — چیزهایی که بات موقعشان خطا
 * نمی‌دهد، فقط کار نمی‌کند:
 *   - فرمی بدون فیلد (کاربر واردش می‌شود و هیچ سؤالی نمی‌بیند)
 *   - کامندی با مقصد معلق
 *   - پلاگین فعالی که تب لازمش ساخته نشده
 *   - تنظیمات ناقص (پیام خالی، خانه‌ی تعیین‌نشده، پرداخت بدون اطلاعات)
 *
 * هر مورد `fixHint` دارد — کجای سایت باید برود تا درستش کند.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { listTabs } from "../lib/tenantSheets.js";
import {
  resolveBotSheet,
  listEntity,
  readSettings,
  allCutoverFlags,
  sendBotConfigError,
} from "../lib/botConfig.js";
import { panelHealth, listPanels, COMMANDS_TAB } from "../lib/panelOps.js";
import { cacheBustEnabled } from "../lib/botCacheBust.js";
import { botQueueAvailable } from "../lib/botQueue.js";
import type { Form } from "../lib/botTypes.js";

const router = Router();

type Issue = {
  code: string;
  severity: "error" | "warning";
  detail: string;
  /** سکشنی از workspace که این مورد آنجا درست می‌شود. */
  section: string;
  repairable: boolean;
};

/** تب‌های لازم هر پلاگین — آینه‌ی `required_sheets` مانیفست‌ها. */
const PLUGIN_REQUIRED_SHEETS: Record<string, string[]> = {
  catalog: ["catalog_categories", "catalog_items", "catalog_item_options", "catalog_fulfillments"],
  discount: ["discounts"],
  referral: ["referrals"],
  wallet: ["wallets"],
};

router.get("/bots/:botId/health", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const issues: Issue[] = [];

    // ۱. ساختار پنل‌ها — همان چک‌های فاز ۶.
    const panelIssues = await panelHealth(spreadsheetId);
    for (const issue of panelIssues) {
      issues.push({
        code: issue.code,
        severity: issue.code === "no_home" ? "warning" : "error",
        detail: issue.detail,
        section: "panels",
        repairable: issue.repairable,
      });
    }

    const panels = await listPanels(spreadsheetId);
    const settings = await readSettings(spreadsheetId);

    // ۲. فرم بدون فیلد — کاربر واردش می‌شود و هیچ سؤالی نمی‌بیند.
    let forms: Form[] = [];
    try {
      forms = (await listEntity<Form>(spreadsheetId, "forms"))
        .filter((r) => r.value && typeof r.value === "object")
        .map((r) => ({ ...(r.value as Form), id: r.key }));
    } catch {
      forms = [];
    }
    for (const form of forms) {
      if ((form.fields?.length ?? 0) === 0)
        issues.push({
          code: "form_without_fields",
          severity: "error",
          detail: `فرم «${form.title || form.id}» هیچ فیلدی ندارد؛ کاربر واردش می‌شود و هیچ سؤالی نمی‌بیند.`,
          section: "forms",
          repairable: false,
        });
      if (form.is_active && !form.destination_group && (form.destination_admin_ids?.length ?? 0) === 0)
        issues.push({
          code: "form_without_destination",
          severity: "warning",
          detail: `فرم «${form.title || form.id}» مقصدی ندارد؛ پاسخ‌های کاربر جایی فرستاده نمی‌شوند.`,
          section: "forms",
          repairable: false,
        });
    }

    // ۳. کامند با مقصد معلق.
    const formIds = new Set(forms.map((f) => f.id));
    const panelIds = new Set(panels.map((p) => p.id));
    try {
      const commands = await listEntity<{ command?: string; target?: string }>(spreadsheetId, COMMANDS_TAB);
      for (const row of commands) {
        const target = String(row.value?.target ?? "");
        const name = row.value?.command ?? row.key;
        if (target.startsWith("panel:") && !panelIds.has(target.slice(6)))
          issues.push({
            code: "command_dangling_panel",
            severity: "error",
            detail: `کامند «/${name}» به پنلی اشاره می‌کند که وجود ندارد.`,
            section: "commands",
            repairable: false,
          });
        if (target.startsWith("form:") && !formIds.has(target.slice(5)))
          issues.push({
            code: "command_dangling_form",
            severity: "error",
            detail: `کامند «/${name}» به فرمی اشاره می‌کند که وجود ندارد.`,
            section: "commands",
            repairable: false,
          });
      }
    } catch {
      /* تب کامندها ممکن است هنوز ساخته نشده باشد. */
    }

    // ۴. پلاگین فعال بدون تبِ لازم.
    let tabs: string[] = [];
    try {
      tabs = await listTabs(spreadsheetId);
    } catch {
      tabs = [];
    }
    if (tabs.length > 0) {
      const states = (settings as unknown as Record<string, unknown>).__plugin_states__;
      const enabled =
        states && typeof states === "object" && !Array.isArray(states)
          ? Object.entries(states as Record<string, unknown>).filter(([, v]) => Boolean(v)).map(([k]) => k)
          : [];
      for (const pluginId of enabled) {
        for (const sheet of PLUGIN_REQUIRED_SHEETS[pluginId] ?? []) {
          if (!tabs.includes(sheet))
            issues.push({
              code: "plugin_missing_sheet",
              severity: "warning",
              detail: `پلاگین «${pluginId}» فعال است ولی تب «${sheet}» هنوز ساخته نشده — بات آن را موقع اولین استفاده می‌سازد.`,
              section: "plugins",
              repairable: false,
            });
        }
      }

      // IRFORGE_PROMPT_V3 Phase 3 — before this phase, nine of twelve plugins'
      // routers ran regardless of is_enabled(), so a bot could accumulate
      // real rows (bookings, catalog orders, discount codes, ...) in a
      // plugin's tabs while that plugin showed as "disabled" on the site.
      // Gating the router doesn't delete that data — surface it instead so
      // the owner can decide to re-enable or export it, rather than
      // wondering why their sheet has tabs full of rows for a feature
      // they've never turned on.
      const enabledSet = new Set(enabled);
      for (const [pluginId, sheets] of Object.entries(PLUGIN_REQUIRED_SHEETS)) {
        if (enabledSet.has(pluginId)) continue;
        for (const sheet of sheets) {
          if (!tabs.includes(sheet)) continue;
          let rowCount = 0;
          try {
            rowCount = (await listEntity(spreadsheetId, sheet)).length;
          } catch {
            continue; // تب هست ولی خواندنش شکست خورد — نه خطای این بات، رد شو.
          }
          if (rowCount > 0)
            issues.push({
              code: "disabled_plugin_has_data",
              severity: "warning",
              detail: `این ربات داده‌ی افزونه‌ای دارد که فعال نیست — پلاگین «${pluginId}» غیرفعال است ولی تب «${sheet}» آن ${rowCount.toLocaleString("fa-IR")} ردیف دارد. از بخش پلاگین‌ها آن را فعال یا داده‌اش را دریافت کنید.`,
              section: "plugins",
              repairable: false,
            });
        }
      }
    }

    // ۵. تنظیمات ناقص.
    if (!settings.welcome_msg.trim())
      issues.push({ code: "empty_welcome", severity: "error", detail: "پیام خوش‌آمد خالی است.", section: "settings", repairable: false });
    if (settings.force_join_channels.length > 0 && !settings.force_join_message.trim())
      issues.push({
        code: "force_join_without_message",
        severity: "warning",
        detail: "عضویت اجباری فعال است ولی پیامش خالی است؛ کاربر نمی‌فهمد چرا نمی‌تواند ادامه دهد.",
        section: "settings",
        repairable: false,
      });
    if (panels.some((p) => p.type === "sell") && !settings.payment_info.trim())
      issues.push({
        code: "sell_without_payment_info",
        severity: "warning",
        detail: "پنل فروش دارید ولی اطلاعات پرداخت خالی است؛ کاربر نمی‌داند پول را کجا بفرستد.",
        section: "settings",
        repairable: false,
      });
    if (settings.maintenance)
      issues.push({
        code: "maintenance_on",
        severity: "warning",
        detail: "حالت تعمیر روشن است — بات فقط پیام تعمیر را جواب می‌دهد.",
        section: "settings",
        repairable: false,
      });

    res.json({
      issues,
      healthy: issues.length === 0,
      errorCount: issues.filter((i) => i.severity === "error").length,
      warningCount: issues.filter((i) => i.severity === "warning").length,
      // وضعیت زیرساخت — تا کاربر بداند تأخیر و صف در چه حالی‌اند.
      infrastructure: {
        cacheBust: cacheBustEnabled(),
        queue: botQueueAvailable(),
        cutoverFlags: await allCutoverFlags(),
      },
      counts: { panels: panels.length, forms: forms.length },
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to check bot health");
  }
});

export default router;
