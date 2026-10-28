/**
 * lib/filesStore.ts — کتابخانه‌ی فایل‌ها (پلاگین `files`) سمت سایت.
 * ─────────────────────────────────────────────────────────────────────────────
 * برادر TypeScriptِ `plugins/files/domain.py`. هر رکورد = «یک فایل» = یک لینک
 * مستقیم (`t.me/<bot>?start=<id>`) که چند پیامِ تلگرامی را تحویل می‌دهد.
 *
 * جریان:
 *   ۱. سایت `createBundle` می‌زند → رکورد با `status="collecting"` ساخته می‌شود و
 *      بات (با توکن خودِ بات) به ادمین‌ها می‌نویسد «فایل‌هایت را بفرست».
 *   ۲. ادمین در بات هر تعداد پیام می‌فرستد (هر نوع، فوروارد هم)؛ بات
 *      `(chat_id, message_id)` را در `items` ذخیره می‌کند و با «✅ تمام شد»
 *      رکورد را `ready` می‌کند (`plugins/files/handlers.py`).
 *   ۳. در سایت اسم/توضیح/دکمه‌های لینک/حذف‌خودکار/ضدفوروارد تنظیم می‌شود.
 *
 * سایت هرگز `items` را دست نمی‌زند: فقط بات آن را می‌نویسد، تا ویرایشِ همزمانِ
 * سایت پیام‌های در حال رسیدن را بازنویسی نکند (هر PATCH رکورد را تازه می‌خواند).
 */
import { getEntity, putEntity, listEntity, removeEntity, BotConfigError } from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";
import { tgApi } from "./telegram.js";
import { db, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptToken } from "./tokenCrypto.js";

const TAB = "files_library";
const ADMINS_TAB = "admins";
export const MAX_BUTTONS = 8;
export const MAX_TTL_SECONDS = 3600;

export interface LinkButton {
  label: string;
  url: string;
}

export interface FileBundle {
  id: string;
  title: string;
  description: string;
  status: "collecting" | "ready";
  is_active: boolean;
  item_count: number;
  downloads: number;
  ttl: number;
  protect: boolean;
  buttons: LinkButton[];
  /** رکوردهای قدیمیِ تک‌فایلی (قبل از بسته‌ها) `legacy=true` هستند. */
  legacy: boolean;
  file_kind: string;
  created_at: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

async function botToken(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    const token = decryptToken(bot?.token ?? "");
    if (token) return token;
  } catch {
    /* falls through */
  }
  throw new BotConfigError(409, "توکن این بات روی سرور در دسترس نیست.", "no_token");
}

export function cleanButtons(input: unknown): LinkButton[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw bad("دکمه‌ها باید فهرست باشند.", "bad_buttons");
  const out: LinkButton[] = [];
  for (const raw of input) {
    const label = String((raw as any)?.label ?? "").trim().slice(0, 60);
    const url = String((raw as any)?.url ?? "").trim();
    if (!label && !url) continue;
    if (!label) throw bad("هر دکمه نام لازم دارد.", "bad_button_label");
    if (!/^(https?:\/\/|tg:\/\/)\S+$/i.test(url)) {
      throw bad(`لینک دکمه‌ی «${label}» معتبر نیست؛ باید با https:// شروع شود.`, "bad_button_url");
    }
    out.push({ label, url });
  }
  if (out.length > MAX_BUTTONS) throw bad(`حداکثر ${MAX_BUTTONS} دکمه.`, "too_many_buttons");
  return out;
}

function normalize(id: string, value: any): FileBundle {
  const items = Array.isArray(value?.items) ? value.items : [];
  const legacy = items.length === 0 && Boolean(value?.file_id);
  return {
    id,
    title: String(value?.title ?? ""),
    description: String(value?.description ?? ""),
    status: value?.status === "collecting" ? "collecting" : "ready",
    is_active: value?.is_active !== false && value?.is_active !== "false",
    item_count: legacy ? 1 : Number(value?.item_count ?? items.length) || items.length,
    downloads: Number(value?.downloads) || 0,
    ttl: Number(value?.ttl) || 0,
    protect: value?.protect === true || value?.protect === "true",
    buttons: Array.isArray(value?.buttons) ? value.buttons : [],
    legacy,
    file_kind: String(value?.file_kind ?? ""),
    created_at: String(value?.created_at ?? ""),
  };
}

export async function listBundles(spreadsheetId: string): Promise<FileBundle[]> {
  const rows = await listEntity<any>(spreadsheetId, TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => normalize(r.key, r.value))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function adminChatIds(spreadsheetId: string): Promise<string[]> {
  const rows = await listEntity<any>(spreadsheetId, ADMINS_TAB);
  const ids = new Set<string>();
  for (const r of rows) {
    const candidate = String(r.value?.user_id ?? r.key ?? "").trim();
    if (/^\d{3,}$/.test(candidate)) ids.add(candidate);
  }
  return [...ids];
}

function promptMarkup(id: string) {
  return {
    inline_keyboard: [
      [{ text: "✅ تمام شد", callback_data: `fl:a:udone:${id}` }],
      [{ text: "❌ لغو", callback_data: `fl:a:ucancel:${id}` }],
    ],
  };
}

const PROMPT_TEXT =
  "📤 فایل‌هایی را که می‌خواهید در یک لینک جمع شوند همین‌جا بفرستید.\n\n" +
  "هر نوع پیامی قبول است (عکس، ویدیو، فایل، آهنگ، متن، …) با کپشن یا بدون آن؛ فوروارد هم مشکلی ندارد. " +
  "می‌توانید چند پیام پشت‌سرهم بفرستید.\n\nوقتی تمام شد، دکمه‌ی «✅ تمام شد» را بزنید.";

async function sendPrompt(token: string, chatIds: string[], id: string): Promise<string[]> {
  const delivered: string[] = [];
  for (const chatId of chatIds) {
    try {
      const sent = await tgApi(token, "sendMessage", { chat_id: chatId, text: PROMPT_TEXT, reply_markup: promptMarkup(id) });
      if (sent.ok) delivered.push(chatId);
    } catch {
      /* ادمینی که بات را استارت نکرده؛ بقیه ادامه می‌دهند */
    }
  }
  return delivered;
}

export async function createBundle(spreadsheetId: string, botId: string, body: any): Promise<FileBundle> {
  const admins = await adminChatIds(spreadsheetId);
  if (admins.length === 0) {
    throw new BotConfigError(409, "هیچ ادمینی برای این بات ثبت نشده است.", "no_admins");
  }
  const token = await botToken(botId);
  const id = newRecordId("fl");
  const returnUrl = String(body?.returnUrl ?? "").trim();
  const record = {
    id,
    title: String(body?.title ?? "").trim().slice(0, 120) || "فایل جدید",
    description: "",
    file_id: "",
    file_kind: "",
    is_active: false,
    downloads: 0,
    ttl: 0,
    protect: false,
    items: [],
    item_count: 0,
    buttons: [],
    status: "collecting",
    collectors: admins.map(Number),
    progress: {},
    return_url: /^https?:\/\//i.test(returnUrl) ? returnUrl.slice(0, 500) : "",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, TAB, id, record);

  const delivered = await sendPrompt(token, admins, id);
  if (delivered.length === 0) {
    await removeEntity(spreadsheetId, TAB, id);
    throw new BotConfigError(
      409,
      "بات نتوانست به هیچ ادمینی پیام بدهد. ادمین باید یک بار بات را /start کرده باشد.",
      "no_admin_reachable",
    );
  }
  await putEntity(spreadsheetId, TAB, id, { ...record, collectors: delivered.map(Number) });
  return normalize(id, { ...record, collectors: delivered });
}

/** پیامِ «فایل‌هایت را بفرست» را دوباره می‌فرستد (مثلاً پیامِ قبلی گم شده). */
export async function resendPrompt(spreadsheetId: string, botId: string, id: string): Promise<number> {
  const record = await getEntity<any>(spreadsheetId, TAB, id);
  if (!record) throw new BotConfigError(404, "این فایل پیدا نشد.", "not_found");
  if (record.status !== "collecting") throw bad("این فایل دریافتش تمام شده است.", "not_collecting");
  const token = await botToken(botId);
  const delivered = await sendPrompt(token, (record.collectors ?? []).map(String), id);
  if (delivered.length === 0) throw new BotConfigError(409, "بات نتوانست به ادمین پیام بدهد.", "no_admin_reachable");
  return delivered.length;
}

export async function updateBundle(spreadsheetId: string, id: string, body: any): Promise<FileBundle> {
  const record = await getEntity<any>(spreadsheetId, TAB, id);
  if (!record) throw new BotConfigError(404, "این فایل پیدا نشد.", "not_found");
  const next = { ...record };

  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) throw bad("اسم فایل نمی‌تواند خالی باشد.", "bad_title");
    next.title = title.slice(0, 120);
  }
  if (body.description !== undefined) next.description = String(body.description).trim().slice(0, 500);
  if (body.is_active !== undefined) {
    if (record.status === "collecting") throw bad("تا وقتی دریافت تمام نشده فعال‌کردن ممکن نیست.", "still_collecting");
    next.is_active = Boolean(body.is_active);
  }
  if (body.protect !== undefined) next.protect = Boolean(body.protect);
  if (body.ttl !== undefined) {
    const ttl = Math.round(Number(body.ttl));
    if (!Number.isFinite(ttl) || ttl < 0 || ttl > MAX_TTL_SECONDS) {
      throw bad(`حذف خودکار باید بین 0 تا ${MAX_TTL_SECONDS} ثانیه باشد.`, "bad_ttl");
    }
    next.ttl = ttl;
  }
  if (body.buttons !== undefined) next.buttons = cleanButtons(body.buttons);
  next.updated_at = nowIso();
  await putEntity(spreadsheetId, TAB, id, next);
  return normalize(id, next);
}

export async function deleteBundle(spreadsheetId: string, id: string): Promise<boolean> {
  return removeEntity(spreadsheetId, TAB, id);
}
