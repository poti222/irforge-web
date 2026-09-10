/**
 * lib/guidedFlowStore.ts — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT فازِ B1
 * ─────────────────────────────────────────────────────────────────────────────
 * همتایِ TypeScriptِ `plugins/guided_flow/domain.py` — همان چهار تب
 * (`guided_flows`/`guided_flow_steps`/`guided_flow_transitions`/
 * `guided_flow_sessions`)، همان شکلِ فیلدها، رویِ همان زیرساختِ عمومیِ
 * `getEntity`/`putEntity`/`listEntity`/`removeEntity`ی `botConfig.ts`
 * (دقیقاً همان کاری که `bookingStore.ts` برایِ `plugins/booking/domain.py`
 * می‌کند) — دو runtime یک storeِ فیزیکیِ واحد را با دو wrapperِ زبانیِ
 * جدا می‌خوانند/می‌نویسند، نه دو کپیِ داده‌یِ جدا.
 *
 * `flow_sessions` فقط خوانده می‌شود (برایِ آمار) — ساختن/تغییرِ یک session
 * کارِ خودِ باتِ در حالِ اجراست (`plugins/guided_flow/domain.py::start_flow`/
 * `answer_step`)، دقیقاً همان مرزی که `bookingStore.ts` هم برایِ رزرو رعایت
 * می‌کند (سایت رزرو نمی‌سازد، فقط مدیریت می‌کند).
 *
 * ساختِ گفت‌وگو کاملاً از پنلِ وب است (فازِ A2 خودِ همین پرامپت در
 * `plugins/guided_flow/handlers.py` این را صریح مستند کرده)، پس idهایِ
 * flow/step/transition اینجا `crypto.randomUUID()` می‌گیرند — همان قراردادِ
 * `discountStore.ts`/`audit.ts` — نه شِمایِ کوتاه‌شده‌یِ `_short_id`ی پایتون
 * که فقط برایِ idِ sessionِ داخلِ callback_dataیِ تلگرام لازم بود؛ این سه
 * مدل هیچ‌وقت داخلِ callback_data ظاهر نمی‌شوند.
 */
import { getEntity, listEntity, putEntity, removeEntity, assertSheetsAuthoritative, BotConfigError } from "./botConfig.js";
import { nowIso } from "./botTypes.js";

const FLOWS_TAB = "guided_flows";
const STEPS_TAB = "guided_flow_steps";
const TRANSITIONS_TAB = "guided_flow_transitions";
const SESSIONS_TAB = "guided_flow_sessions";

export type StepType = "question" | "result";
export const STEP_TYPES: StepType[] = ["question", "result"];

export interface FlowOption {
  label: string;
  value: string;
}

export interface FlowMediaItem {
  type: "photo" | "video" | "animation" | "document";
  file_id: string;
  caption?: string;
}

export interface FlowButton {
  label: string;
  action: "url" | "panel" | "mini_app";
  value: string;
  row: number;
  col: number;
  style?: string;
  // `row_start` UI-only bookkeeping از `@/lib/panel-buttons`ی سمتِ وب —
  // این‌جا فقط round-trip می‌شود؛ `plugins/catalog/delivery.py::build_button_markup`
  // (رندررِ واقعیِ این دکمه‌ها) فقط action/value/row/col را می‌خواند.
  row_start?: boolean;
  icon_custom_emoji_id?: string;
}

/** شرطِ تخت یا گروهِ تودرتویِ AND/OR/NOT — همان فرمتی که
 * `utils/workflow_engine.py::_node_from_config` قبول می‌کند. شرطِ خالی
 * (`{}`) یعنی «همیشه بگیر». */
export type FlowCondition =
  | Record<string, never>
  | { field: string; operator: string; value: unknown; expression?: string }
  | { logic: "and" | "or" | "not"; conditions: FlowCondition[] };

export interface GuidedFlow {
  id: string;
  title: string;
  start_step_id: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface GuidedFlowStep {
  id: string;
  flow_id: string;
  step_type: StepType;
  question_text: string;
  options: FlowOption[];
  media: FlowMediaItem[];
  body_html: string;
  buttons: FlowButton[];
  default_to_step_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface GuidedFlowTransition {
  id: string;
  from_step_id: string;
  to_step_id: string;
  condition: FlowCondition;
  priority: number;
  created_at?: string;
  updated_at?: string;
}

export interface GuidedFlowSession {
  id: string;
  flow_id: string;
  user_id: string;
  current_step_id: string;
  answers: Record<string, unknown>;
  started_at?: string;
  completed_at?: string;
}

function newId(): string {
  return crypto.randomUUID();
}

// ══════════════════════════════════════════════════════════════════════════
//  Flows
// ══════════════════════════════════════════════════════════════════════════

export async function listFlows(spreadsheetId: string): Promise<GuidedFlow[]> {
  const rows = await listEntity<GuidedFlow>(spreadsheetId, FLOWS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as GuidedFlow), id: r.key }))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export async function getFlow(spreadsheetId: string, id: string): Promise<GuidedFlow | null> {
  const value = await getEntity<GuidedFlow>(spreadsheetId, FLOWS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createFlow(spreadsheetId: string, title: string): Promise<GuidedFlow> {
  await assertSheetsAuthoritative(FLOWS_TAB);
  const trimmed = (title ?? "").trim();
  if (!trimmed) throw new BotConfigError(400, "عنوانِ گفت‌وگو نمی‌تواند خالی باشد.", "bad_title");
  const id = newId();
  const flow: GuidedFlow = {
    id, title: trimmed.slice(0, 200), start_step_id: "", is_active: false, created_at: nowIso(),
  };
  await putEntity(spreadsheetId, FLOWS_TAB, id, flow);
  return flow;
}

export async function updateFlow(
  spreadsheetId: string, id: string,
  changes: Partial<Pick<GuidedFlow, "title" | "start_step_id" | "is_active">>,
): Promise<GuidedFlow> {
  await assertSheetsAuthoritative(FLOWS_TAB);
  const current = await getFlow(spreadsheetId, id);
  if (!current) throw new BotConfigError(404, "این گفت‌وگو پیدا نشد.", "flow_not_found");

  const next: GuidedFlow = { ...current, updated_at: nowIso() };
  if (changes.title !== undefined) {
    const trimmed = changes.title.trim();
    if (!trimmed) throw new BotConfigError(400, "عنوانِ گفت‌وگو نمی‌تواند خالی باشد.", "bad_title");
    next.title = trimmed.slice(0, 200);
  }
  if (changes.start_step_id !== undefined) {
    if (changes.start_step_id) {
      const step = await getStep(spreadsheetId, changes.start_step_id);
      if (!step || step.flow_id !== id) {
        throw new BotConfigError(400, "گامِ شروع باید از همینِ گفت‌وگو باشد.", "bad_start_step");
      }
    }
    next.start_step_id = changes.start_step_id;
  }
  if (changes.is_active !== undefined) {
    if (changes.is_active && !next.start_step_id) {
      throw new BotConfigError(400, "این گفت‌وگو هنوز گامِ شروع ندارد.", "no_start_step");
    }
    next.is_active = Boolean(changes.is_active);
  }
  await putEntity(spreadsheetId, FLOWS_TAB, id, next);
  return next;
}

export async function deleteFlow(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(FLOWS_TAB);
  for (const step of await listSteps(spreadsheetId, id)) {
    await deleteStep(spreadsheetId, step.id);
  }
  return removeEntity(spreadsheetId, FLOWS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  Steps
// ══════════════════════════════════════════════════════════════════════════

function cleanOptions(raw: unknown): FlowOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FlowOption[] = [];
  for (const item of raw) {
    const label = String((item as any)?.label ?? "").trim();
    const value = String((item as any)?.value ?? "").trim();
    if (label && value) out.push({ label, value });
  }
  return out;
}

export async function listSteps(spreadsheetId: string, flowId: string): Promise<GuidedFlowStep[]> {
  const rows = await listEntity<GuidedFlowStep>(spreadsheetId, STEPS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as GuidedFlowStep).flow_id === flowId)
    .map((r) => ({ ...(r.value as GuidedFlowStep), id: r.key }))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

export async function getStep(spreadsheetId: string, id: string): Promise<GuidedFlowStep | null> {
  const value = await getEntity<GuidedFlowStep>(spreadsheetId, STEPS_TAB, id);
  return value ? { ...value, id } : null;
}

export interface CreateStepInput {
  flow_id: string;
  step_type: StepType;
  question_text?: string;
  options?: FlowOption[];
  media?: FlowMediaItem[];
  body_html?: string;
  buttons?: FlowButton[];
  default_to_step_id?: string;
}

export async function createStep(spreadsheetId: string, input: CreateStepInput): Promise<GuidedFlowStep> {
  await assertSheetsAuthoritative(STEPS_TAB);
  if (!STEP_TYPES.includes(input.step_type)) {
    throw new BotConfigError(400, "نوعِ گام معتبر نیست.", "bad_step_type");
  }
  const flow = await getFlow(spreadsheetId, input.flow_id);
  if (!flow) throw new BotConfigError(404, "این گفت‌وگو پیدا نشد.", "flow_not_found");

  const id = newId();
  const step: GuidedFlowStep = {
    id,
    flow_id: input.flow_id,
    step_type: input.step_type,
    question_text: (input.question_text ?? "").trim().slice(0, 500),
    options: input.step_type === "question" ? cleanOptions(input.options) : [],
    media: input.step_type === "result" ? (input.media ?? []) : [],
    body_html: input.step_type === "result" ? (input.body_html ?? "") : "",
    buttons: input.step_type === "result" ? (input.buttons ?? []) : [],
    default_to_step_id: input.default_to_step_id ?? "",
    created_at: nowIso(),
  };
  await putEntity(spreadsheetId, STEPS_TAB, id, step);
  return step;
}

export interface UpdateStepInput {
  question_text?: string;
  options?: FlowOption[];
  media?: FlowMediaItem[];
  body_html?: string;
  buttons?: FlowButton[];
  default_to_step_id?: string;
}

export async function updateStep(
  spreadsheetId: string, id: string, changes: UpdateStepInput,
): Promise<GuidedFlowStep> {
  await assertSheetsAuthoritative(STEPS_TAB);
  const current = await getStep(spreadsheetId, id);
  if (!current) throw new BotConfigError(404, "این گام پیدا نشد.", "step_not_found");

  const next: GuidedFlowStep = { ...current, updated_at: nowIso() };
  if (changes.question_text !== undefined) next.question_text = changes.question_text.trim().slice(0, 500);
  if (changes.options !== undefined) next.options = cleanOptions(changes.options);
  if (changes.media !== undefined) next.media = changes.media;
  if (changes.body_html !== undefined) next.body_html = changes.body_html;
  if (changes.buttons !== undefined) next.buttons = changes.buttons;
  if (changes.default_to_step_id !== undefined) next.default_to_step_id = changes.default_to_step_id;
  await putEntity(spreadsheetId, STEPS_TAB, id, next);
  return next;
}

export async function deleteStep(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(STEPS_TAB);
  const step = await getStep(spreadsheetId, id);
  if (!step) return false;

  // transitionهایی که از یا به این گام می‌روند هم حذف می‌شوند — دقیقاً همان
  // cascadeای که domain.py::delete_step انجام می‌دهد.
  const allTransitions = await listEntity<GuidedFlowTransition>(spreadsheetId, TRANSITIONS_TAB);
  for (const row of allTransitions) {
    const t = row.value as GuidedFlowTransition;
    if (t && (t.from_step_id === id || t.to_step_id === id)) {
      await removeEntity(spreadsheetId, TRANSITIONS_TAB, row.key);
    }
  }
  // اگر این گام، گامِ شروعِ flow بود، آن flow هم start_step_id را خالی
  // می‌کند و غیرفعال می‌شود — یک flow نباید به یک گامِ نابودشده اشاره کند.
  const flow = await getFlow(spreadsheetId, step.flow_id);
  if (flow && flow.start_step_id === id) {
    await putEntity(spreadsheetId, FLOWS_TAB, flow.id, {
      ...flow, start_step_id: "", is_active: false, updated_at: nowIso(),
    });
  }
  return removeEntity(spreadsheetId, STEPS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  Transitions
// ══════════════════════════════════════════════════════════════════════════

export async function listTransitions(spreadsheetId: string, fromStepId: string): Promise<GuidedFlowTransition[]> {
  const rows = await listEntity<GuidedFlowTransition>(spreadsheetId, TRANSITIONS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as GuidedFlowTransition).from_step_id === fromStepId)
    .map((r) => ({ ...(r.value as GuidedFlowTransition), id: r.key }))
    .sort((a, b) => {
      const byPriority = Number(a.priority ?? 0) - Number(b.priority ?? 0);
      if (byPriority !== 0) return byPriority;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });
}

export async function getTransition(spreadsheetId: string, id: string): Promise<GuidedFlowTransition | null> {
  const value = await getEntity<GuidedFlowTransition>(spreadsheetId, TRANSITIONS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createTransition(
  spreadsheetId: string, fromStepId: string, toStepId: string,
  condition: FlowCondition = {}, priority = 0,
): Promise<GuidedFlowTransition> {
  await assertSheetsAuthoritative(TRANSITIONS_TAB);
  const [fromStep, toStep] = await Promise.all([
    getStep(spreadsheetId, fromStepId), getStep(spreadsheetId, toStepId),
  ]);
  if (!fromStep || !toStep) throw new BotConfigError(404, "گامِ مبدأ یا مقصد پیدا نشد.", "step_not_found");
  if (fromStep.flow_id !== toStep.flow_id) {
    throw new BotConfigError(400, "مبدأ و مقصد باید از همینِ گفت‌وگو باشند.", "cross_flow_transition");
  }

  const id = newId();
  const transition: GuidedFlowTransition = {
    id, from_step_id: fromStepId, to_step_id: toStepId,
    condition: condition ?? {}, priority: Math.trunc(Number(priority) || 0),
    created_at: nowIso(),
  };
  await putEntity(spreadsheetId, TRANSITIONS_TAB, id, transition);
  return transition;
}

export async function updateTransition(
  spreadsheetId: string, id: string,
  changes: Partial<Pick<GuidedFlowTransition, "to_step_id" | "condition" | "priority">>,
): Promise<GuidedFlowTransition> {
  await assertSheetsAuthoritative(TRANSITIONS_TAB);
  const current = await getTransition(spreadsheetId, id);
  if (!current) throw new BotConfigError(404, "این یال پیدا نشد.", "transition_not_found");

  const next: GuidedFlowTransition = { ...current, updated_at: nowIso() };
  if (changes.to_step_id !== undefined) {
    const toStep = await getStep(spreadsheetId, changes.to_step_id);
    const fromStep = await getStep(spreadsheetId, current.from_step_id);
    if (!toStep || !fromStep || toStep.flow_id !== fromStep.flow_id) {
      throw new BotConfigError(400, "مقصد باید از همینِ گفت‌وگو باشد.", "cross_flow_transition");
    }
    next.to_step_id = changes.to_step_id;
  }
  if (changes.condition !== undefined) next.condition = changes.condition;
  if (changes.priority !== undefined) next.priority = Math.trunc(Number(changes.priority) || 0);
  await putEntity(spreadsheetId, TRANSITIONS_TAB, id, next);
  return next;
}

export async function deleteTransition(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(TRANSITIONS_TAB);
  return removeEntity(spreadsheetId, TRANSITIONS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  Sessions — فقط خواندن (آمار)؛ ساخت/تغییرشان کارِ باتِ در حالِ اجراست
// ══════════════════════════════════════════════════════════════════════════

export async function listSessions(spreadsheetId: string, flowId: string): Promise<GuidedFlowSession[]> {
  const rows = await listEntity<GuidedFlowSession>(spreadsheetId, SESSIONS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as GuidedFlowSession).flow_id === flowId)
    .map((r) => ({ ...(r.value as GuidedFlowSession), id: r.key }));
}

export interface FlowStats {
  sessions: number;
  completed: number;
}

export async function flowStats(spreadsheetId: string, flowId: string): Promise<FlowStats> {
  const sessions = await listSessions(spreadsheetId, flowId);
  return { sessions: sessions.length, completed: sessions.filter((s) => Boolean(s.completed_at)).length };
}
