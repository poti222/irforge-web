/**
 * lib/schoolBot/reps.ts — «دانش‌آموزِ منتخب» در باتِ مدرسه.
 * ─────────────────────────────────────────────────────────────────────────
 * معلم در سایت یک یا چند دانش‌آموزِ منتخب برایِ کلاسش برمی‌گزیند. منتخب در بات بخشِ «⭐ مسئولِ کلاس» می‌گیرد:
 *   • تکلیف / امتحان / یادآوری ثبت می‌کند (عنوان ← موعد ← «چند روز قبل یادآوری» ← گروه‌ها)؛
 *   • بات هر روز عصر می‌پرسد «تکلیف یا امتحان داری؟» (lib/schoolRepScheduler.ts)؛
 *   • بات در روزهایِ انتخابی پیش از موعد، در گروه‌هایِ انتخابی یادآوری می‌فرستد.
 *
 * گروه‌ها: تلگرام API‌ای برایِ «فهرستِ گروه‌هایی که بات در آن‌هاست» ندارد. پس:
 *   ۱) آپدیتِ `my_chat_member` (وقتی بات به گروه اضافه/ادمین/حذف می‌شود) در `school_bot_groups` ثبت می‌شود؛
 *   ۲) راهِ دستی: کاربرِ مجاز در گروه `/bind` می‌فرستد (برایِ گروه‌هایی که بات پیش از این قابلیت در آن‌ها بوده).
 *   به منتخب فقط گروه‌هایی نشان داده می‌شود که **خودش عضوِ آن‌هاست** (getChatMember) — پس گروهِ بی‌ربط/مزاحم دیده نمی‌شود.
 * امنیت: هویت همیشه از «چت → مشترکِ لینک‌شده → نقش در DB» می‌آید؛ callback_data فقط اندیسِ وضعیتِ سمتِ سرور یا id است
 * و هر بار دوباره با DB سنجیده می‌شود.
 */
import crypto from "crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, schoolClassRepsTable, schoolClassesTable, schoolBotGroupsTable, schoolRepItemsTable, schoolRepItemGroupsTable,
  schoolBotSubscribersTable,
} from "@workspace/db";
import { logger } from "../logger";
import { tgApi } from "../telegram";
import type { SchoolBotRow } from "../schoolBotCore";
import { notifySchoolUsers } from "../schoolNotify";
import {
  DEFAULT_REMIND_DAYS, REMIND_DAY_OPTIONS, REP_KIND_FA, REP_KIND_ICON, REP_KINDS, type RepKind,
  addDays, daysBetween, jalaliString, normalizeRemindDays, parseUserDate, weekdayFa, whenFa,
} from "../schoolRepSchedule";
import { BotSender, esc, type Kb, type Screen } from "./tg";
import { actorForUser, ADMIN_LIKE, type Actor } from "./actor";
import { b, fa, getState, setState, clearState, tehranDateStr, trunc, withNav, paginate, pager } from "./util";

export type RepEnv = { bot: SchoolBotRow; sender: BotSender; schoolId: string; schoolName: string };
type ChatState = { state: string; data: Record<string, any> };

export const REP_HOME_ROW: Kb[number] = [{ text: "⭐ مسئولِ کلاس", callback_data: "r:home" }];
export const MAX_TITLE = 200;
export const MAX_ACTIVE_ITEMS_PER_CLASS = 60;
const MAX_PICKABLE_GROUPS = 40;
const MEMBER_STATUSES = ["creator", "administrator", "member", "restricted"];

// ─── دسترسی ───────────────────────────────────────────────────────────────────
export async function repClasses(schoolId: string, memberId: string | null): Promise<{ id: string; name: string }[]> {
  if (!memberId) return [];
  const rows = await db.select({ classId: schoolClassRepsTable.classId, name: schoolClassesTable.name })
    .from(schoolClassRepsTable)
    .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolClassRepsTable.classId))
    .where(and(eq(schoolClassRepsTable.schoolId, schoolId), eq(schoolClassRepsTable.studentMemberId, memberId)));
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.classId, r.name);
  return [...m].map(([id, name]) => ({ id, name }));
}
export async function isRep(schoolId: string, memberId: string | null): Promise<boolean> {
  return (await repClasses(schoolId, memberId)).length > 0;
}

async function tgUserIdOf(botId: string, userId: string): Promise<string | null> {
  const [s] = await db.select().from(schoolBotSubscribersTable)
    .where(and(eq(schoolBotSubscribersTable.schoolBotId, botId), eq(schoolBotSubscribersTable.userId, userId)))
    .orderBy(desc(schoolBotSubscribersTable.linkedAt)).limit(1);
  return s ? (s.telegramUserId ?? s.telegramChatId) : null;
}
/** شناسهٔ کاربرِ تلگرام → Actorِ همین مدرسه (فقط اگر قبلاً به همین بات وصل شده). */
async function actorForTgUser(env: RepEnv, tgUserId: number | string): Promise<Actor | null> {
  const id = String(tgUserId);
  const [s] = await db.select().from(schoolBotSubscribersTable)
    .where(and(eq(schoolBotSubscribersTable.schoolBotId, env.bot.id),
      or(eq(schoolBotSubscribersTable.telegramUserId, id), eq(schoolBotSubscribersTable.telegramChatId, id))))
    .orderBy(desc(schoolBotSubscribersTable.linkedAt)).limit(1);
  return s ? actorForUser(s.userId, env.schoolId) : null;
}

const selfIds = new Map<string, number>();
async function botSelfId(env: RepEnv): Promise<number | null> {
  const cached = selfIds.get(env.bot.id);
  if (cached) return cached;
  if (env.bot.telegramBotId && /^\d+$/.test(env.bot.telegramBotId)) { selfIds.set(env.bot.id, Number(env.bot.telegramBotId)); return Number(env.bot.telegramBotId); }
  try {
    const r = await tgApi<{ id: number }>(env.sender.token, "getMe");
    if (r.ok && r.result?.id) { selfIds.set(env.bot.id, r.result.id); return r.result.id; }
  } catch (err) { logger.warn({ err }, "rep: getMe failed"); }
  return null;
}

// ─── گروه‌ها ─────────────────────────────────────────────────────────────────
function canPostFrom(chatType: string, m: any): boolean {
  const st = m?.status;
  if (st === "administrator") return chatType === "channel" ? m.can_post_messages !== false : true;
  if (st === "member") return chatType !== "channel";
  if (st === "restricted") return chatType !== "channel" && m.can_send_messages !== false;
  return false;
}

async function upsertGroup(botId: string, chat: any, status: string, canPost: boolean, source: "my_chat_member" | "bind") {
  await db.insert(schoolBotGroupsTable).values({
    id: crypto.randomUUID(), schoolBotId: botId, telegramChatId: String(chat.id), title: String(chat.title ?? "").slice(0, 200),
    chatType: String(chat.type), botStatus: status, canPost, source,
  }).onConflictDoUpdate({
    target: [schoolBotGroupsTable.schoolBotId, schoolBotGroupsTable.telegramChatId],
    set: { title: String(chat.title ?? "").slice(0, 200), chatType: String(chat.type), botStatus: status, canPost, updatedAt: new Date() },
  });
}

/** آپدیتِ `my_chat_member`: بات به گروه اضافه/ادمین/محدود/حذف شد. */
export async function onMyChatMember(env: RepEnv, u: any): Promise<void> {
  try {
    const chat = u?.chat;
    if (!chat || !["group", "supergroup", "channel"].includes(chat.type)) return; // چتِ خصوصی (بلاک/آنبلاک) به این بخش ربطی ندارد
    const nm = u.new_chat_member;
    const status = String(nm?.status ?? "");
    if (!status) return;
    if (status === "left" || status === "kicked") {
      await db.update(schoolBotGroupsTable).set({ botStatus: status, canPost: false, updatedAt: new Date() })
        .where(and(eq(schoolBotGroupsTable.schoolBotId, env.bot.id), eq(schoolBotGroupsTable.telegramChatId, String(chat.id))));
      return;
    }
    const canPost = canPostFrom(String(chat.type), nm);
    await upsertGroup(env.bot.id, chat, status, canPost, "my_chat_member");

    // اگر کسی که بات را اضافه کرده از اعضایِ همین مدرسه است، در پیوی تأیید بگیرد.
    const oldStatus = String(u.old_chat_member?.status ?? "left");
    const wasOut = oldStatus === "left" || oldStatus === "kicked";
    if (wasOut && u.from && !u.from.is_bot) {
      const adder = await actorForTgUser(env, u.from.id);
      if (adder) {
        const tail = status === "administrator" ? "" : "\nℹ️ برایِ ارسالِ مطمئنِ یادآوری‌ها بهتر است بات را «ادمین» کنید.";
        await env.sender.send(String(u.from.id), `✅ بات در گروهِ «${esc(chat.title ?? "")}» عضو شد و به فهرستِ گروه‌هایِ یادآوری اضافه شد.${tail}`, [[{ text: "⭐ مسئولِ کلاس", callback_data: "r:home" }]]);
      }
    }
  } catch (err) { logger.warn({ err }, "rep: my_chat_member handling failed (non-fatal)"); }
}

/** پیامِ گروهی: فقط `/bind` — ثبتِ دستیِ گروه توسطِ معلم/مدیر/دانش‌آموزِ منتخبِ همین مدرسه. */
export async function onGroupMessage(env: RepEnv, msg: any): Promise<void> {
  try {
    if (!msg?.from || msg.from.is_bot || !["group", "supergroup"].includes(msg.chat?.type)) return;
    const text = typeof msg.text === "string" ? msg.text.trim() : "";
    const m = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
    if (!m || m[1].toLowerCase() !== "bind") return;
    if (m[2] && env.bot.telegramUsername && m[2].toLowerCase() !== env.bot.telegramUsername.toLowerCase()) return; // برایِ باتِ دیگری است

    const chatId = String(msg.chat.id);
    const actor = await actorForTgUser(env, msg.from.id);
    if (!actor) return; // ناشناس: بی‌صدا (در گروه اسپم نمی‌کنیم)
    const allowed = actor.role === "teacher" || ADMIN_LIKE.includes(actor.role) || (actor.role === "student" && await isRep(env.schoolId, actor.memberId));
    if (!allowed) {
      await env.sender.send(chatId, "⛔️ فقط معلم، مدیر یا دانش‌آموزِ منتخبِ این مدرسه می‌تواند گروه را به بات اضافه کند.");
      return;
    }
    const selfId = await botSelfId(env);
    const r = selfId ? await tgApi<any>(env.sender.token, "getChatMember", { chat_id: msg.chat.id, user_id: selfId }) : null;
    const status = String(r?.result?.status ?? "member");
    const canPost = r?.ok ? canPostFrom(String(msg.chat.type), r.result) : true;
    await upsertGroup(env.bot.id, msg.chat, status, canPost, "bind");
    const tail = status === "administrator" ? "" : "\nℹ️ بهتر است بات را «ادمین» کنید تا یادآوری‌ها مطمئن ارسال شود.";
    await env.sender.send(chatId, `✅ گروهِ «${esc(msg.chat.title ?? "")}» به فهرستِ گروه‌هایِ بات اضافه شد؛ حالا در بات می‌توانید آن را برایِ یادآوری انتخاب کنید.${tail}`);
  } catch (err) { logger.warn({ err }, "rep: /bind failed (non-fatal)"); }
}

type PickGroup = { id: string; title: string; admin: boolean };

/** گروه‌هایی که بات در آن‌ها می‌تواند پیام بفرستد **و** کاربر عضوِ آن‌هاست. */
async function pickableGroups(env: RepEnv, actor: Actor): Promise<PickGroup[]> {
  const tgUserId = await tgUserIdOf(env.bot.id, actor.userId);
  if (!tgUserId || !/^\d+$/.test(tgUserId)) return [];
  const rows = await db.select().from(schoolBotGroupsTable)
    .where(and(
      eq(schoolBotGroupsTable.schoolBotId, env.bot.id),
      inArray(schoolBotGroupsTable.botStatus, ["administrator", "member", "restricted"]),
      eq(schoolBotGroupsTable.canPost, true),
      sql`${schoolBotGroupsTable.chatType} <> 'channel'`,
    ))
    .orderBy(desc(schoolBotGroupsTable.updatedAt)).limit(MAX_PICKABLE_GROUPS);
  const checked = await Promise.all(rows.map(async (g: typeof rows[number]) => {
    try {
      const r = await tgApi<any>(env.sender.token, "getChatMember", { chat_id: g.telegramChatId, user_id: Number(tgUserId) });
      return r.ok && MEMBER_STATUSES.includes(String(r.result?.status)) ? g : null;
    } catch { return null; }
  }));
  return checked.filter((g): g is typeof rows[number] => !!g)
    .map((g: typeof rows[number]) => ({ id: g.id, title: g.title || "گروهِ بدونِ نام", admin: g.botStatus === "administrator" }));
}

// ─── صفحه‌ها ─────────────────────────────────────────────────────────────────
const dayLabel = (n: number) => (n === 0 ? "همان روز" : `${fa(n)} روز قبل`);
const kindOf = (k: unknown): RepKind | null => ((REP_KINDS as readonly string[]).includes(String(k)) ? (k as RepKind) : null);

function newKindKb(): Kb {
  return [
    [{ text: "📝 ثبتِ تکلیف", callback_data: "r:n:assignment" }, { text: "🧪 ثبتِ امتحان", callback_data: "r:n:exam" }],
    [{ text: "🔔 یادآوریِ دیگر", callback_data: "r:n:reminder" }],
  ];
}

export async function repHomeScreen(env: RepEnv, actor: Actor): Promise<Screen> {
  const classes = await repClasses(env.schoolId, actor.memberId);
  if (!classes.length) return { text: "شما فعلاً دانش‌آموزِ منتخب نیستید.", kb: withNav() };
  return {
    text: [
      b("⭐ مسئولِ کلاس"),
      `کلاس: ${classes.map((c) => esc(c.name)).join("، ")}`,
      "",
      "تکلیف و امتحانِ کلاس را اینجا ثبت کنید؛ بات چند روز قبل (و یک روز قبل) در گروه‌هایی که انتخاب می‌کنید یادآوری می‌فرستد.",
    ].join("\n"),
    kb: withNav([
      ...newKindKb(),
      [{ text: "📋 مواردِ ثبت‌شده", callback_data: "r:ls:0" }, { text: "👥 گروه‌ها", callback_data: "r:gr" }],
    ]),
  };
}

/** پرسشِ روزانهٔ بات از منتخب (توسطِ زمان‌بند فرستاده می‌شود). */
export function repPromptScreen(name: string, className: string): Screen {
  return {
    text: [
      `سلام ${b(name)} 👋`,
      `برایِ کلاس «${esc(className)}» تکلیف یا امتحانِ جدیدی داریم؟`,
      "اگر هست ثبتش کنید تا چند روز قبل در گروه یادآوری کنم.",
    ].join("\n"),
    kb: [
      [{ text: "📝 تکلیف دارم", callback_data: "r:n:assignment" }, { text: "🧪 امتحان دارم", callback_data: "r:n:exam" }],
      [{ text: "🔔 یادآوریِ دیگر", callback_data: "r:n:reminder" }],
      [{ text: "✅ نه، چیزی نیست", callback_data: "r:p:no" }],
    ],
  };
}

/** پیامی که بلافاصله پس از انتخابِ منتخب توسطِ معلم (از سایت) به دانش‌آموز می‌رسد. */
export function repElectedScreen(className: string): Screen {
  return {
    text: [
      b("⭐ شما دانش‌آموزِ منتخب شدید!"),
      `معلم شما را مسئولِ کلاس «${esc(className)}» کرده است.`,
      "از این پس می‌توانید تکلیف، امتحان و یادآوری ثبت کنید و بات پیش از موعد در گروه‌هایِ کلاس یادآوری می‌فرستد. هر روز عصر هم می‌پرسم تکلیف یا امتحانی هست یا نه.",
    ].join("\n"),
    kb: [[{ text: "⭐ شروع", callback_data: "r:home" }]],
  };
}

function summaryText(d: Record<string, any>): string {
  const kind = kindOf(d.kind) ?? "reminder";
  const diff = daysBetween(tehranDateStr(), d.due);
  return [
    `${REP_KIND_ICON[kind]} ${b(REP_KIND_FA[kind])} — ${esc(d.className)}`,
    `📌 ${esc(d.title)}`,
    `📅 ${weekdayFa(d.due)} ${jalaliString(d.due)} (${whenFa(diff)})`,
    `⏰ یادآوری: ${(d.days as number[]).map(dayLabel).join("، ") || "—"}`,
  ].join("\n");
}

function daysOptions(due: string): number[] {
  const diff = daysBetween(tehranDateStr(), due);
  return (REMIND_DAY_OPTIONS as readonly number[]).filter((n) => n <= diff);
}
function defaultDays(due: string): number[] {
  const opts = daysOptions(due);
  const def = DEFAULT_REMIND_DAYS.filter((n) => opts.includes(n));
  return def.length ? def : opts.length ? [opts[0]] : [];
}

function daysScreen(d: Record<string, any>): Screen {
  const opts = daysOptions(d.due);
  const sel = new Set<number>(d.days as number[]);
  const rows: Kb = [];
  for (let i = 0; i < opts.length; i += 2) {
    rows.push(opts.slice(i, i + 2).map((n) => ({ text: `${sel.has(n) ? "✅" : "⬜️"} ${dayLabel(n)}`, callback_data: `r:z:${n}` })));
  }
  rows.push([{ text: "➡️ ادامه", callback_data: "r:z:go" }]);
  rows.push([{ text: "❌ انصراف", callback_data: "r:x" }]);
  return {
    text: [b("چند روز قبل یادآوری کنم؟"), "", summaryText(d), "", "یک یا چند مورد را انتخاب کنید، سپس «ادامه»."].join("\n"),
    kb: rows,
  };
}

async function groupsScreen(env: RepEnv, actor: Actor, d: Record<string, any>, refresh: boolean): Promise<{ screen: Screen; data: Record<string, any> }> {
  const data = { ...d };
  if (refresh || !Array.isArray(data.groups)) {
    const prevSel = new Set<string>(((data.groups ?? []) as PickGroup[]).filter((_, i) => (data.sel ?? []).includes(i)).map((g) => g.id));
    data.groups = await pickableGroups(env, actor);
    data.sel = (data.groups as PickGroup[]).map((g, i) => (prevSel.has(g.id) ? i : -1)).filter((i) => i >= 0);
    if (!prevSel.size && (data.groups as PickGroup[]).length === 1) data.sel = [0]; // فقط یک گروه ← پیش‌انتخاب
  }
  const groups = data.groups as PickGroup[];
  const sel = new Set<number>(data.sel as number[]);
  const kb: Kb = groups.map((g, i) => [{ text: `${sel.has(i) ? "✅" : "⬜️"} ${trunc(g.title, 34)}${g.admin ? " 🛡" : ""}`, callback_data: `r:g:${i}` }]);
  const addUrl = env.bot.telegramUsername ? `https://t.me/${env.bot.telegramUsername}?startgroup=true` : null;
  const lines = [b("یادآوری در کدام گروه‌ها برود؟"), "", summaryText(data), ""];
  if (groups.length) {
    lines.push("گروه‌ها را انتخاب کنید (🛡 = بات در آن ادمین است).");
    lines.push("اگر گروهی انتخاب نکنید، یادآوری‌ها فقط برایِ خودتان در همین چت می‌آید.");
  } else {
    lines.push("هنوز گروهی پیدا نشد که هم بات در آن باشد و هم شما.");
    lines.push("۱) بات را به گروهِ کلاس اضافه کنید (بهتر است ادمین باشد).");
    lines.push("۲) اگر قبلاً اضافه شده، در همان گروه بنویسید /bind");
    lines.push("بعد «🔄 بررسی دوباره» را بزنید. بدونِ گروه هم می‌توانید ثبت کنید.");
  }
  if (addUrl) kb.push([{ text: "➕ افزودنِ بات به گروه", url: addUrl }]);
  kb.push([{ text: "🔄 بررسی دوباره", callback_data: "r:g:re" }]);
  kb.push([{ text: sel.size ? `✅ ثبت (${fa(sel.size)} گروه)` : "✅ ثبت بدونِ گروه", callback_data: "r:ok" }]);
  kb.push([{ text: "❌ انصراف", callback_data: "r:x" }]);
  return { screen: { text: lines.join("\n"), kb }, data };
}

async function listScreen(env: RepEnv, actor: Actor, page: number): Promise<Screen> {
  const classes = await repClasses(env.schoolId, actor.memberId);
  if (!classes.length) return { text: "شما فعلاً دانش‌آموزِ منتخب نیستید.", kb: withNav() };
  const today = tehranDateStr();
  const rows = await db.select().from(schoolRepItemsTable)
    .where(and(inArray(schoolRepItemsTable.classId, classes.map((c) => c.id)), eq(schoolRepItemsTable.status, "active"), sql`${schoolRepItemsTable.dueDate} >= ${today}`))
    .orderBy(schoolRepItemsTable.dueDate).limit(200);
  if (!rows.length) return { text: `${b("📋 مواردِ ثبت‌شده")}\nمورد فعالی نیست.`, kb: withNav([[{ text: "➕ ثبتِ مورد", callback_data: "r:home" }]], "r:home") };
  const p = paginate(rows, page);
  const cn = new Map(classes.map((c) => [c.id, c.name]));
  const lines = [b("📋 مواردِ ثبت‌شده"), ""];
  const kb: Kb = [];
  for (const it of p.slice) {
    const kind = kindOf(it.kind) ?? "reminder";
    lines.push(`${REP_KIND_ICON[kind]} ${esc(trunc(it.title, 60))} — ${jalaliString(it.dueDate)} (${whenFa(daysBetween(today, it.dueDate))}) · ${esc(cn.get(it.classId) ?? "")}`);
    if (it.createdByUserId === actor.userId) kb.push([{ text: `🗑 حذف: ${trunc(it.title, 26)}`, callback_data: `r:rm:${it.id}` }]);
  }
  const nav = pager("r:ls", p.page, p.pages);
  if (nav.length) kb.push(nav);
  return { text: lines.join("\n"), kb: withNav(kb, "r:home") };
}

// ─── مراحلِ ثبت ───────────────────────────────────────────────────────────────
async function startNew(env: RepEnv, actor: Actor, chatId: string, kindRaw: string): Promise<Screen> {
  const kind = kindOf(kindRaw);
  const classes = await repClasses(env.schoolId, actor.memberId);
  if (!kind || !classes.length) return { text: "این بخش فقط برایِ دانش‌آموزِ منتخب است.", kb: withNav() };
  if (classes.length === 1) return askTitle(env, chatId, { kind, classId: classes[0].id, className: classes[0].name });
  await setState(env.bot.id, chatId, "rep_class", { kind, classes });
  return {
    text: `${b("کدام کلاس؟")}\nبرایِ کدام کلاس ثبت کنیم؟`,
    kb: withNav(classes.map((c, i) => [{ text: c.name, callback_data: `r:c:${i}` }]), "r:home"),
  };
}

async function askTitle(env: RepEnv, chatId: string, base: Record<string, any>): Promise<Screen> {
  await setState(env.bot.id, chatId, "rep_title", base);
  const kind = kindOf(base.kind) ?? "reminder";
  const eg = kind === "exam" ? "ریاضی — فصل ۳ و ۴" : kind === "assignment" ? "ریاضی — تمرین‌هایِ صفحهٔ ۴۵" : "جلسهٔ فوقِ‌العاده با معلم";
  return {
    text: `${REP_KIND_ICON[kind]} ${b(`ثبتِ ${REP_KIND_FA[kind]}`)} — ${esc(base.className)}\n\nعنوان را بفرستید (مثلاً: «${esc(eg)}»).`,
    kb: [[{ text: "❌ انصراف", callback_data: "r:x" }]],
  };
}

async function askDate(env: RepEnv, chatId: string, data: Record<string, any>): Promise<Screen> {
  await setState(env.bot.id, chatId, "rep_date", data);
  return {
    text: [
      b("موعد چه روزی است؟"),
      `📌 ${esc(data.title)}`,
      "",
      "یکی از دکمه‌ها را بزنید یا تاریخ را بنویسید؛ مثلاً: فردا — ۳ روز دیگر — ۱۴۰۵/۰۸/۲۰",
    ].join("\n"),
    kb: [
      [{ text: "فردا", callback_data: "r:d:1" }, { text: "پس‌فردا", callback_data: "r:d:2" }],
      [{ text: "۳ روز دیگر", callback_data: "r:d:3" }, { text: "۱ هفته دیگر", callback_data: "r:d:7" }],
      [{ text: "❌ انصراف", callback_data: "r:x" }],
    ],
  };
}

async function afterDate(env: RepEnv, chatId: string, data: Record<string, any>, due: string): Promise<Screen> {
  const d = { ...data, due, days: defaultDays(due) };
  await setState(env.bot.id, chatId, "rep_days", d);
  return daysScreen(d);
}

/** پیامِ متنیِ کاربر در یکی از مراحلِ ثبت. true = مصرف شد. */
export async function onRepText(env: RepEnv, actor: Actor, chatId: string, st: ChatState | null, text: string): Promise<boolean> {
  if (!st || (st.state !== "rep_title" && st.state !== "rep_date")) return false;
  const classes = await repClasses(env.schoolId, actor.memberId);
  if (!classes.length) { await clearState(env.bot.id, chatId); return false; }
  const cancel: Kb = [[{ text: "❌ انصراف", callback_data: "r:x" }]];

  if (st.state === "rep_title") {
    const title = text.replace(/\s+/g, " ").trim();
    if (title.length < 2 || title.length > MAX_TITLE) {
      await env.sender.send(chatId, `عنوان باید بینِ ${fa(2)} تا ${fa(MAX_TITLE)} نویسه باشد. دوباره بفرستید.`, cancel);
      return true;
    }
    const s = await askDate(env, chatId, { ...st.data, title });
    await env.sender.send(chatId, s.text, s.kb);
    return true;
  }

  const r = parseUserDate(text, tehranDateStr());
  if (!r.ok) {
    const why = r.reason === "past" ? "این تاریخ گذشته است." : r.reason === "far" ? "این تاریخ خیلی دور است (حداکثر یک سال)." : "تاریخ را نفهمیدم.";
    await env.sender.send(chatId, `${why}\nمثال: فردا — ۳ روز دیگر — ۱۴۰۵/۰۸/۲۰`, cancel);
    return true;
  }
  const s = await afterDate(env, chatId, st.data, r.iso);
  await env.sender.send(chatId, s.text, s.kb);
  return true;
}

async function saveItem(env: RepEnv, actor: Actor, chatId: string, d: Record<string, any>): Promise<Screen> {
  const kind = kindOf(d.kind);
  const classes = await repClasses(env.schoolId, actor.memberId);
  const cls = classes.find((c) => c.id === d.classId);
  const today = tehranDateStr();
  if (!kind || !cls || typeof d.title !== "string" || !d.title || typeof d.due !== "string") return { text: "جلسه منقضی شد. دوباره از «⭐ مسئولِ کلاس» شروع کنید.", kb: withNav([], "r:home") };
  const diff = daysBetween(today, d.due);
  if (!Number.isFinite(diff) || diff < 0) return { text: "موعد گذشته است. دوباره ثبت کنید.", kb: withNav([], "r:home") };
  const days = normalizeRemindDays(d.days).filter((n) => n <= diff);
  if (!days.length) return { text: "حداقل یک زمانِ یادآوری لازم است.", kb: withNav([], "r:home") };

  // سقفِ موردهایِ فعال و جلوگیری از ثبتِ تکراری.
  const active = await db.select({ id: schoolRepItemsTable.id, title: schoolRepItemsTable.title, kind: schoolRepItemsTable.kind, dueDate: schoolRepItemsTable.dueDate })
    .from(schoolRepItemsTable)
    .where(and(eq(schoolRepItemsTable.classId, cls.id), eq(schoolRepItemsTable.status, "active"), sql`${schoolRepItemsTable.dueDate} >= ${today}`));
  if (active.length >= MAX_ACTIVE_ITEMS_PER_CLASS) return { text: "تعدادِ مواردِ فعالِ این کلاس به سقف رسیده است؛ چند موردِ قدیمی را حذف کنید.", kb: withNav([], "r:ls:0") };
  if (active.some((a: typeof active[number]) => a.kind === kind && a.dueDate === d.due && a.title.trim() === d.title.trim())) {
    return { text: "همین مورد قبلاً ثبت شده است.", kb: withNav([], "r:ls:0") };
  }

  const groupIdsWanted: string[] = ((d.groups ?? []) as PickGroup[]).filter((_, i) => (d.sel ?? []).includes(i)).map((g) => g.id);
  const valid = groupIdsWanted.length
    ? await db.select({ id: schoolBotGroupsTable.id }).from(schoolBotGroupsTable)
        .where(and(eq(schoolBotGroupsTable.schoolBotId, env.bot.id), inArray(schoolBotGroupsTable.id, groupIdsWanted)))
    : [];
  const id = crypto.randomUUID();
  await db.transaction(async (tx: any) => {
    await tx.insert(schoolRepItemsTable).values({
      id, schoolId: env.schoolId, classId: cls.id, createdByMemberId: actor.memberId!, createdByUserId: actor.userId,
      kind, title: d.title.trim().slice(0, MAX_TITLE), dueDate: d.due, remindDays: days, status: "active",
    });
    if (valid.length) await tx.insert(schoolRepItemGroupsTable).values(valid.map((g: { id: string }) => ({ itemId: id, groupId: g.id })));
  });
  await clearState(env.bot.id, chatId);

  // شفافیت: به معلم(هایی) که این دانش‌آموز را منتخب کرده‌اند خبر بده (best-effort).
  void (async () => {
    try {
      const t = await db.selectDistinct({ u: schoolClassRepsTable.teacherUserId }).from(schoolClassRepsTable)
        .where(and(eq(schoolClassRepsTable.classId, cls.id), eq(schoolClassRepsTable.studentMemberId, actor.memberId!)));
      await notifySchoolUsers({
        userIds: t.map((x: { u: string }) => x.u), schoolId: env.schoolId, kind: "school_rep_item",
        title: `ثبتِ ${REP_KIND_FA[kind]} توسطِ دانش‌آموزِ منتخب`,
        body: `${actor.name} برایِ کلاس «${cls.name}»: «${d.title.trim()}» — موعد ${jalaliString(d.due)}`, refId: id,
      });
    } catch (err) { logger.warn({ err }, "rep: teacher notify failed (non-fatal)"); }
  })();

  const where = valid.length ? `در ${fa(valid.length)} گروه یادآوری می‌شود` : "یادآوری‌ها فقط برایِ خودِ شما در همین چت می‌آید";
  return {
    text: [b("✅ ثبت شد"), "", summaryText({ ...d, days }), "", `🔔 ${where}.`].join("\n"),
    kb: withNav([[{ text: "➕ ثبتِ موردِ دیگر", callback_data: "r:home" }, { text: "📋 مواردِ ثبت‌شده", callback_data: "r:ls:0" }]]),
  };
}

// ─── مسیردهیِ دکمه‌ها (`r:*`) ──────────────────────────────────────────────────
export async function routeRepCallback(
  env: RepEnv, actor: Actor, chatId: string, data: string, p: string[],
  ans: (t?: string, a?: boolean) => Promise<void>, show: (s: Screen) => Promise<void>,
): Promise<void> {
  const [, a1, a2] = p;
  const classes = actor.role === "student" ? await repClasses(env.schoolId, actor.memberId) : [];
  if (!classes.length) { await ans("⛔️ این بخش فقط برایِ دانش‌آموزِ منتخب است", true); return; }
  const st = await getState(env.bot.id, chatId);

  switch (a1) {
    case "home": await ans(); await clearState(env.bot.id, chatId); return show(await repHomeScreen(env, actor));
    case "x": await ans("لغو شد"); await clearState(env.bot.id, chatId); return show(await repHomeScreen(env, actor));
    case "p": { // پاسخ به پرسشِ روزانه
      await ans();
      if (a2 === "no") { await clearState(env.bot.id, chatId); return show({ text: "باشه ✅ ممنون! هر وقت تکلیف یا امتحانی بود از «⭐ مسئولِ کلاس» ثبت کنید.", kb: withNav([[{ text: "⭐ مسئولِ کلاس", callback_data: "r:home" }]]) }); }
      return show(await repHomeScreen(env, actor));
    }
    case "n": await ans(); return show(await startNew(env, actor, chatId, a2));
    case "c": { // انتخابِ کلاس (وقتی بیش از یکی است)
      await ans();
      if (st?.state !== "rep_class") return show(await repHomeScreen(env, actor));
      const idx = Number(a2);
      const pick = (st.data.classes as { id: string; name: string }[])?.[idx];
      const real = pick && classes.find((c) => c.id === pick.id);
      if (!real) return show(await repHomeScreen(env, actor));
      return show(await askTitle(env, chatId, { kind: st.data.kind, classId: real.id, className: real.name }));
    }
    case "d": { // موعدِ سریع
      await ans();
      if (st?.state !== "rep_date") return show(await repHomeScreen(env, actor));
      const n = Number(a2);
      if (![1, 2, 3, 7].includes(n)) return show(await repHomeScreen(env, actor));
      return show(await afterDate(env, chatId, st.data, addDays(tehranDateStr(), n)));
    }
    case "z": { // انتخابِ روزهایِ یادآوری
      if (st?.state !== "rep_days") { await ans(); return show(await repHomeScreen(env, actor)); }
      const opts = daysOptions(st.data.due);
      if (a2 === "go") {
        const days = normalizeRemindDays(st.data.days).filter((n) => opts.includes(n));
        if (!days.length) { await ans("حداقل یک مورد را انتخاب کنید", true); return; }
        await ans();
        const g = await groupsScreen(env, actor, { ...st.data, days, groups: undefined, sel: [] }, true);
        await setState(env.bot.id, chatId, "rep_groups", g.data);
        return show(g.screen);
      }
      const n = Number(a2);
      if (!opts.includes(n)) { await ans(); return; }
      const set = new Set<number>(normalizeRemindDays(st.data.days));
      if (set.has(n)) set.delete(n); else set.add(n);
      const d = { ...st.data, days: [...set].sort((x, y) => y - x) };
      await ans();
      await setState(env.bot.id, chatId, "rep_days", d);
      return show(daysScreen(d));
    }
    case "g": { // انتخاب/تازه‌سازیِ گروه‌ها
      if (st?.state !== "rep_groups") { await ans(); return show(await repHomeScreen(env, actor)); }
      if (a2 === "re") {
        await ans("بررسی شد");
        const g = await groupsScreen(env, actor, st.data, true);
        await setState(env.bot.id, chatId, "rep_groups", g.data);
        return show(g.screen);
      }
      const idx = Number(a2);
      const groups = (st.data.groups ?? []) as PickGroup[];
      if (!Number.isInteger(idx) || idx < 0 || idx >= groups.length) { await ans(); return; }
      const set = new Set<number>((st.data.sel ?? []) as number[]);
      if (set.has(idx)) set.delete(idx); else set.add(idx);
      await ans();
      const g = await groupsScreen(env, actor, { ...st.data, sel: [...set] }, false);
      await setState(env.bot.id, chatId, "rep_groups", g.data);
      return show(g.screen);
    }
    case "ok": {
      if (st?.state !== "rep_groups") { await ans(); return show(await repHomeScreen(env, actor)); }
      await ans("ثبت شد ✅");
      return show(await saveItem(env, actor, chatId, st.data));
    }
    case "ls": await ans(); return show(await listScreen(env, actor, Math.max(0, parseInt(a2 ?? "0", 10) || 0)));
    case "rm": { // حذفِ موردِ خودش
      const itemId = a2;
      const [it] = await db.select().from(schoolRepItemsTable).where(and(eq(schoolRepItemsTable.id, itemId), eq(schoolRepItemsTable.schoolId, env.schoolId))).limit(1);
      if (!it || it.createdByUserId !== actor.userId || !classes.some((c) => c.id === it.classId)) { await ans("⛔️ این مورد را نمی‌توانید حذف کنید", true); return; }
      await db.update(schoolRepItemsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schoolRepItemsTable.id, it.id));
      await ans("حذف شد 🗑");
      return show(await listScreen(env, actor, 0));
    }
    case "gr": { // نمایشِ گروه‌ها و راهنما
      await ans();
      const groups = await pickableGroups(env, actor);
      const addUrl = env.bot.telegramUsername ? `https://t.me/${env.bot.telegramUsername}?startgroup=true` : null;
      const lines = [b("👥 گروه‌هایِ شما"), ""];
      if (groups.length) groups.forEach((g) => lines.push(`• ${esc(g.title)}${g.admin ? " 🛡" : ""}`));
      else lines.push("هنوز گروهی پیدا نشد که هم بات در آن باشد و هم شما.");
      lines.push("", "برایِ افزودنِ گروه: بات را به گروه اضافه کنید (بهتر است ادمین باشد)؛ اگر قبلاً اضافه شده، در همان گروه بنویسید /bind");
      const kb: Kb = [];
      if (addUrl) kb.push([{ text: "➕ افزودنِ بات به گروه", url: addUrl }]);
      return show({ text: lines.join("\n"), kb: withNav(kb, "r:home") });
    }
    default: await ans(); return show(await repHomeScreen(env, actor));
  }
}
