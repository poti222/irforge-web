/**
 * lib/dripStore.ts — IRFORGE_PROMPT_V3 Phase 19
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `drip` plugin's `drip_campaigns` /
 * `drip_deliveries` tabs — the TypeScript sibling of `plugins/drip/domain.py`.
 * A dedicated store (not the generic `pluginCollections.ts` system) because
 * the editor needs a schedule-type picker, a Jalali date/time input, a
 * button/media capture, and an audience picker that the generic field types
 * don't cover — the same reasoning as `bookingStore.ts`/`addressStore.ts`.
 *
 * The bot process remains the sender: this store only writes rows to the
 * same sheet tabs `plugins/drip/domain.py` reads, on the same schedule/field
 * contract (`SCHEDULE_TYPES`, `AUDIENCE_MODES`, `MEDIA_SEND_METHOD` keys,
 * `recurring_days`'s 0=Monday convention). Moving the actual delivery onto
 * the website (like broadcast's `routes/botBroadcast.ts` does) would be a
 * separate, much larger migration of the whole scheduler — out of scope
 * here, matching the same scoping call already made for the claim/queue
 * mechanism in `plugins/drip/domain.py`'s own docstring.
 *
 * The one thing this store DOES send directly (via `tgApi`) is the "test
 * send to myself" action — a synchronous, on-demand echo that bypasses the
 * queue entirely, so it doesn't belong to the bot's scheduled pipeline.
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso, newButton, normalizeButtonLayout, MAX_BUTTONS_PER_ROW, type PanelButton } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";
import { resolveTelegramUser } from "./telegramResolve.js";
import { tgApi } from "./telegram.js";
import { db, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptToken } from "./tokenCrypto.js";

const CAMPAIGNS_TAB = "drip_campaigns";
const DELIVERIES_TAB = "drip_deliveries";
const SETTINGS_TAB = "bot_settings";
const SAFETY_CFG_KEY = "drip_safety_cfg";

export const SCHEDULE_TYPES = ["event", "datetime", "recurring"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const AUDIENCE_MODES = ["all_users", "segment", "single_chat"] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

/** آینه‌ی `MEDIA_SEND_METHOD` در `plugins/drip/domain.py` — کلیدهای معتبرِ media_type. */
export const MEDIA_TYPES = ["photo", "video", "audio", "document", "voice"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

const MAX_DELAY_MINUTES = 60 * 24 * 90; // ۹۰ روز — همان سقفِ بات

export interface DripCampaign {
  id: string;
  title: string;
  schedule_type: ScheduleType;
  trigger_event: string;
  delay_minutes: number;
  once_per_user: boolean;
  run_at: string;
  fired_at: string;
  recurring_days: number[];
  recurring_time: string;
  recurring_end_date: string;
  last_recurring_run_date: string;
  message: string;
  media_file_id: string;
  media_type: string;
  buttons: PanelButton[];
  audience_mode: AudienceMode;
  audience_value: string;
  is_active: boolean;
  queued_count: number;
  sent_count: number;
  created_at?: string;
  updated_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isGregorianDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/**
 * Validates a create/update body into a clean partial `DripCampaign`.
 * `botId` is needed only to resolve a `single_chat` audience's @username/id
 * to a numeric chat id through Telegram at save time — the same point
 * broadcast and forced-join channels resolve identifiers, per
 * `telegramResolve.ts`'s own docstring on why resolving late is wrong.
 */
export async function parseCampaignInput(
  botId: string,
  body: any,
  { partial }: { partial: boolean }
): Promise<Partial<DripCampaign>> {
  const out: Partial<DripCampaign> = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title ?? "").trim();
    if (!title) throw bad("نام کمپین نمی‌تواند خالی باشد.", "bad_title");
    out.title = title.slice(0, 80);
  }
  if (!partial || body.message !== undefined) {
    const message = String(body.message ?? "").trim();
    if (!message) throw bad("متن پیام نمی‌تواند خالی باشد.", "bad_message");
    out.message = message.slice(0, 3000);
  }
  if (body.once_per_user !== undefined) out.once_per_user = Boolean(body.once_per_user);
  if (body.is_active !== undefined) out.is_active = Boolean(body.is_active);

  const scheduleType: ScheduleType | undefined = body.schedule_type;
  if (!partial || scheduleType !== undefined) {
    if (!SCHEDULE_TYPES.includes(scheduleType as ScheduleType))
      throw bad("نوع زمان‌بندی نامعتبر است.", "bad_schedule_type");
    out.schedule_type = scheduleType as ScheduleType;
  }
  const effectiveScheduleType = out.schedule_type;

  if (effectiveScheduleType === "event" || (partial && body.trigger_event !== undefined)) {
    const triggerEvent = String(body.trigger_event ?? "").trim();
    if (effectiveScheduleType === "event" && !triggerEvent)
      throw bad("رویداد محرک نمی‌تواند خالی باشد.", "bad_trigger_event");
    out.trigger_event = triggerEvent.slice(0, 80);
  }
  if (effectiveScheduleType === "event" || (partial && body.delay_minutes !== undefined)) {
    const delay = Number(body.delay_minutes ?? 0);
    if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_MINUTES)
      throw bad(`تأخیر باید بین ۰ و ${MAX_DELAY_MINUTES} دقیقه باشد.`, "bad_delay");
    out.delay_minutes = Math.round(delay);
  }

  if (effectiveScheduleType === "datetime" || (partial && body.run_at !== undefined)) {
    const runAt = String(body.run_at ?? "");
    const parsed = new Date(runAt);
    if (effectiveScheduleType === "datetime" && (!runAt || Number.isNaN(parsed.getTime())))
      throw bad("زمانِ اجرا معتبر نیست.", "bad_run_at");
    out.run_at = runAt ? parsed.toISOString() : "";
  }

  if (effectiveScheduleType === "recurring" || (partial && body.recurring_days !== undefined)) {
    const days: number[] = Array.isArray(body.recurring_days) ? body.recurring_days.map((d: any) => Number(d)) : [];
    const valid = days.every((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (effectiveScheduleType === "recurring" && (!valid || days.length === 0))
      throw bad("روزهای تکرار نامعتبر است.", "bad_recurring_days");
    out.recurring_days = [...new Set(days)].sort((a, b) => a - b);
  }
  if (effectiveScheduleType === "recurring" || (partial && body.recurring_time !== undefined)) {
    const time = String(body.recurring_time ?? "");
    if (effectiveScheduleType === "recurring" && !isHHMM(time))
      throw bad("ساعتِ تکرار باید به شکل HH:MM باشد.", "bad_recurring_time");
    out.recurring_time = time;
  }
  if (body.recurring_end_date !== undefined) {
    const endDate = String(body.recurring_end_date ?? "");
    if (endDate && !isGregorianDateString(endDate))
      throw bad("تاریخ پایانِ تکرار نامعتبر است.", "bad_recurring_end_date");
    out.recurring_end_date = endDate;
  }

  if (body.media_file_id !== undefined || body.media_type !== undefined) {
    const mediaFileId = String(body.media_file_id ?? "").trim();
    const mediaType = String(body.media_type ?? "").trim();
    if (mediaFileId && !MEDIA_TYPES.includes(mediaType as MediaType))
      throw bad("نوع رسانه نامعتبر است.", "bad_media_type");
    out.media_file_id = mediaFileId;
    out.media_type = mediaFileId ? mediaType : "";
  }

  if (body.buttons !== undefined) {
    const raw = Array.isArray(body.buttons) ? body.buttons : [];
    // همان قراردادِ `routes/botPanels.ts`: از `newButton()` عبور بده تا
    // پیش‌فرض‌ها (از جمله row_start=true وقتی کلاینت نفرستاده) دقیقاً یکی
    // باشند — یک دکمه‌ی تازه بدون row_start صریح، خودش سرِ یک ردیف جدید است.
    const normalized = normalizeButtonLayout(
      raw.map((b: any) => newButton({
        label: String(b?.label ?? "").slice(0, 64),
        action: String(b?.action ?? "callback"),
        value: String(b?.value ?? ""),
        row: Number(b?.row ?? 0),
        col: Number(b?.col ?? 0),
        row_start: b?.row_start === undefined ? undefined : Boolean(b.row_start),
        style: String(b?.style ?? ""),
      }))
    );
    const perRow = new Map<number, number>();
    for (const b of normalized) perRow.set(b.row, (perRow.get(b.row) ?? 0) + 1);
    for (const [row, count] of perRow) {
      if (count > MAX_BUTTONS_PER_ROW)
        throw bad(`ردیف ${row + 1} بیش از ${MAX_BUTTONS_PER_ROW} دکمه دارد؛ تلگرام آن را درست نشان نمی‌دهد.`, "row_too_full");
    }
    out.buttons = normalized;
  }

  const audienceMode: AudienceMode | undefined = body.audience_mode;
  if (!partial || audienceMode !== undefined) {
    if (!AUDIENCE_MODES.includes(audienceMode as AudienceMode))
      throw bad("نوع مخاطب نامعتبر است.", "bad_audience_mode");
    out.audience_mode = audienceMode as AudienceMode;
  }
  if (out.audience_mode === "single_chat" || (partial && body.audience_value !== undefined)) {
    const raw = String(body.audience_value ?? "").trim();
    if (out.audience_mode === "single_chat" && !raw)
      throw bad("شناسه‌ی chat مقصد را وارد کنید.", "bad_audience_value");
    out.audience_value = raw ? (await resolveTelegramUser(botId, raw)).userId : "";
  } else if (out.audience_mode) {
    out.audience_value = "";
  }

  return out;
}

export async function listCampaigns(spreadsheetId: string): Promise<DripCampaign[]> {
  const rows = await listEntity<DripCampaign>(spreadsheetId, CAMPAIGNS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as DripCampaign), id: r.key }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export async function getCampaign(spreadsheetId: string, id: string): Promise<DripCampaign | null> {
  const value = await getEntity<DripCampaign>(spreadsheetId, CAMPAIGNS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createCampaign(spreadsheetId: string, botId: string, body: any): Promise<DripCampaign> {
  await assertSheetsAuthoritative(CAMPAIGNS_TAB);
  const parsed = await parseCampaignInput(botId, body, { partial: false });
  const id = newRecordId("drp");
  const record: DripCampaign = {
    id,
    title: parsed.title!,
    schedule_type: parsed.schedule_type!,
    trigger_event: parsed.trigger_event ?? "",
    delay_minutes: parsed.delay_minutes ?? 0,
    once_per_user: parsed.once_per_user ?? true,
    run_at: parsed.run_at ?? "",
    fired_at: "",
    recurring_days: parsed.recurring_days ?? [],
    recurring_time: parsed.recurring_time ?? "",
    recurring_end_date: parsed.recurring_end_date ?? "",
    last_recurring_run_date: "",
    message: parsed.message!,
    media_file_id: parsed.media_file_id ?? "",
    media_type: parsed.media_type ?? "",
    buttons: parsed.buttons ?? [],
    audience_mode: parsed.audience_mode!,
    audience_value: parsed.audience_value ?? "",
    is_active: parsed.is_active ?? true,
    queued_count: 0,
    sent_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, CAMPAIGNS_TAB, id, record);
  return record;
}

export async function updateCampaign(
  spreadsheetId: string, botId: string, id: string, body: any
): Promise<DripCampaign> {
  await assertSheetsAuthoritative(CAMPAIGNS_TAB);
  const existing = await getCampaign(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این کمپین پیدا نشد.", "campaign_not_found");

  const parsed = await parseCampaignInput(botId, body, { partial: true });
  const next: DripCampaign = { ...existing, ...parsed, id, updated_at: nowIso() };
  await putEntity(spreadsheetId, CAMPAIGNS_TAB, id, next);
  return next;
}

export async function toggleCampaign(spreadsheetId: string, id: string): Promise<DripCampaign> {
  await assertSheetsAuthoritative(CAMPAIGNS_TAB);
  const existing = await getCampaign(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این کمپین پیدا نشد.", "campaign_not_found");
  const next: DripCampaign = { ...existing, is_active: !existing.is_active, updated_at: nowIso() };
  await putEntity(spreadsheetId, CAMPAIGNS_TAB, id, next);
  return next;
}

/** کمپین + صفِ ارسالش — دقیقاً همان `dm.delete()` بات. */
export async function deleteCampaign(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(CAMPAIGNS_TAB);
  const deliveries = await listEntity<{ campaign_id?: string }>(spreadsheetId, DELIVERIES_TAB);
  for (const row of deliveries) {
    if (row.value && (row.value as any).campaign_id === id) {
      await removeEntity(spreadsheetId, DELIVERIES_TAB, row.key);
    }
  }
  return removeEntity(spreadsheetId, CAMPAIGNS_TAB, id);
}

export interface DripStats {
  campaigns: number;
  active: number;
  pending: number;
  sent: number;
  failed: number;
}

export async function getStats(spreadsheetId: string): Promise<DripStats> {
  const campaigns = await listCampaigns(spreadsheetId);
  const deliveries = await listEntity<{ status?: string }>(spreadsheetId, DELIVERIES_TAB);
  const statuses = deliveries.map((r) => (r.value as any)?.status);
  return {
    campaigns: campaigns.length,
    active: campaigns.filter((c) => c.is_active).length,
    pending: statuses.filter((s) => s === "pending").length,
    sent: statuses.filter((s) => s === "sent").length,
    failed: statuses.filter((s) => s === "failed").length,
  };
}

// ── ایمنیِ ارسال — ساعاتِ آرام + سقفِ تناوب (bot_settings["drip_safety_cfg"]) ──

export interface DripSafetyConfig {
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  frequency_cap_enabled: boolean;
  max_per_user_per_hour: number;
}

const DEFAULT_SAFETY_CFG: DripSafetyConfig = {
  quiet_hours_enabled: true,
  quiet_start: "23:00",
  quiet_end: "08:00",
  frequency_cap_enabled: true,
  max_per_user_per_hour: 3,
};

export async function getSafetyConfig(spreadsheetId: string): Promise<DripSafetyConfig> {
  const raw = await getEntity<Partial<DripSafetyConfig>>(spreadsheetId, SETTINGS_TAB, SAFETY_CFG_KEY);
  return { ...DEFAULT_SAFETY_CFG, ...(raw ?? {}) };
}

export async function setSafetyConfig(spreadsheetId: string, body: any): Promise<DripSafetyConfig> {
  await assertSheetsAuthoritative(SETTINGS_TAB);
  const current = await getSafetyConfig(spreadsheetId);
  const quietStart = body.quiet_start !== undefined ? String(body.quiet_start) : current.quiet_start;
  const quietEnd = body.quiet_end !== undefined ? String(body.quiet_end) : current.quiet_end;
  if (!isHHMM(quietStart) || !isHHMM(quietEnd)) throw bad("ساعتِ آرام باید به شکل HH:MM باشد.", "bad_quiet_hours");
  const cap = body.max_per_user_per_hour !== undefined ? Number(body.max_per_user_per_hour) : current.max_per_user_per_hour;
  if (!Number.isFinite(cap) || cap < 0 || cap > 1000) throw bad("سقفِ تناوب نامعتبر است.", "bad_frequency_cap");

  const next: DripSafetyConfig = {
    quiet_hours_enabled: body.quiet_hours_enabled !== undefined ? Boolean(body.quiet_hours_enabled) : current.quiet_hours_enabled,
    quiet_start: quietStart,
    quiet_end: quietEnd,
    frequency_cap_enabled: body.frequency_cap_enabled !== undefined ? Boolean(body.frequency_cap_enabled) : current.frequency_cap_enabled,
    max_per_user_per_hour: Math.round(cap),
  };
  await putEntity(spreadsheetId, SETTINGS_TAB, SAFETY_CFG_KEY, next);
  return next;
}

// ── تستِ ارسال به خودم ──────────────────────────────────────────────────────
//
// این تنها مسیریست که این ماژول واقعاً به تلگرام پیام می‌فرستد — یک اکوی
// فوری و همزمان، بیرون از صفِ بات. بقیه‌ی ارسال‌های واقعی همچنان کارِ
// `plugins/drip/handlers.py::flush_due` است (نگاه کن به docstring بالای فایل).

async function botToken(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    const token = decryptToken(bot?.token ?? "");
    if (token) return token;
  } catch {
    /* falls through */
  }
  throw new BotConfigError(409, "توکن این بات روی سرور در دسترس نیست، پس ارسال تست ممکن نیست.", "no_token");
}

function buttonKwargs(button: PanelButton): Record<string, unknown> {
  if (button.action === "url" && button.value) return { url: button.value };
  return { callback_data: String(button.value || "noop").slice(0, 64) };
}

function buildInlineKeyboard(buttons: PanelButton[]): { inline_keyboard: Array<Array<Record<string, unknown>>> } | undefined {
  if (!buttons.length) return undefined;
  const rows = new Map<number, PanelButton[]>();
  for (const b of buttons) {
    if (!rows.has(b.row)) rows.set(b.row, []);
    rows.get(b.row)!.push(b);
  }
  const orderedRows = [...rows.keys()].sort((a, b) => a - b);
  return {
    inline_keyboard: orderedRows.map((row) =>
      rows.get(row)!.map((b) => ({ text: b.label.slice(0, 64) || "—", ...buttonKwargs(b) }))
    ),
  };
}

const MEDIA_TG_METHOD: Record<string, string> = {
  photo: "sendPhoto", video: "sendVideo", audio: "sendAudio", document: "sendDocument", voice: "sendVoice",
};
const MEDIA_TG_FIELD: Record<string, string> = {
  photo: "photo", video: "video", audio: "audio", document: "document", voice: "voice",
};

/** ارسال واقعیِ متن + رسانه (اگر بود) + دکمه (اگر بود) به یک chat — همان قراردادِ `send_campaign_message` پایتون. */
export async function sendTestMessage(botId: string, chatId: string, campaign: DripCampaign): Promise<void> {
  const token = await botToken(botId);
  const markup = buildInlineKeyboard(campaign.buttons ?? []);
  const method = campaign.media_file_id ? MEDIA_TG_METHOD[campaign.media_type] : "sendMessage";
  const field = campaign.media_file_id ? MEDIA_TG_FIELD[campaign.media_type] : null;

  const payload: Record<string, unknown> = { chat_id: chatId };
  if (field) {
    payload[field] = campaign.media_file_id;
    if (campaign.message) payload.caption = campaign.message.slice(0, 1024);
  } else {
    payload.text = campaign.message || "—";
  }
  if (markup) payload.reply_markup = markup;

  const sent = await tgApi(token, method ?? "sendMessage", payload);
  if (!sent.ok) {
    throw new BotConfigError(409, `تلگرام پیام تست را نپذیرفت: ${sent.description ?? "خطای نامشخص"}`, "telegram_rejected");
  }
}

/** یوزرنیم/آی‌دی مقصدِ تست را به chat id عددی برمی‌گرداند — همان مسیرِ single_chat. */
export async function resolveTestTarget(botId: string, target: string): Promise<string> {
  const resolved = await resolveTelegramUser(botId, target);
  return resolved.userId;
}
