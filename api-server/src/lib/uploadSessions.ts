/**
 * lib/uploadSessions.ts — «با بات بفرست».
 * ─────────────────────────────────────────────────────────────────────────────
 * چیزهایی هست که نمی‌شود در یک textarea تایپشان کرد: یک پیام تلگرامی با
 * فرمت کامل، یک ویس، عکسی که همین الان روی گوشی است. این ماژول یک جلسه‌ی
 * کوتاه‌عمر می‌سازد که کاربر محتوا را از داخل خودِ تلگرام تحویل می‌دهد:
 *
 *   ۱. سایت جلسه می‌سازد و لینک `t.me/<bot>?start=upload_<id>` می‌دهد.
 *   ۲. کاربر روی لینک می‌زند → وبهوک بات پلتفرم جلسه را `waiting` می‌کند.
 *   ۳. **پیام بعدی** همان کاربر ضبط می‌شود (متن، عکس، ویس، فوروارد…).
 *   ۴. سایت با polling می‌بیند جلسه `filled` شده و فیلد را پر می‌کند.
 *
 * ⚠️ **چرا محتوا ذخیره می‌شود و نه `(chat_id, message_id)` برای کپی مستقیم؟**
 * پیام در چتِ کاربر با **بات پلتفرم** است؛ بات تننت اصلاً عضو آن چت نیست و
 * `copy_message` بینشان کار نمی‌کند. ولی `file_id` تلگرام را هر باتی می‌تواند
 * برای *ارسال* استفاده کند، و `entities` هم فرمت متن را مو‌به‌مو نگه می‌دارد —
 * پس بات تننت همان محتوا را بازتولید می‌کند.
 *
 * یک نکته که باید صادقانه گفته شود: برچسب «Forwarded from» حفظ نمی‌شود. ولی
 * این چیزی از دست نمی‌دهد، چون خودِ بات هم پیام همگانی را با `copy_message`
 * می‌فرستد (`handlers/broadcast.py`) که آن برچسب را در هر حالت حذف می‌کند.
 */
import crypto from "crypto";
import { and, eq, lt, desc } from "drizzle-orm";
import { db, uploadSessionsTable, type UploadSession } from "@workspace/db";
import { logger } from "./logger";

/** عمر جلسه. کوتاه، چون یک تعامل زنده است نه یک پیش‌نویس. */
const TTL_MS = 15 * 60 * 1000;

/** انواعی که ضبط می‌کنیم. بقیه با پیام روشن رد می‌شوند. */
const MEDIA_FIELDS = ["photo", "voice", "audio", "video", "document", "animation"] as const;
export type CapturedMedia = (typeof MEDIA_FIELDS)[number];

export type UploadSessionKind = "broadcast" | "panel_media" | "command_media";

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
 * کاربر روی لینک زده. جلسه منتظر **پیام بعدی** همان چت می‌شود.
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

export type ExtractedContent = {
  mediaType: CapturedMedia | "text";
  fileId: string | null;
  content: string;
  entities: unknown;
  messageId: string;
};

/**
 * محتوای قابل بازتولیدِ یک پیام تلگرام را بیرون می‌کشد.
 *
 * `photo` آرایه‌ای از اندازه‌هاست و آخری بزرگ‌ترین است — همان چیزی که باید
 * دوباره فرستاده شود. برای بقیه، خودِ آبجکت `file_id` دارد.
 */
export function extractContent(message: any): ExtractedContent | null {
  if (!message) return null;
  const messageId = String(message.message_id ?? "");
  if (!messageId) return null;

  for (const field of MEDIA_FIELDS) {
    const raw = message[field];
    if (!raw) continue;
    const fileId = Array.isArray(raw) ? raw[raw.length - 1]?.file_id : raw.file_id;
    if (!fileId) continue;
    return {
      mediaType: field,
      fileId: String(fileId),
      content: String(message.caption ?? ""),
      entities: message.caption_entities ?? null,
      messageId,
    };
  }

  if (typeof message.text === "string" && message.text.length > 0) {
    return {
      mediaType: "text",
      fileId: null,
      content: message.text,
      entities: message.entities ?? null,
      messageId,
    };
  }

  return null;
}

/** محتوای ضبط‌شده را می‌نشاند و جلسه را می‌بندد. */
export async function fillSession(
  sessionId: string,
  extracted: ExtractedContent,
): Promise<UploadSession | null> {
  const [row] = await db
    .update(uploadSessionsTable)
    .set({
      status: "filled",
      mediaType: extracted.mediaType,
      fileId: extracted.fileId,
      content: extracted.content,
      entities: extracted.entities as any,
      messageId: extracted.messageId,
    })
    .where(and(eq(uploadSessionsTable.id, sessionId), eq(uploadSessionsTable.status, "waiting")))
    .returning();
  return row ?? null;
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
