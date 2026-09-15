/**
 * lib/uploadSessions.ts — «با بات بفرست».
 * ─────────────────────────────────────────────────────────────────────────────
 * چیزهایی هست که نمی‌شود در یک textarea تایپشان کرد: یک پیام تلگرامی با
 * فرمت کامل، یک ویس، عکسی که همین الان روی گوشی است. این ماژول یک جلسه‌ی
 * کوتاه‌عمر می‌سازد که کاربر محتوا را از داخل خودِ تلگرام تحویل می‌دهد:
 *
 *   ۱. سایت جلسه می‌سازد و لینک `t.me/<bot>?start=upload_<id>` می‌دهد.
 *   ۲. کاربر روی لینک می‌زند → وبهوک بات پلتفرم جلسه را `waiting` می‌کند.
 *   ۳. هر پیامِ بعدیِ همان کاربر یک آیتمِ تازه به جلسه اضافه می‌کند (متن،
 *      عکس، ویس، فوروارد…) — می‌شود چند پیام پشتِ‌سرِهم فرستاد.
 *   ۴. جلسه با تأییدِ صریح `filled` می‌شود: برایِ `SINGLE_ITEM_KINDS`ی
 *      پایین (broadcast/command_media/drip_media/pool_item) همان اولین
 *      پیام کافی است — دقیقاً رفتارِ قدیمی، حفظ‌شده تا مصرف‌کننده‌هایِ
 *      موجود (BroadcastSection.tsx) نشکنند؛ بقیه (panel_media، برایِ
 *      پنلِ نوعِ «رسانه»یِ IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_
 *      PROMPT بخشِ B) منتظرِ دکمه‌ی صریحِ «✅ پایان» می‌مانند.
 *   ۵. سایت با polling می‌بیند جلسه `filled` شده و آیتم‌ها را برمی‌دارد.
 *
 * ⚠️ **چرا محتوا ذخیره می‌شود و نه `(chat_id, message_id)` برای کپی مستقیم؟**
 * پیام در چتِ کاربر با **بات پلتفرم** است؛ بات تننت اصلاً عضو آن چت نیست و
 * `copy_message` بینشان کار نمی‌کند.
 *
 * ⚠️ و **`file_id` هم قابل انتقال بین دو بات نیست.** مستندات Bot API صریح
 * می‌گوید file_id برای هر بات یکتاست؛ فرستادنش با توکن بات دیگر خطای
 * `wrong file identifier/HTTP URL specified` می‌دهد. `convertItemForBot()`
 * پایین دقیقاً همین مشکل را حل می‌کند: بایت‌ها را با توکنِ **بات پلتفرم**
 * دانلود می‌کند (`downloadTelegramFile`) و با توکنِ **بات تننتِ مقصد** دوباره
 * آپلود می‌کند (`uploadBufferToBotChat`ی همان چیزی که `routes/botMedia.ts`
 * برایِ آپلودِ مرورگری استفاده می‌کند) — نتیجه یک file_id واقعاً قابلِ
 * فرستادن با آن بات، دقیقاً همان چیزی که MediaList/pool_item انتظار دارند.
 *
 * `entities` هم ذخیره می‌شود تا فرمت متن مو‌به‌مو بازتولید شود.
 *
 * یک نکته که باید صادقانه گفته شود: برچسب «Forwarded from» حفظ نمی‌شود. ولی
 * این چیزی از دست نمی‌دهد، چون خودِ بات هم پیام همگانی را با `copy_message`
 * می‌فرستد (`handlers/broadcast.py`) که آن برچسب را در هر حالت حذف می‌کند.
 */
import crypto from "crypto";
import { and, eq, lt, desc, sql } from "drizzle-orm";
import { db, uploadSessionsTable, type UploadSession, type UploadedItem } from "@workspace/db";
import { logger } from "./logger";
import { downloadTelegramFile } from "./telegram.js";

/** عمر جلسه. کوتاه، چون یک تعامل زنده است نه یک پیش‌نویس. */
const TTL_MS = 15 * 60 * 1000;

/** انواعی که ضبط می‌کنیم. بقیه با پیام روشن رد می‌شوند. */
const MEDIA_FIELDS = ["photo", "voice", "audio", "video", "document", "animation"] as const;
export type CapturedMedia = (typeof MEDIA_FIELDS)[number];

export type UploadSessionKind = "broadcast" | "panel_media" | "command_media" | "drip_media" | "pool_item";

/** این kindها با همان اولین پیام `filled` می‌شوند — رفتارِ قدیمی، حفظ‌شده
 * برای مصرف‌کننده‌هایِ موجود و برایِ pool_item که ذاتاً یک‌آیتمی است (یک
 * عکسِ QR + کپشنِ لینک = یک پیامِ تلگرامی، نیازی به «چندتا بفرست» نیست). */
export const SINGLE_ITEM_KINDS: ReadonlySet<UploadSessionKind> = new Set([
  "broadcast", "command_media", "drip_media", "pool_item",
]);

export function newSessionId(): string {
  // در URL می‌نشیند و تنها چیزی است که جلسه را محافظت می‌کند، پس باید
  // غیرقابل حدس باشد — نه یک uuid ترتیبی.
  return crypto.randomBytes(18).toString("base64url");
}

export async function createSession(input: {
  userId: string;
  botId: string | null;
  kind: UploadSessionKind;
}): Promise<UploadSession> {
  const [row] = await db
    .insert(uploadSessionsTable)
    .values({
      id: newSessionId(),
      userId: input.userId,
      botId: input.botId,
      kind: input.kind,
      status: "pending",
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .returning();
  return row;
}

export async function getSession(id: string, userId: string): Promise<UploadSession | null> {
  const [row] = await db
    .select()
    .from(uploadSessionsTable)
    .where(and(eq(uploadSessionsTable.id, id), eq(uploadSessionsTable.userId, userId)))
    .limit(1);
  if (!row) return null;
  // انقضا در لحظه‌ی خواندن اعمال می‌شود، نه با یک job زمان‌بندی‌شده — سرور
  // کرون ندارد و یک جلسه‌ی منقضیِ «هنوز waiting» گمراه‌کننده است.
  if (row.status !== "filled" && row.expiresAt < new Date()) {
    return { ...row, status: "expired" };
  }
  return row;
}

/** لینک عمیقی که کاربر باید بازش کند. */
export function deepLinkFor(sessionId: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!username) return null;
  return `https://t.me/${username}?start=upload_${sessionId}`;
}

/**
 * کاربر روی لینک زده. جلسه منتظر پیام(ها)یِ بعدی همان چت می‌شود.
 *
 * فقط جلسه‌ای که هنوز `pending` است پیش می‌رود: زدن دوباره‌ی لینک بعد از
 * پرشدن، محتوای ضبط‌شده را دور نمی‌ریزد.
 */
export async function markWaiting(sessionId: string, chatId: string): Promise<UploadSession | null> {
  const [row] = await db
    .update(uploadSessionsTable)
    .set({ status: "waiting", chatId })
    .where(
      and(
        eq(uploadSessionsTable.id, sessionId),
        eq(uploadSessionsTable.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

/** جلسه‌ی بازِ این چت (تازه‌ترینش)، یا null. */
export async function openSessionForChat(chatId: string): Promise<UploadSession | null> {
  const [row] = await db
    .select()
    .from(uploadSessionsTable)
    .where(and(eq(uploadSessionsTable.chatId, chatId), eq(uploadSessionsTable.status, "waiting")))
    .orderBy(desc(uploadSessionsTable.createdAt))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  return row;
}

/**
 * محتوای قابل بازتولیدِ یک پیام تلگرام را بیرون می‌کشد.
 *
 * `photo` آرایه‌ای از اندازه‌هاست و آخری بزرگ‌ترین است — همان چیزی که باید
 * دوباره فرستاده شود. برای بقیه، خودِ آبجکت `file_id` دارد.
 */
export function extractContent(message: any): UploadedItem | null {
  if (!message) return null;
  const messageId = String(message.message_id ?? "");
  if (!messageId) return null;

  for (const field of MEDIA_FIELDS) {
    const raw = message[field];
    if (!raw) continue;
    const fileId = Array.isArray(raw) ? raw[raw.length - 1]?.file_id : raw.file_id;
    if (!fileId) continue;
    return {
      type: field,
      fileId: String(fileId),
      content: String(message.caption ?? ""),
      entities: message.caption_entities ?? null,
      messageId,
    };
  }

  if (typeof message.text === "string" && message.text.length > 0) {
    return {
      type: "text",
      fileId: null,
      content: message.text,
      entities: message.entities ?? null,
      messageId,
    };
  }

  return null;
}

/** یک آیتمِ تازه را به جلسه اضافه می‌کند — جلسه `waiting` می‌ماند، status
 * عوض نمی‌شود. صدازننده (وبهوک) خودش تصمیم می‌گیرد که آیا همین‌جا
 * `finishSession` هم صدا بزند (kindهای تک‌آیتمی) یا منتظرِ پیامِ/دکمه‌ی
 * بعدی بماند. */
export async function appendItem(sessionId: string, item: UploadedItem): Promise<UploadSession | null> {
  const [row] = await db
    .update(uploadSessionsTable)
    .set({ items: sql`${uploadSessionsTable.items} || ${JSON.stringify([item])}::jsonb` })
    .where(and(eq(uploadSessionsTable.id, sessionId), eq(uploadSessionsTable.status, "waiting")))
    .returning();
  return row ?? null;
}

/** جلسه را می‌بندد — فقط اگر لااقل یک آیتم داشته باشد (دکمه‌ی «پایان» را
 * زودتر از موعد زدن، یا چند بار پشتِ‌سرِهم زدن، هیچ‌کدام جلسه‌ی خالی
 * نمی‌سازند). */
export async function finishSession(sessionId: string): Promise<UploadSession | null> {
  const [row] = await db
    .update(uploadSessionsTable)
    .set({ status: "filled" })
    .where(
      and(
        eq(uploadSessionsTable.id, sessionId),
        eq(uploadSessionsTable.status, "waiting"),
        sql`jsonb_array_length(${uploadSessionsTable.items}) > 0`,
      ),
    )
    .returning();
  return row ?? null;
}

export type ConvertedItem =
  | { type: "text"; content: string }
  | { type: CapturedMedia; fileId: string; caption: string };

/**
 * یک آیتمِ ضبط‌شده با بات پلتفرم را برایِ ارسالِ واقعی با یک بات تننت آماده
 * می‌کند. متن نیازی به تبدیل ندارد (هیچ file_idای در کار نیست)؛ مدیا باید
 * با توکنِ پلتفرم دانلود و با توکنِ همین بات دوباره آپلود شود — نگاه کن
 * توضیحِ بالایِ فایل برایِ چرایی‌اش.
 *
 * `null` یعنی تبدیل ناموفق بود (فایل منقضی شده، یا بات چتِ مقصد ندارد) —
 * صدازننده باید این را به‌عنوانِ شکستِ همان یک آیتم نشان بدهد، نه کل درخواست.
 */
export async function convertItemForBot(
  item: UploadedItem,
  botId: string,
  userId: string,
): Promise<ConvertedItem | null> {
  if (item.type === "text") return { type: "text", content: item.content };
  if (!item.fileId) return null;

  const platformToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!platformToken) {
    logger.warn("convertItemForBot: TELEGRAM_BOT_TOKEN not set, cannot download platform-bot file");
    return null;
  }

  const downloaded = await downloadTelegramFile(platformToken, item.fileId);
  if (!downloaded) return null;

  try {
    // import دیر‌هنگام — جلوگیری از حلقه‌ی import (botMedia.ts خودش این
    // ماژول را وارد نمی‌کند، ولی uploadSessions در چند جایِ دیگر هم استفاده
    // می‌شود و بهتر است این وابستگی فقط وقتی واقعاً لازم است بار شود).
    const { botToken: resolveBotToken, uploadChatId, uploadBufferToBotChat } = await import("../routes/botMedia.js");
    const { resolveBotSheet } = await import("./botConfig.js");

    const { spreadsheetId } = await resolveBotSheet(userId, botId);
    const chatId = await uploadChatId(spreadsheetId, userId);
    const token = await resolveBotToken(botId);
    const uploaded = await uploadBufferToBotChat(token, chatId, downloaded.buffer, downloaded.contentType, downloaded.fileName);
    return { type: item.type, fileId: uploaded.fileId, caption: item.content };
  } catch (err) {
    logger.warn({ err, botId }, "convertItemForBot: re-upload to tenant bot failed");
    return null;
  }
}

/** پاک‌سازی تنبل — از مسیر بوت هم صدا زده می‌شود (migrate.mjs). */
export async function purgeExpired(): Promise<void> {
  try {
    await db
      .delete(uploadSessionsTable)
      .where(lt(uploadSessionsTable.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  } catch (err) {
    logger.debug({ err }, "purgeExpired upload sessions failed (ignored)");
  }
}
