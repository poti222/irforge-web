/**
 * lib/postboxStore.ts — IRFORGE_POSTBOX_PROMPT Phase B1
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `autoposter` plugin's "Post Studio" tabs
 * (postbox_messages/postbox_translations/postbox_buttons/postbox_targets),
 * mirroring `plugins/autoposter/domain.py` (irforge-app) field-for-field and
 * validation-for-validation — same convention `catalogStore.ts` already
 * established for `catalog`.
 *
 * Two things this store does NOT do, both by architecture, not oversight:
 *
 *   1. It never calls Telegram. The website has no bot token and no running
 *      aiogram process — only the bot can actually call `copyMessage`/
 *      `editMessageReplyMarkup`. `publishMessage()` below only writes new
 *      `postbox_targets` rows with `status: "queued"`; the bot's own
 *      `flush_publish_queue()` (registered at a 30s floor,
 *      `plugins/autoposter/publish.py`) already polls that exact tab and
 *      picks them up with zero bot-side code change needed. `requestButtonEdit()`
 *      similarly just flips `postbox_messages.buttons_dirty` — see that
 *      function's own docstring for the matching bot-side sweep this
 *      required (Phase A8, `flush_publish_queue`'s own extra sweep).
 *
 *   2. IDs are NOT the site's own `newRecordId()` (`lib/pluginCollections.ts`
 *      — 12 hex chars with an underscore before them). `postbox_messages.id`
 *      and `postbox_translations.id`/`lang_code` are the exact strings a
 *      Telegram `/start` deep-link payload embeds
 *      (`tr_<message_id>_<lang_code>`, `plugins/autoposter/delivery.py`),
 *      and `handlers/user.py`'s `sanitize_deep_link_payload()` silently
 *      rewrites any dash to an underscore before the bot ever parses the
 *      prefix — a website-created id with `newRecordId()`'s own underscore
 *      would immediately break that split. `_shortId()` below is a
 *      byte-for-byte port of `domain.py::_short_id()`: prefix + 6 base36
 *      chars, no separator, collision-checked against the live tab.
 */
import {
  getEntity, putEntity, putEntities, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { sanitizeTelegramHtml } from "./catalogHtml.js";

const MESSAGES_TAB = "postbox_messages";
const TRANSLATIONS_TAB = "postbox_translations";
const BUTTONS_TAB = "postbox_buttons";
const TARGETS_TAB = "postbox_targets";

export const SOURCE_TYPES = ["composed", "forwarded"] as const;
export const TRANSLATION_STATUSES = ["draft", "ready"] as const;
export const BUTTON_STYLES = ["default", "primary", "success", "danger"] as const;
export const BUTTON_KINDS = ["url", "panel", "miniapp", "translation"] as const;
export const TARGET_STATUSES = ["queued", "sending", "sent", "failed"] as const;

// Rate-limit constants -- kept in sync with plugins/autoposter/publish.py's
// own RATE_LIMIT_PER_MINUTE/SLOW_MODE_PER_DAY_LIMIT, duplicated (not
// imported -- different language/runtime) purely so the publish dialog can
// show a same-ballpark ETA; the bot's own flush loop is the real authority
// on when a target actually sends.
const RATE_LIMIT_PER_MINUTE = 5;
const SLOW_MODE_PER_DAY_LIMIT = 20;

export interface PostboxMessage {
  id: string;
  title: string;
  source_type: (typeof SOURCE_TYPES)[number];
  src_chat_id: string;
  src_message_id: string;
  body_html: string;
  preview_text: string;
  preview_media: string;
  media_group_id: string;
  is_album: boolean;
  /** Phase A8 -- set true by requestButtonEdit(), cleared by the bot once it re-edits every sent target. */
  buttons_dirty: boolean;
  created_at: string;
  updated_at: string;
}

export interface PostboxTranslation {
  id: string;
  message_id: string;
  lang_code: string;
  lang_label: string;
  body_html: string;
  status: (typeof TRANSLATION_STATUSES)[number];
  created_at: string;
  updated_at: string;
}

export interface PostboxButton {
  id: string;
  message_id: string;
  row: number;
  col: number;
  label: string;
  style: (typeof BUTTON_STYLES)[number];
  kind: (typeof BUTTON_KINDS)[number];
  target: string;
  /** RecordStore.create()/update() (irforge-app) stamp these on every row regardless of the declared `fields` tuple -- kept here for the same reason. */
  created_at: string;
  updated_at?: string;
}

export interface PostboxTarget {
  id: string;
  message_id: string;
  channel_id: string;
  channel_title: string;
  status: (typeof TARGET_STATUSES)[number];
  sent_message_id: string;
  button_message_id: string;
  error: string;
  queued_at: string;
  sent_at: string;
  slow_mode: boolean;
  created_at: string;
  updated_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Port of domain.py's `_short_id()` -- see this file's header for why. */
async function shortId(spreadsheetId: string, tab: string, prefix: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    let rand = "";
    for (let j = 0; j < 6; j++) rand += BASE36[Math.floor(Math.random() * 36)];
    const candidate = prefix + rand;
    if ((await getEntity(spreadsheetId, tab, candidate)) === null) return candidate;
  }
  throw bad("امکانِ ساختِ شناسه‌ی یکتا نبود.", "id_generation_failed");
}

async function readAll<T>(spreadsheetId: string, tab: string): Promise<T[]> {
  try {
    const rows = await listEntity<T>(spreadsheetId, tab);
    return rows
      .filter((r) => r.value && typeof r.value === "object" && !Array.isArray(r.value))
      .map((r) => ({ ...(r.value as any), id: r.key }));
  } catch {
    // Plugin tabs are lazily created on the bot side -- absence means "no rows yet", not an error.
    return [];
  }
}

function sortByCreatedAt<T extends { created_at?: string }>(rows: T[], desc: boolean): T[] {
  return [...rows].sort((a, b) => {
    const cmp = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    return desc ? -cmp : cmp;
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Messages
// ══════════════════════════════════════════════════════════════════════════

export async function listMessages(spreadsheetId: string): Promise<PostboxMessage[]> {
  return sortByCreatedAt<PostboxMessage>(await readAll<PostboxMessage>(spreadsheetId, MESSAGES_TAB), true);
}

export async function getMessage(spreadsheetId: string, id: string): Promise<PostboxMessage | null> {
  const row = await getEntity<Omit<PostboxMessage, "id">>(spreadsheetId, MESSAGES_TAB, id);
  return row ? { ...row, id } : null;
}

/**
 * The website can only ever create a "composed" (text-only, no forwarded
 * source) message -- a "forwarded" one only ever comes from the bot's own
 * `on_forward()` ingestion (`plugins/autoposter/handlers.py`), which is the
 * only place that legitimately owns a real `src_chat_id`/`src_message_id`.
 */
export async function createComposedMessage(
  spreadsheetId: string, body: any,
): Promise<PostboxMessage> {
  await assertSheetsAuthoritative(MESSAGES_TAB);
  const title = String(body?.title ?? "").trim();
  const bodyHtml = sanitizeTelegramHtml(String(body?.body_html ?? ""));
  if (!bodyHtml.trim()) throw bad("متنِ پیام نمی‌تواند خالی باشد.", "body_required");

  const id = await shortId(spreadsheetId, MESSAGES_TAB, "pm");
  const message: PostboxMessage = {
    id, title, source_type: "composed", src_chat_id: "", src_message_id: "",
    body_html: bodyHtml, preview_text: "", preview_media: "", media_group_id: "",
    is_album: false, buttons_dirty: false, created_at: nowIso(), updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, MESSAGES_TAB, id, message);
  return message;
}

/** Only a composed message's own title/body_html can be edited from the site -- a forwarded message's content lives on Telegram, not here. */
export async function updateComposedMessage(spreadsheetId: string, id: string, body: any): Promise<PostboxMessage> {
  await assertSheetsAuthoritative(MESSAGES_TAB);
  const existing = await getMessage(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این پیام پیدا نشد.", "message_not_found");
  if (existing.source_type !== "composed")
    throw new BotConfigError(405, "محتوایِ یک پیامِ فورواردشده از سایت قابلِ ویرایش نیست.", "not_composed");

  const changes: Partial<PostboxMessage> = { updated_at: nowIso() };
  if ("title" in body) changes.title = String(body.title ?? "").trim();
  if ("body_html" in body) {
    const bodyHtml = sanitizeTelegramHtml(String(body.body_html ?? ""));
    if (!bodyHtml.trim()) throw bad("متنِ پیام نمی‌تواند خالی باشد.", "body_required");
    changes.body_html = bodyHtml;
  }
  const message = { ...existing, ...changes };
  await putEntity(spreadsheetId, MESSAGES_TAB, id, message);
  return message;
}

/** Cascades to this message's own translations/buttons/targets -- same as domain.py::delete_message, to avoid orphan rows a later phase could misread. */
export async function deleteMessage(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(MESSAGES_TAB);
  const [translations, buttons, targets] = await Promise.all([
    listTranslations(spreadsheetId, id),
    listButtons(spreadsheetId, id),
    listTargets(spreadsheetId, id),
  ]);
  for (const t of translations) await removeEntity(spreadsheetId, TRANSLATIONS_TAB, t.id);
  for (const b of buttons) await removeEntity(spreadsheetId, BUTTONS_TAB, b.id);
  for (const tg of targets) await removeEntity(spreadsheetId, TARGETS_TAB, tg.id);
  return removeEntity(spreadsheetId, MESSAGES_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  Translations
// ══════════════════════════════════════════════════════════════════════════

// Same regex as domain.py's `_LANG_CODE_RE` -- lang_code sits in the deep-link payload too.
const LANG_CODE_RE = /^[a-z0-9]{2,10}$/;

function normalizeLangCode(raw: unknown): string {
  const code = String(raw ?? "").trim().toLowerCase();
  if (!LANG_CODE_RE.test(code))
    throw bad("کدِ زبان باید حروفِ کوچک/عدد، بدونِ خط‌تیره، بینِ ۲ تا ۱۰ کاراکتر باشد.", "bad_lang_code");
  return code;
}

function normalizeTranslationStatus(raw: unknown): (typeof TRANSLATION_STATUSES)[number] {
  const status = String(raw ?? "draft");
  if (!(TRANSLATION_STATUSES as readonly string[]).includes(status))
    throw bad(`status نامعتبر: ${status}`, "bad_status");
  return status as (typeof TRANSLATION_STATUSES)[number];
}

export async function listTranslations(spreadsheetId: string, messageId: string): Promise<PostboxTranslation[]> {
  const rows = await readAll<PostboxTranslation>(spreadsheetId, TRANSLATIONS_TAB);
  return sortByCreatedAt<PostboxTranslation>(rows.filter((r) => r.message_id === messageId), false);
}

export async function createTranslation(spreadsheetId: string, messageId: string, body: any): Promise<PostboxTranslation> {
  await assertSheetsAuthoritative(TRANSLATIONS_TAB);
  if (!(await getMessage(spreadsheetId, messageId)))
    throw new BotConfigError(404, "پیامِ مبدأ پیدا نشد.", "message_not_found");

  const langCode = normalizeLangCode(body?.lang_code);
  const existing = (await listTranslations(spreadsheetId, messageId)).find((t) => t.lang_code === langCode);
  if (existing) throw bad("این زبان قبلاً برایِ این پیام ثبت شده.", "lang_already_exists");

  const id = await shortId(spreadsheetId, TRANSLATIONS_TAB, "pt");
  const translation: PostboxTranslation = {
    id, message_id: messageId, lang_code: langCode,
    lang_label: String(body?.lang_label ?? "").trim(),
    body_html: sanitizeTelegramHtml(String(body?.body_html ?? "")),
    status: normalizeTranslationStatus(body?.status ?? "draft"),
    created_at: nowIso(), updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, TRANSLATIONS_TAB, id, translation);
  return translation;
}

export async function updateTranslation(spreadsheetId: string, messageId: string, id: string, body: any): Promise<PostboxTranslation> {
  await assertSheetsAuthoritative(TRANSLATIONS_TAB);
  const existing = await getEntity<Omit<PostboxTranslation, "id">>(spreadsheetId, TRANSLATIONS_TAB, id);
  if (!existing || existing.message_id !== messageId)
    throw new BotConfigError(404, "این ترجمه پیدا نشد.", "translation_not_found");

  const changes: Partial<PostboxTranslation> = { updated_at: nowIso() };
  if ("lang_code" in body) {
    const langCode = normalizeLangCode(body.lang_code);
    const dupe = (await listTranslations(spreadsheetId, messageId)).find((t) => t.lang_code === langCode && t.id !== id);
    if (dupe) throw bad("این زبان قبلاً برایِ این پیام ثبت شده.", "lang_already_exists");
    changes.lang_code = langCode;
  }
  if ("lang_label" in body) changes.lang_label = String(body.lang_label ?? "").trim();
  if ("body_html" in body) changes.body_html = sanitizeTelegramHtml(String(body.body_html ?? ""));
  if ("status" in body) changes.status = normalizeTranslationStatus(body.status);

  const translation = { ...existing, ...changes, id, message_id: messageId };
  await putEntity(spreadsheetId, TRANSLATIONS_TAB, id, translation);
  return translation;
}

export async function deleteTranslation(spreadsheetId: string, messageId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(TRANSLATIONS_TAB);
  const existing = await getEntity<Omit<PostboxTranslation, "id">>(spreadsheetId, TRANSLATIONS_TAB, id);
  if (!existing || existing.message_id !== messageId) return false;
  return removeEntity(spreadsheetId, TRANSLATIONS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  Buttons
// ══════════════════════════════════════════════════════════════════════════

function normalizeButtonInput(body: any, existing?: PostboxButton): Pick<PostboxButton, "row" | "col" | "label" | "style" | "kind" | "target"> {
  const style = String(body?.style ?? existing?.style ?? "default");
  const kind = String(body?.kind ?? existing?.kind ?? "url");
  if (!(BUTTON_STYLES as readonly string[]).includes(style)) throw bad(`style نامعتبر: ${style}`, "bad_style");
  if (!(BUTTON_KINDS as readonly string[]).includes(kind)) throw bad(`kind نامعتبر: ${kind}`, "bad_kind");
  const label = String(body?.label ?? existing?.label ?? "").trim();
  if (!label) throw bad("متنِ دکمه نمی‌تواند خالی باشد.", "label_required");
  return {
    row: Number.isFinite(Number(body?.row)) ? Number(body.row) : (existing?.row ?? 0),
    col: Number.isFinite(Number(body?.col)) ? Number(body.col) : (existing?.col ?? 0),
    label, style: style as (typeof BUTTON_STYLES)[number], kind: kind as (typeof BUTTON_KINDS)[number],
    target: String(body?.target ?? existing?.target ?? ""),
  };
}

export async function listButtons(spreadsheetId: string, messageId: string): Promise<PostboxButton[]> {
  const rows = (await readAll<PostboxButton>(spreadsheetId, BUTTONS_TAB)).filter((r) => r.message_id === messageId);
  return rows.sort((a, b) => (Number(a.row) - Number(b.row)) || (Number(a.col) - Number(b.col)));
}

export async function createButton(spreadsheetId: string, messageId: string, body: any): Promise<PostboxButton> {
  await assertSheetsAuthoritative(BUTTONS_TAB);
  if (!(await getMessage(spreadsheetId, messageId)))
    throw new BotConfigError(404, "پیامِ مبدأ پیدا نشد.", "message_not_found");
  if (body?.kind === "translation" && body?.target) {
    const translation = await getEntity(spreadsheetId, TRANSLATIONS_TAB, String(body.target));
    if (!translation || (translation as any).message_id !== messageId)
      throw bad("ترجمه‌ی انتخاب‌شده برایِ این پیام پیدا نشد.", "translation_not_found");
  }
  const id = await shortId(spreadsheetId, BUTTONS_TAB, "pb");
  const button: PostboxButton = { id, message_id: messageId, ...normalizeButtonInput(body), created_at: nowIso() };
  await putEntity(spreadsheetId, BUTTONS_TAB, id, button);
  await requestButtonEdit(spreadsheetId, messageId);
  return button;
}

export async function updateButton(spreadsheetId: string, messageId: string, id: string, body: any): Promise<PostboxButton> {
  await assertSheetsAuthoritative(BUTTONS_TAB);
  const existing = await getEntity<Omit<PostboxButton, "id">>(spreadsheetId, BUTTONS_TAB, id);
  if (!existing || existing.message_id !== messageId)
    throw new BotConfigError(404, "این دکمه پیدا نشد.", "button_not_found");
  const button: PostboxButton = {
    ...(existing as PostboxButton), id, message_id: messageId,
    ...normalizeButtonInput(body, existing as PostboxButton), updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, BUTTONS_TAB, id, button);
  await requestButtonEdit(spreadsheetId, messageId);
  return button;
}

export async function deleteButton(spreadsheetId: string, messageId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(BUTTONS_TAB);
  const existing = await getEntity<Omit<PostboxButton, "id">>(spreadsheetId, BUTTONS_TAB, id);
  if (!existing || existing.message_id !== messageId) return false;
  const removed = await removeEntity(spreadsheetId, BUTTONS_TAB, id);
  if (removed) await requestButtonEdit(spreadsheetId, messageId);
  return removed;
}

// ══════════════════════════════════════════════════════════════════════════
//  Targets / publish / edit-buttons
// ══════════════════════════════════════════════════════════════════════════

export async function listTargets(spreadsheetId: string, messageId: string): Promise<PostboxTarget[]> {
  return sortByCreatedAt<PostboxTarget>(
    (await readAll<PostboxTarget>(spreadsheetId, TARGETS_TAB)).filter((r) => r.message_id === messageId),
    false,
  );
}

interface PublishChannel {
  channel_id: string;
  channel_title?: string;
}

/**
 * IRFORGE_POSTBOX_PROMPT Phase B2 — no "channel directory" exists anywhere
 * in this codebase (a channel is just whatever id the admin already typed
 * into `postbox_targets.channel_id` at some past publish); this scans that
 * same tab for distinct (channel_id, channel_title) pairs across every
 * message on this bot, most-recently-used first, purely so the publish
 * dialog can offer past channels instead of asking the admin to retype a
 * `-100…` id from memory every time. Not a source of truth for anything --
 * a channel the admin only ever typed once and never re-selects here is
 * still perfectly valid to type again by hand.
 */
export async function listKnownChannels(spreadsheetId: string): Promise<{ channel_id: string; channel_title: string }[]> {
  const targets = sortByCreatedAt<PostboxTarget>(await readAll<PostboxTarget>(spreadsheetId, TARGETS_TAB), true);
  const seen = new Map<string, string>();
  for (const t of targets) {
    if (!t.channel_id || seen.has(t.channel_id)) continue;
    seen.set(t.channel_id, t.channel_title || "");
  }
  return [...seen.entries()].map(([channel_id, channel_title]) => ({ channel_id, channel_title }));
}

/**
 * Phase B1's own guard: refuse the WHOLE publish (create zero target rows)
 * if any `kind: "translation"` button on this message points at a
 * missing/not-"ready" translation -- catching a broken button before it
 * ever reaches a real channel, rather than after a customer clicks it
 * (`plugins/autoposter/delivery.py`'s own runtime apology message is the
 * fallback for a translation that goes stale *after* publish, not a
 * substitute for catching an obviously-broken one *before* it).
 */
export async function publishMessage(
  spreadsheetId: string, messageId: string, channels: PublishChannel[], slowMode: boolean,
): Promise<{ targets: PostboxTarget[]; eta_minutes: number }[]> {
  await assertSheetsAuthoritative(TARGETS_TAB);
  const message = await getMessage(spreadsheetId, messageId);
  if (!message) throw new BotConfigError(404, "پیامِ مبدأ پیدا نشد.", "message_not_found");
  if (!channels || channels.length === 0) throw bad("حداقل یک کانال لازم است.", "channels_required");

  const buttons = await listButtons(spreadsheetId, messageId);
  const translationButtons = buttons.filter((b) => b.kind === "translation");
  if (translationButtons.length > 0) {
    const translations = await listTranslations(spreadsheetId, messageId);
    for (const btn of translationButtons) {
      const tr = translations.find((t) => t.id === btn.target);
      if (!tr || tr.status !== "ready") {
        throw bad(
          `دکمه‌ی «${btn.label}» به ترجمه‌ای اشاره می‌کند که آماده نیست -- پیش از انتشار، ترجمه را کامل و «آماده» کنید یا دکمه را حذف کنید.`,
          "broken_translation_button",
        );
      }
    }
  }

  const existingQueuedByChannel = new Map<string, number>();
  for (const t of await readAll<PostboxTarget>(spreadsheetId, TARGETS_TAB)) {
    if (t.status !== "queued") continue;
    const key = `${t.channel_id}:${Boolean(t.slow_mode)}`;
    existingQueuedByChannel.set(key, (existingQueuedByChannel.get(key) ?? 0) + 1);
  }

  const limit = slowMode ? SLOW_MODE_PER_DAY_LIMIT : RATE_LIMIT_PER_MINUTE;
  const entries: Array<{ key: string; value: PostboxTarget }> = [];
  const results: { targets: PostboxTarget[]; eta_minutes: number }[] = [];

  for (const ch of channels) {
    const channelId = String(ch.channel_id || "").trim();
    if (!channelId) throw bad("channel_id نمی‌تواند خالی باشد.", "channel_id_required");
    const id = await shortId(spreadsheetId, TARGETS_TAB, "px");
    const target: PostboxTarget = {
      id, message_id: messageId, channel_id: channelId, channel_title: String(ch.channel_title || "").trim(),
      status: "queued", sent_message_id: "", button_message_id: "", error: "",
      queued_at: nowIso(), sent_at: "", slow_mode: slowMode, created_at: nowIso(),
    };
    entries.push({ key: id, value: target });

    const key = `${channelId}:${slowMode}`;
    const ahead = existingQueuedByChannel.get(key) ?? 0;
    existingQueuedByChannel.set(key, ahead + 1);
    const etaMinutes = ahead < limit ? 0 : 1 + Math.floor((ahead - limit) / limit);
    results.push({ targets: [target], eta_minutes: etaMinutes });
  }

  await putEntities(spreadsheetId, TARGETS_TAB, entries);
  return results;
}

/**
 * IRFORGE_POSTBOX_PROMPT Phase A8 companion -- Phase A6 (irforge-app) built
 * `edit_buttons(bot, message_id)` but wired it to nothing: no bot-side
 * command or scheduled sweep ever called it, so it was dead code until this
 * phase needed a real trigger from the website (which cannot call Telegram
 * itself -- see this file's header). Rather than invent a second scheduled
 * task, `postbox_messages` gained one field (`buttons_dirty`) and
 * `flush_publish_queue()` -- already ticking every 30s for the publish
 * queue -- now also sweeps dirty messages and calls `edit_buttons()` for
 * each, in the same tick. This function is the website half: it only ever
 * flips the flag; the actual `editMessageReplyMarkup` call happens
 * asynchronously, exactly like publish already does.
 */
export async function requestButtonEdit(spreadsheetId: string, messageId: string): Promise<void> {
  const targets = await listTargets(spreadsheetId, messageId);
  if (!targets.some((t) => t.status === "sent")) return; // nothing published yet -- nothing to edit
  const message = await getMessage(spreadsheetId, messageId);
  if (!message) return;
  await putEntity(spreadsheetId, MESSAGES_TAB, messageId, { ...message, buttons_dirty: true, updated_at: nowIso() });
}

export const __testables = { shortId, normalizeLangCode, normalizeButtonInput };
