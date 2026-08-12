/**
 * routes/botWorkflows.ts — ورک‌فلوها (تب `workflows` و `workflow_runs`).
 * ─────────────────────────────────────────────────────────────────────────────
 * شکل و کاتالوگ **از روی کد بات بیرون کشیده شده، نه حدس زده**:
 *
 *   workflow (`WorkflowDefinition.to_dict`، خط ۱۵۰ در `utils/workflow_definitions.py`):
 *     { id, name, trigger: {type, config}, conditions: [{field, operator, value}],
 *       actions: [{type, params}], is_active, rule? }
 *
 *   run (`utils/workflow_engine.py:439`):
 *     { id, workflow_id, trigger_event, trigger_data, status, started_at,
 *       finished_at, node_results[], error }
 *
 * کاتالوگ actionها از `register_action_handler("…")` در کل سورس بات استخراج شد:
 *   emit_event · send_message · wallet_credit · wallet_debit · wallet_freeze · wallet_unfreeze
 * و رویدادهای trigger از `event_engine.emit("event.…")`:
 *   event.object.created/updated/deleted · event.payment.approved/rejected ·
 *   event.wallet.transaction/frozen/unfrozen
 *
 * نکته: actionهای `wallet_*` را پلاگین کیف پول ثبت می‌کند، پس اگر آن پلاگین
 * فعال نباشد در runtime وجود ندارند. کاتالوگ همین را علامت می‌زند به‌جای اینکه
 * وانمود کند همیشه در دسترس‌اند.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  removeEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { nowIso, newUuid } from "../lib/botTypes.js";

const router = Router();
const WORKFLOWS_TAB = "workflows";
const RUNS_TAB = "workflow_runs";

const TRIGGER_TYPES = ["event", "schedule", "manual"] as const;

const EVENT_NAMES = [
  "event.object.created",
  "event.object.updated",
  "event.object.deleted",
  "event.payment.approved",
  "event.payment.rejected",
  "event.wallet.transaction",
  "event.wallet.frozen",
  "event.wallet.unfrozen",
] as const;

/** `requiresPlugin` یعنی هندلرش را یک پلاگین ثبت می‌کند، نه هسته. */
const ACTION_CATALOG = [
  {
    type: "send_message",
    label: "ارسال پیام",
    params: [{ name: "chat_id", required: true }, { name: "text", required: true }],
    requiresPlugin: null as string | null,
  },
  {
    type: "emit_event",
    label: "انتشار رویداد",
    params: [{ name: "event", required: true }, { name: "payload", required: false }],
    requiresPlugin: null,
  },
  {
    type: "wallet_credit",
    label: "شارژ کیف پول",
    params: [{ name: "user_id", required: true }, { name: "amount", required: true }],
    requiresPlugin: "wallet",
  },
  {
    type: "wallet_debit",
    label: "برداشت از کیف پول",
    params: [{ name: "user_id", required: true }, { name: "amount", required: true }],
    requiresPlugin: "wallet",
  },
  { type: "wallet_freeze", label: "مسدودکردن کیف پول", params: [{ name: "user_id", required: true }], requiresPlugin: "wallet" },
  { type: "wallet_unfreeze", label: "رفع مسدودی کیف پول", params: [{ name: "user_id", required: true }], requiresPlugin: "wallet" },
] as const;

/** عملگرهای شرط — `rules_engine.Operator`. */
const CONDITION_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "exists"] as const;

type Workflow = {
  id: string;
  name: string;
  trigger: { type: string; config: Record<string, unknown> };
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  actions: Array<{ type: string; params: Record<string, unknown> }>;
  is_active: boolean;
};

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function validateTrigger(value: unknown): Workflow["trigger"] {
  const raw = (value ?? {}) as any;
  const type = String(raw.type ?? "manual");
  if (!(TRIGGER_TYPES as readonly string[]).includes(type))
    throw bad(`نوع تریگر «${type}» پشتیبانی نمی‌شود.`, "bad_trigger");
  const config = raw.config && typeof raw.config === "object" ? raw.config : {};
  if (type === "event" && !String(config.event ?? "").trim())
    throw bad("تریگر از نوع رویداد باید نام رویداد داشته باشد.", "event_required");
  if (type === "schedule" && !String(config.cron ?? config.interval ?? "").trim())
    throw bad("تریگر زمان‌بندی‌شده باید cron یا بازه داشته باشد.", "schedule_required");
  return { type, config };
}

function validateActions(value: unknown): Workflow["actions"] {
  if (!Array.isArray(value)) throw bad("فهرست اقدام‌ها باید آرایه باشد.");
  if (value.length === 0) throw bad("ورک‌فلو باید حداقل یک اقدام داشته باشد.", "no_actions");
  if (value.length > 30) throw bad("حداکثر ۳۰ اقدام برای یک ورک‌فلو مجاز است.");

  return value.map((raw: any, i: number) => {
    const type = String(raw?.type ?? "").trim();
    const known = ACTION_CATALOG.find((a) => a.type === type);
    if (!known) throw bad(`اقدام شماره ${i + 1}: نوع «${type}» شناخته‌شده نیست.`, "bad_action");

    const params = raw?.params && typeof raw.params === "object" ? raw.params : {};
    for (const p of known.params) {
      if (p.required && !String((params as any)[p.name] ?? "").trim())
        throw bad(`اقدام «${known.label}»: پارامتر «${p.name}» اجباری است.`, "missing_param");
    }
    return { type, params };
  });
}

function validateConditions(value: unknown): Workflow["conditions"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw bad("فهرست شرط‌ها باید آرایه باشد.");
  return value.map((raw: any, i: number) => {
    const field = String(raw?.field ?? "").trim();
    if (!field) throw bad(`شرط شماره ${i + 1}: نام فیلد خالی است.`);
    const operator = String(raw?.operator ?? "eq");
    if (!(CONDITION_OPERATORS as readonly string[]).includes(operator))
      throw bad(`شرط شماره ${i + 1}: عملگر «${operator}» پشتیبانی نمی‌شود.`);
    return { field, operator, value: raw?.value ?? null };
  });
}

async function readWorkflows(spreadsheetId: string): Promise<Workflow[]> {
  const rows = await listEntity<Workflow>(spreadsheetId, WORKFLOWS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Workflow), id: r.key }));
}

// ─── کاتالوگ ────────────────────────────────────────────────────────────────

router.get("/bots/:botId/workflow-catalog", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    // کدام پلاگین‌ها فعال‌اند — تا کاتالوگ بگوید کدام اقدام واقعاً در دسترس است.
    const states = (await getEntity<Record<string, unknown>>(spreadsheetId, "bot_settings", "__plugin_states__")) ?? {};
    const enabled = new Set(
      Object.entries(states as Record<string, unknown>)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k)
    );

    res.json({
      triggerTypes: TRIGGER_TYPES,
      events: EVENT_NAMES,
      operators: CONDITION_OPERATORS,
      actions: ACTION_CATALOG.map((a) => ({
        ...a,
        available: !a.requiresPlugin || enabled.has(a.requiresPlugin),
      })),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read workflow catalog");
  }
});

// ─── ورک‌فلوها ──────────────────────────────────────────────────────────────

router.get("/bots/:botId/workflows", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const workflows = await readWorkflows(spreadsheetId);
    res.json({ workflows, count: workflows.length });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list workflows");
  }
});

router.post("/bots/:botId/workflows", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(WORKFLOWS_TAB);

    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) throw bad("ورک‌فلو باید نام داشته باشد.");

    const workflow: Workflow = {
      id: newUuid(),
      name,
      trigger: validateTrigger(body.trigger),
      conditions: validateConditions(body.conditions),
      actions: validateActions(body.actions),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    };

    await putEntity(spreadsheetId, WORKFLOWS_TAB, workflow.id, workflow);
    res.status(201).json({ workflow });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create workflow");
  }
});

router.patch("/bots/:botId/workflows/:workflowId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(WORKFLOWS_TAB);

    const current = await getEntity<Workflow>(spreadsheetId, WORKFLOWS_TAB, req.params.workflowId);
    if (!current) throw new BotConfigError(404, "این ورک‌فلو پیدا نشد.", "workflow_not_found");

    const body = req.body ?? {};
    const next: Workflow = { ...current, id: req.params.workflowId };
    if ("name" in body) {
      const name = String(body.name ?? "").trim();
      if (!name) throw bad("ورک‌فلو باید نام داشته باشد.");
      next.name = name;
    }
    if ("trigger" in body) next.trigger = validateTrigger(body.trigger);
    if ("conditions" in body) next.conditions = validateConditions(body.conditions);
    if ("actions" in body) next.actions = validateActions(body.actions);
    if ("is_active" in body) next.is_active = Boolean(body.is_active);

    await putEntity(spreadsheetId, WORKFLOWS_TAB, next.id, next);
    res.json({ workflow: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update workflow");
  }
});

router.post("/bots/:botId/workflows/:workflowId/toggle", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(WORKFLOWS_TAB);

    const current = await getEntity<Workflow>(spreadsheetId, WORKFLOWS_TAB, req.params.workflowId);
    if (!current) throw new BotConfigError(404, "این ورک‌فلو پیدا نشد.", "workflow_not_found");

    const next = { ...current, id: req.params.workflowId, is_active: !current.is_active };
    await putEntity(spreadsheetId, WORKFLOWS_TAB, next.id, next);
    res.json({ workflow: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to toggle workflow");
  }
});

router.delete("/bots/:botId/workflows/:workflowId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(WORKFLOWS_TAB);
    const removed = await removeEntity(spreadsheetId, WORKFLOWS_TAB, req.params.workflowId);
    if (!removed) throw new BotConfigError(404, "این ورک‌فلو پیدا نشد.", "workflow_not_found");
    // تاریخچه‌ی اجراها عمداً می‌ماند: گزارشِ کاری که واقعاً انجام شده، با حذف
    // تعریفش دروغ نمی‌شود.
    res.json({ deleted: req.params.workflowId });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete workflow");
  }
});

// ─── تاریخچه‌ی اجرا ─────────────────────────────────────────────────────────

router.get("/bots/:botId/workflow-runs", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    let runs: Array<Record<string, unknown>> = [];
    try {
      const rows = await listEntity<Record<string, unknown>>(spreadsheetId, RUNS_TAB);
      runs = rows
        .filter((r) => r.value && typeof r.value === "object")
        .map((r) => ({ ...(r.value as Record<string, unknown>), id: r.key }));
    } catch {
      runs = [];
    }

    const workflowId = String(req.query.workflowId ?? "");
    if (workflowId) runs = runs.filter((r) => r.workflow_id === workflowId);

    runs.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));

    res.json({ runs: runs.slice(0, limit), total: runs.length });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list workflow runs");
  }
});

export default router;
