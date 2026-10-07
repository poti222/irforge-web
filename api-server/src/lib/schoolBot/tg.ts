/**
 * lib/schoolBot/tg.ts — ارسال/ویرایش/پاسخِ‌دکمه در تلگرام برایِ باتِ مدرسه.
 * قراردادها: HTML با escape، تقسیمِ پیامِ >۴۰۹۶، سقفِ نرخِ ≈ ۲۵ پیام/ثانیه برایِ هر بات، ۴۰۳ (بلاک/Start‌نزده) خطا نیست
 * و مشترک را «دسترس‌ناپذیر» می‌کند، خطایِ پارسِ HTML → ارسالِ متنِ ساده.
 */
import { and, eq } from "drizzle-orm";
import { db, schoolBotSubscribersTable } from "@workspace/db";
import { tgApi } from "../telegram";
import { logger } from "../logger";

export type Btn = { text: string; callback_data?: string; url?: string };
export type Kb = Btn[][];
export type Screen = { text: string; kb?: Kb };

export const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const stripTags = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const MAX = 3900; // کمی کمتر از ۴۰۹۶ برای حاشیهٔ ایمنی

/** تقسیم روی مرزِ خط؛ هر «خط» در تولیدکننده‌ها خودش تگ‌هایِ متوازن دارد. */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX) return [text];
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const line of text.split("\n")) {
    let l = line;
    while (l.length > MAX) { push(); out.push(l.slice(0, MAX)); l = l.slice(MAX); }
    if ((cur ? cur.length + 1 : 0) + l.length > MAX) push();
    cur = cur ? cur + "\n" + l : l;
  }
  push();
  return out;
}

// ─── نرخ: برایِ هر توکن، فاصلهٔ ≥ ۴۰ms بینِ ارسال‌ها (≈ ۲۵/s) ───
const lanes = new Map<string, Promise<void>>();
const GAP_MS = Number(process.env.SCHOOL_BOT_SEND_GAP_MS ?? 40);
function throttle(token: string): Promise<void> {
  const prev = lanes.get(token) ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, GAP_MS)));
  lanes.set(token, next.catch(() => {}));
  return prev;
}

export type SendResult = { ok: boolean; blocked: boolean; description?: string };

const isBlocked = (d?: string) => !!d && /^Forbidden|blocked by the user|user is deactivated|chat not found/i.test(d);

export class BotSender {
  constructor(public botId: string, public token: string) {}

  async markUnreachable(chatId: string | number) {
    try {
      await db.update(schoolBotSubscribersTable).set({ unreachableAt: new Date() })
        .where(and(eq(schoolBotSubscribersTable.schoolBotId, this.botId), eq(schoolBotSubscribersTable.telegramChatId, String(chatId))));
    } catch (err) { logger.warn({ err }, "markUnreachable failed (non-fatal)"); }
  }

  /** ارسالِ یک پیام (یا چند پیام اگر طولانی)؛ دکمه‌ها فقط روی آخرین. هرگز throw نمی‌کند. */
  async send(chatId: string | number, text: string, kb?: Kb, opts: { silent?: boolean } = {}): Promise<SendResult> {
    const parts = splitMessage(text);
    let last: SendResult = { ok: true, blocked: false };
    for (let i = 0; i < parts.length; i++) {
      last = await this.sendOne(chatId, parts[i], i === parts.length - 1 ? kb : undefined, opts);
      if (!last.ok) break;
    }
    return last;
  }

  private async sendOne(chatId: string | number, text: string, kb: Kb | undefined, opts: { silent?: boolean }): Promise<SendResult> {
    const body = (t: string, html: boolean): Record<string, unknown> => ({
      chat_id: chatId, text: t, ...(html ? { parse_mode: "HTML" } : {}), disable_web_page_preview: true,
      ...(opts.silent ? { disable_notification: true } : {}),
      ...(kb?.length ? { reply_markup: { inline_keyboard: kb } } : {}),
    });
    try {
      await throttle(this.token);
      let r = await tgApi(this.token, "sendMessage", body(text, true));
      if (!r.ok && /can't parse entities/i.test(r.description ?? "")) r = await tgApi(this.token, "sendMessage", body(stripTags(text), false));
      if (!r.ok) {
        const blocked = isBlocked(r.description);
        if (blocked) await this.markUnreachable(chatId);
        else logger.warn({ description: r.description }, "school bot sendMessage not ok");
        return { ok: false, blocked, description: r.description };
      }
      return { ok: true, blocked: false };
    } catch (err) {
      logger.warn({ err }, "school bot sendMessage threw (non-fatal)");
      return { ok: false, blocked: false, description: "network" };
    }
  }

  /** ویرایشِ همان پیامِ دکمه (ناوبری). اگر نشد (پیامِ قدیمی/بدونِ تغییر) پیامِ تازه می‌فرستد. */
  async edit(chatId: string | number, messageId: number, text: string, kb?: Kb): Promise<SendResult> {
    const parts = splitMessage(text);
    if (parts.length > 1) { return this.send(chatId, text, kb); }
    try {
      await throttle(this.token);
      const mk = (t: string, html: boolean) => ({
        chat_id: chatId, message_id: messageId, text: t, ...(html ? { parse_mode: "HTML" } : {}), disable_web_page_preview: true,
        reply_markup: { inline_keyboard: kb ?? [] },
      });
      let r = await tgApi(this.token, "editMessageText", mk(text, true));
      if (!r.ok && /can't parse entities/i.test(r.description ?? "")) r = await tgApi(this.token, "editMessageText", mk(stripTags(text), false));
      if (r.ok || /message is not modified/i.test(r.description ?? "")) return { ok: true, blocked: false };
      if (isBlocked(r.description)) { await this.markUnreachable(chatId); return { ok: false, blocked: true, description: r.description }; }
      return this.send(chatId, text, kb);
    } catch (err) {
      logger.warn({ err }, "school bot editMessageText threw (non-fatal)");
      return { ok: false, blocked: false, description: "network" };
    }
  }

  async answer(callbackQueryId: string, text?: string, alert = false) {
    try { await tgApi(this.token, "answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text: text.slice(0, 190), show_alert: alert } : {}) }); }
    catch (err) { logger.warn({ err }, "answerCallbackQuery failed (non-fatal)"); }
  }
}
