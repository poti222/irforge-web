import { and, eq } from "drizzle-orm";
import { db, schoolBotChatStateTable } from "@workspace/db";
import { esc, type Btn, type Kb } from "./tg";

export const DAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const FA = "۰۱۲۳۴۵۶۷۸۹";
export const fa = (n: number | string) => String(n).replace(/\d/g, (d) => FA[Number(d)]);

/** روزِ هفته با قراردادِ سایت: شنبه=۰ … جمعه=۶ (به وقتِ تهران). */
export function tehranDow(d = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short" }).format(d);
  const js = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return (js + 1) % 7;
}
export function tehranDateStr(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function jDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00:00Z") : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" });
}
export function jDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "short", timeStyle: "short" });
}

export const PAGE_SIZE = 8;
export function paginate<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(0, page | 0), pages - 1);
  return { slice: items.slice(p * size, p * size + size), page: p, pages, total: items.length };
}
/** ردیفِ «قبلی/بعدی» برایِ callback_data `${base}:${page}`. */
export function pager(base: string, page: number, pages: number): Btn[] {
  const row: Btn[] = [];
  if (page > 0) row.push({ text: "◀️ قبلی", callback_data: `${base}:${page - 1}` });
  if (page < pages - 1) row.push({ text: "بیشتر ▶️", callback_data: `${base}:${page + 1}` });
  return row;
}
export const HOME_BTN: Btn = { text: "🏠 منوی اصلی", callback_data: "m:home" };
export function withNav(kb: Kb = [], back?: string): Kb {
  const nav: Btn[] = [];
  if (back) nav.push({ text: "🔙 بازگشت", callback_data: back });
  nav.push(HOME_BTN);
  return [...kb.filter((r) => r.length), nav];
}

export const b = (t: unknown) => `<b>${esc(t)}</b>`;
export const trunc = (t: unknown, n: number) => { const s = String(t ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ─── وضعیتِ گفتگو ───
export type ChatState = { state: string; data: Record<string, any> };
export async function getState(botId: string, chatId: string): Promise<ChatState | null> {
  const [r] = await db.select().from(schoolBotChatStateTable).where(and(eq(schoolBotChatStateTable.schoolBotId, botId), eq(schoolBotChatStateTable.telegramChatId, chatId))).limit(1);
  if (!r) return null;
  // وضعیتِ قدیمی‌تر از ۱ ساعت معتبر نیست.
  if (Date.now() - new Date(r.updatedAt).getTime() > 3600_000) return null;
  return { state: r.state, data: (r.data as any) ?? {} };
}
export async function setState(botId: string, chatId: string, state: string, data: Record<string, any> = {}) {
  await db.insert(schoolBotChatStateTable).values({ schoolBotId: botId, telegramChatId: chatId, state, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schoolBotChatStateTable.schoolBotId, schoolBotChatStateTable.telegramChatId], set: { state, data, updatedAt: new Date() } });
}
export async function clearState(botId: string, chatId: string) {
  await db.delete(schoolBotChatStateTable).where(and(eq(schoolBotChatStateTable.schoolBotId, botId), eq(schoolBotChatStateTable.telegramChatId, chatId)));
}
