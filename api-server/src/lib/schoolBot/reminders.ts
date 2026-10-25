/**
 * lib/schoolBot/reminders.ts — «🔔 یادآورها» در باتِ مدرسه: ساخت/ویرایش/خاموش‌وروشن/حذفِ یادآورهایِ تکرارشونده برایِ دانش‌آموزان،
 * با دکمه و پیامِ متنی؛ برایِ دانش‌آموزِ منتخب (کلاسِ خودش)، معلم (کلاس‌هایش) و مدیر/معاون (همه). همان قوانینِ سایت:
 * همهٔ دسترسی‌ها از lib/schoolReminders.ts (resolveScope/getReminder) می‌آید و در **هر** callback دوباره سنجیده می‌شود.
 *
 * callback_data (≤۶۴ بایت): q:home[:p] · q:c:<classId|_> · q:d:<id> · q:tg|ts|em|ed|et|dl|dy:<id> · q:n:<classId|_> ·
 *   q:dt:<روز> · q:dp:<پیش‌تنظیم> · q:dn · q:ds · q:tp:<پیش‌تنظیمِ ساعت> · q:sv · q:x
 * وضعیتِ گفتگو (school_bot_chat_state، یک ساعت اعتبار): rm_msg → rm_days → rm_times → rm_confirm (ساخت) و rm_emsg / rm_edays / rm_etimes (ویرایش).
 * گروه‌هایِ تلگرام و بازهٔ تاریخ/روزهایِ استثنا از سایت تنظیم می‌شوند؛ در بات پیش‌فرض «پیامِ خصوصیِ هر دانش‌آموز» است.
 */
import { inArray } from "drizzle-orm";
import { db, schoolClassesTable } from "@workspace/db";
import type { SchoolBotRow } from "../schoolBotCore";
import { BotSender, esc, type Kb, type Screen } from "./tg";
import { ADMIN_LIKE, type Actor } from "./actor";
import { b, clearState, getState, paginate, pager, setState, trunc, withNav, type ChatState } from "./util";
import {
  ReminderError, createReminder, deleteReminder, getReminder, listReminders, recipientStats, resolveScope, scopeCan, updateReminder,
  type ReminderRow, type Scope,
} from "../schoolReminders";
import {
  WEEK_FA, buildReminderMessage, describeSchedule, describeWeekdays, nextRuns, normalizeWeekdays, parseTimes, tehranNow, validateReminder,
  weekdaysExcept, MAX_MESSAGE, MAX_TIMES, MIN_GAP_MINUTES,
} from "../schoolReminderSchedule";
import { jalaliString, weekdayFa } from "../schoolRepSchedule";

export type RmEnv = { bot: SchoolBotRow; sender: BotSender; schoolId: string; schoolName: string };
export const REMIND_HOME_ROW: Kb[number] = [{ text: "🔔 یادآورها", callback_data: "q:home" }];

const SCHOOL = "_"; // در callback_data = «کلِ مدرسه»
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faNum = (s: string | number) => String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
const CANCEL: Kb = [[{ text: "❌ انصراف", callback_data: "q:x" }]];
const DAY_PRESETS: number[][] = [[0, 1, 2, 3, 4, 5, 6], weekdaysExcept([6]), weekdaysExcept([5, 6]), [6]];
const DAY_PRESET_LABEL = ["هر روز", "همه جز جمعه", "جز پنجشنبه و جمعه", "فقط جمعه"];
const TIME_PRESETS: string[][] = [["06:00", "08:00"], ["21:00"], ["09:00", "12:00", "16:00", "20:00"], ["07:00"]];
const TIME_PRESET_LABEL = ["۰۶:۰۰ و ۰۸:۰۰", "۲۱:۰۰", "چهار بار: ۹، ۱۲، ۱۶، ۲۰", "۰۷:۰۰"];

/** آیا این کاربر اصلاً به «یادآورها» دسترسی دارد (برایِ نمایشِ دکمهٔ منو). */
export async function hasReminderAccess(schoolId: string, userId: string): Promise<boolean> {
  return (await resolveScope(userId, schoolId)) !== null;
}

const clsKey = (classId: string | null) => classId ?? SCHOOL;
const clsOf = (k: string | undefined): string | null | undefined => (k === SCHOOL ? null : k && k.length > 0 ? k : undefined);

async function classNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: schoolClassesTable.id, name: schoolClassesTable.name }).from(schoolClassesTable).where(inArray(schoolClassesTable.id, ids));
  return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
}

// ─── صفحه‌ها ──────────────────────────────────────────────────────────────────
async function homeScreen(scope: Scope, page = 0): Promise<Screen> {
  const names = await classNames(scope.classIds);
  const items = scope.classIds.map((id) => ({ id, name: names.get(id) ?? "—" })).sort((a, b2) => a.name.localeCompare(b2.name, "fa"));
  const pg = paginate(items, page, 8);
  const kb: Kb = pg.slice.map((c) => [{ text: `🏫 ${trunc(c.name, 30)}`, callback_data: `q:c:${c.id}` }]);
  if (scope.all) kb.push([{ text: "🏛 کلِ مدرسه", callback_data: `q:c:${SCHOOL}` }]);
  if (pg.pages > 1) kb.push(pager("q:home", pg.page, pg.pages));
  return {
    text: `${b("🔔 یادآورها")}\nپیامِ تکرارشونده برایِ دانش‌آموزان؛ روزها و ساعت‌ها را خودتان تعیین می‌کنید.\n${items.length || scope.all ? "کلاس را انتخاب کنید:" : "کلاسی برایِ شما تعریف نشده است."}`,
    kb: withNav(kb),
  };
}

function runLabel(r: ReminderRow): string {
  if (!r.active) return "⏸ متوقف";
  const n = nextRuns(r, tehranNow(), 1)[0];
  return n ? `بعدی: ${weekdayFa(n.date)} ${jalaliString(n.date)} ساعت ${faNum(n.time)}` : "اجرای بعدی ندارد";
}

async function listScreen(env: RmEnv, scope: Scope, classId: string | null, page = 0): Promise<Screen> {
  const all = (await listReminders(env.schoolId, scope)).filter((r) => r.classId === classId);
  const names = classId ? await classNames([classId]) : new Map<string, string>();
  const title = classId ? `🏫 ${esc(names.get(classId) ?? "")}` : "🏛 کلِ مدرسه";
  const pg = paginate(all, page, 6);
  const kb: Kb = pg.slice.map((r) => [{ text: `${r.active ? "🔔" : "⏸"} ${trunc(r.message.replace(/\s+/g, " "), 24)} · ${faNum(r.times[0] ?? "")}${r.times.length > 1 ? ` +${faNum(r.times.length - 1)}` : ""}`, callback_data: `q:d:${r.id}` }]);
  if (pg.pages > 1) kb.push(pager(`q:c:${clsKey(classId)}`, pg.page, pg.pages));
  kb.push([{ text: "➕ یادآورِ جدید", callback_data: `q:n:${clsKey(classId)}` }]);
  return { text: `${b(title)}\n${all.length ? `${faNum(all.length)} یادآور` : "هنوز یادآوری ندارد. با «➕» بسازید."}`, kb: withNav(kb, "q:home") };
}

async function detailScreen(env: RmEnv, scope: Scope, r: ReminderRow, note?: string): Promise<Screen> {
  const stats = await recipientStats(env.schoolId, r.classId).catch(() => null);
  const runs = r.active ? nextRuns(r, tehranNow(), 3).map((x) => `${weekdayFa(x.date)} ${jalaliString(x.date)} · ${faNum(x.time)}`) : [];
  const text = [
    note ? `${note}\n` : "",
    `${r.active ? "🔔" : "⏸"} ${b(r.className ?? "کلِ مدرسه")}${r.title ? ` — ${esc(r.title)}` : ""}`,
    "",
    esc(r.message),
    "",
    `🗓 ${esc(describeSchedule(r))}`,
    runs.length ? `⏭ ${runs.join(" ‹ ")}` : `⏸ ${runLabel(r)}`,
    stats ? `👥 ${faNum(stats.connected)} از ${faNum(stats.students)} دانش‌آموز به بات وصل‌اند` : "",
    `👤 ${esc(r.createdByName)}`,
  ].filter((x) => x !== "").join("\n");
  const kb: Kb = [
    [{ text: r.active ? "⏸ توقف" : "▶️ فعال‌سازی", callback_data: `q:tg:${r.id}` }, { text: "🧪 نمونه", callback_data: `q:ts:${r.id}` }],
    [{ text: "✏️ متن", callback_data: `q:em:${r.id}` }, { text: "📅 روزها", callback_data: `q:ed:${r.id}` }, { text: "⏰ ساعت‌ها", callback_data: `q:et:${r.id}` }],
    [{ text: "🗑 حذف", callback_data: `q:dl:${r.id}` }],
  ];
  return { text, kb: withNav(kb, `q:c:${clsKey(r.classId)}`) };
}

function daysScreen(d: Record<string, any>, editing: boolean): Screen {
  const days = normalizeWeekdays(d.weekdays);
  const dayBtn = (i: number) => ({ text: `${days.includes(i) ? "✅" : "▫️"} ${WEEK_FA[i]}`, callback_data: `q:dt:${i}` });
  const kb: Kb = [
    DAY_PRESETS.slice(0, 2).map((_, i) => ({ text: DAY_PRESET_LABEL[i], callback_data: `q:dp:${i}` })),
    DAY_PRESETS.slice(2).map((_, i) => ({ text: DAY_PRESET_LABEL[i + 2], callback_data: `q:dp:${i + 2}` })),
    [dayBtn(0), dayBtn(1), dayBtn(2), dayBtn(3)],
    [dayBtn(4), dayBtn(5), dayBtn(6)],
    [days.length ? (editing ? { text: "💾 ذخیره", callback_data: "q:ds" } : { text: "ادامه ▶️", callback_data: "q:dn" }) : { text: "حداقل یک روز را انتخاب کنید", callback_data: "q:noop" }],
    [{ text: "❌ انصراف", callback_data: "q:x" }],
  ];
  return { text: `${b("📅 روزهایِ هفته")}\nروزهایی که یادآوری می‌رود را روشن/خاموش کنید.\n\n${esc(describeWeekdays(days))}`, kb };
}

function timesPrompt(): Screen {
  return {
    text: `${b("⏰ ساعت‌ها (به وقتِ تهران)")}\nساعت‌ها را بفرستید؛ چندتا را با فاصله جدا کنید.\nمثال: ${faNum("06:00 08:00")}  یا  ${faNum("21")}\nحداکثر ${faNum(MAX_TIMES)} ساعت، با فاصلهٔ حداقل ${faNum(MIN_GAP_MINUTES)} دقیقه. یا یکی از گزینه‌هایِ آماده را بزنید:`,
    kb: [
      TIME_PRESETS.slice(0, 2).map((_, i) => ({ text: TIME_PRESET_LABEL[i], callback_data: `q:tp:${i}` })),
      TIME_PRESETS.slice(2).map((_, i) => ({ text: TIME_PRESET_LABEL[i + 2], callback_data: `q:tp:${i + 2}` })),
      [{ text: "❌ انصراف", callback_data: "q:x" }],
    ],
  };
}

async function confirmScreen(env: RmEnv, d: Record<string, any>): Promise<Screen> {
  const stats = await recipientStats(env.schoolId, d.classId ?? null).catch(() => null);
  const sched = describeSchedule({ weekdays: d.weekdays, times: d.times });
  return {
    text: [
      b("✅ تأییدِ یادآور"),
      `${d.classId ? "🏫" : "🏛"} ${esc(d.className ?? "کلِ مدرسه")}`,
      "",
      esc(d.message),
      "",
      `🗓 ${esc(sched)}`,
      stats ? `👥 ${faNum(stats.connected)} از ${faNum(stats.students)} دانش‌آموز به بات وصل‌اند و پیام را در پیوی می‌گیرند.` : "",
      "گروه‌هایِ تلگرام و بازهٔ تاریخ را از سایت (بخشِ «یادآورها») می‌توانید اضافه کنید.",
    ].filter((x) => x !== "").join("\n"),
    kb: [[{ text: "💾 ذخیره", callback_data: "q:sv" }], [{ text: "⏰ تغییرِ ساعت‌ها", callback_data: "q:dn" }, { text: "❌ انصراف", callback_data: "q:x" }]],
  };
}

// ─── مجوز ─────────────────────────────────────────────────────────────────────
async function scopeFor(env: RmEnv, actor: Actor): Promise<Scope | null> {
  return resolveScope(actor.userId, env.schoolId);
}
const deniedMsg = "⛔️ این بخش فقط برایِ مدیر، معلمِ کلاس و دانش‌آموزِ منتخب است";

// ─── callback ─────────────────────────────────────────────────────────────────
export async function routeReminderCallback(
  env: RmEnv, actor: Actor, chatId: string, _data: string, p: string[],
  ans: (t?: string, a?: boolean) => Promise<void>, show: (s: Screen) => Promise<void>,
): Promise<void> {
  const [, a1, a2] = p;
  const scope = await scopeFor(env, actor);
  if (!scope) { await ans(deniedMsg, true); return; }
  const st = await getState(env.bot.id, chatId);

  const detailById = async (id: string, note?: string) => {
    const r = await getReminder(env.schoolId, id, scope);
    return detailScreen(env, scope, r, note);
  };

  try {
    switch (a1) {
      case "noop": await ans("حداقل یک روز را انتخاب کنید"); return;
      case "home": await ans(); await clearState(env.bot.id, chatId); return show(await homeScreen(scope, Number(a2) || 0));
      case "x": await ans("لغو شد"); await clearState(env.bot.id, chatId); return show(await homeScreen(scope));
      case "c": {
        await ans(); await clearState(env.bot.id, chatId);
        const cid = clsOf(a2);
        if (cid === undefined || !scopeCan(scope, cid)) return show(await homeScreen(scope));
        return show(await listScreen(env, scope, cid, Number(p[3]) || 0));
      }
      case "d": await ans(); return show(await detailById(a2));
      case "tg": {
        const r = await getReminder(env.schoolId, a2, scope);
        await updateReminder(env.schoolId, scope, a2, { active: !r.active });
        await ans(r.active ? "متوقف شد" : "فعال شد");
        return show(await detailById(a2));
      }
      case "ts": {
        const r = await getReminder(env.schoolId, a2, scope);
        await ans("نمونه فرستاده شد");
        await env.sender.send(chatId, `🧪 <b>نمونه</b>\n\n${buildReminderMessage(r.message, r.className)}`);
        return;
      }
      case "dl": {
        await ans(); const r = await getReminder(env.schoolId, a2, scope);
        return show({ text: `${b("🗑 حذفِ این یادآور؟")}\n\n${esc(trunc(r.message, 300))}\n\n${esc(describeSchedule(r))}`, kb: [[{ text: "✅ بله، حذف", callback_data: `q:dy:${a2}` }, { text: "↩️ نه", callback_data: `q:d:${a2}` }]] });
      }
      case "dy": {
        const r = await getReminder(env.schoolId, a2, scope);
        await deleteReminder(env.schoolId, scope, a2);
        await ans("حذف شد");
        return show(await listScreen(env, scope, r.classId));
      }
      // ─ ساخت
      case "n": {
        await ans();
        const cid = clsOf(a2);
        if (cid === undefined || !scopeCan(scope, cid)) return show(await homeScreen(scope));
        const names = cid ? await classNames([cid]) : new Map<string, string>();
        await setState(env.bot.id, chatId, "rm_msg", { classId: cid, className: cid ? names.get(cid) ?? "" : null });
        return show({ text: `${b("✏️ متنِ پیام")}\nمتنی که به دانش‌آموزان می‌رسد را بفرستید.\nمثال: «خودکار بزن» یا «گزارشِ کار را بفرست».\n(حداکثر ${faNum(MAX_MESSAGE)} نویسه)`, kb: CANCEL });
      }
      case "dt": {
        await ans();
        if (!st || !["rm_days", "rm_edays"].includes(st.state)) return show(await homeScreen(scope));
        const i = Number(a2);
        if (!Number.isInteger(i) || i < 0 || i > 6) return;
        const cur = normalizeWeekdays(st.data.weekdays);
        const weekdays = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((x, y) => x - y);
        const data = { ...st.data, weekdays };
        await setState(env.bot.id, chatId, st.state, data);
        return show(daysScreen(data, st.state === "rm_edays"));
      }
      case "dp": {
        await ans();
        if (!st || !["rm_days", "rm_edays"].includes(st.state)) return show(await homeScreen(scope));
        const preset = DAY_PRESETS[Number(a2)];
        if (!preset) return;
        const data = { ...st.data, weekdays: preset };
        await setState(env.bot.id, chatId, st.state, data);
        return show(daysScreen(data, st.state === "rm_edays"));
      }
      case "dn": {
        await ans();
        if (!st || !["rm_days", "rm_times", "rm_confirm"].includes(st.state) || normalizeWeekdays(st.data.weekdays).length === 0) return show(await homeScreen(scope));
        await setState(env.bot.id, chatId, "rm_times", st.data);
        return show(timesPrompt());
      }
      case "tp": { // پیش‌تنظیمِ ساعت (ساخت یا ویرایش)
        await ans();
        const times = TIME_PRESETS[Number(a2)];
        if (!times || !st) return show(await homeScreen(scope));
        if (st.state === "rm_times") {
          const data = { ...st.data, times };
          await setState(env.bot.id, chatId, "rm_confirm", data);
          return show(await confirmScreen(env, data));
        }
        if (st.state === "rm_etimes") {
          await updateReminder(env.schoolId, scope, st.data.id, { times });
          await clearState(env.bot.id, chatId);
          return show(await detailById(st.data.id, "✅ ساعت‌ها به‌روز شد"));
        }
        return show(await homeScreen(scope));
      }
      case "sv": {
        if (!st || st.state !== "rm_confirm") { await ans(); return show(await homeScreen(scope)); }
        const d = st.data;
        const v = validateReminder({ message: d.message, weekdays: d.weekdays, times: d.times });
        if (!v.ok) { await ans(v.errors[0], true); return; }
        const id = await createReminder(env.schoolId, scope, d.classId ?? null, v.value as any, []);
        await clearState(env.bot.id, chatId);
        await ans("ذخیره شد ✅");
        return show(await detailById(id, "✅ یادآور ساخته شد"));
      }
      // ─ ویرایش
      case "em": {
        await ans(); await getReminder(env.schoolId, a2, scope);
        await setState(env.bot.id, chatId, "rm_emsg", { id: a2 });
        return show({ text: `${b("✏️ متنِ تازه")}\nمتنِ جدیدِ پیام را بفرستید.`, kb: CANCEL });
      }
      case "ed": {
        await ans(); const r = await getReminder(env.schoolId, a2, scope);
        const data = { id: a2, weekdays: r.weekdays };
        await setState(env.bot.id, chatId, "rm_edays", data);
        return show(daysScreen(data, true));
      }
      case "ds": {
        if (!st || st.state !== "rm_edays") { await ans(); return show(await homeScreen(scope)); }
        await updateReminder(env.schoolId, scope, st.data.id, { weekdays: normalizeWeekdays(st.data.weekdays) });
        await clearState(env.bot.id, chatId);
        await ans("ذخیره شد ✅");
        return show(await detailById(st.data.id, "✅ روزها به‌روز شد"));
      }
      case "et": {
        await ans(); await getReminder(env.schoolId, a2, scope);
        await setState(env.bot.id, chatId, "rm_etimes", { id: a2 });
        return show(timesPrompt());
      }
      default: await ans(); return show(await homeScreen(scope));
    }
  } catch (err) {
    if (err instanceof ReminderError) { await ans(err.message, true); return; }
    throw err;
  }
}

// ─── پیامِ متنی (مراحلِ متنی) ─────────────────────────────────────────────────
/** true یعنی پیام در همین ماژول مصرف شد. */
export async function onReminderText(env: RmEnv, actor: Actor, chatId: string, st: ChatState | null, text: string): Promise<boolean> {
  if (!st || !st.state.startsWith("rm_")) return false;
  const scope = await scopeFor(env, actor);
  if (!scope) { await clearState(env.bot.id, chatId); return false; }
  const send = (s: Screen) => env.sender.send(chatId, s.text, s.kb);
  const t = text.trim();

  try {
    if (st.state === "rm_msg" || st.state === "rm_emsg") {
      const v = validateReminder({ message: t }, true);
      if (!v.ok) { await send({ text: `${esc(v.errors[0])}\nدوباره بفرستید یا انصراف دهید.`, kb: CANCEL }); return true; }
      if (st.state === "rm_emsg") {
        await updateReminder(env.schoolId, scope, st.data.id, { message: v.value.message });
        await clearState(env.bot.id, chatId);
        const r = await getReminder(env.schoolId, st.data.id, scope);
        await send(await detailScreen(env, scope, r, "✅ متن به‌روز شد"));
        return true;
      }
      const data = { ...st.data, message: v.value.message, weekdays: [0, 1, 2, 3, 4] };
      await setState(env.bot.id, chatId, "rm_days", data);
      await send(daysScreen(data, false));
      return true;
    }
    if (st.state === "rm_times" || st.state === "rm_etimes") {
      const parsed = parseTimes(t);
      if (!parsed.ok) {
        const why = parsed.reason === "too_many" ? `حداکثر ${faNum(MAX_TIMES)} ساعت` : parsed.bad ? `«${esc(parsed.bad)}» ساعتِ معتبر نیست` : "ساعتی نفرستادید";
        await send({ text: `${why}.\nمثال: ${faNum("06:00 08:00")}`, kb: timesPrompt().kb });
        return true;
      }
      const v = validateReminder({ times: parsed.times }, true);
      if (!v.ok) { await send({ text: `${esc(v.errors[0])}\nدوباره بفرستید.`, kb: timesPrompt().kb }); return true; }
      if (st.state === "rm_etimes") {
        await updateReminder(env.schoolId, scope, st.data.id, { times: parsed.times });
        await clearState(env.bot.id, chatId);
        const r = await getReminder(env.schoolId, st.data.id, scope);
        await send(await detailScreen(env, scope, r, "✅ ساعت‌ها به‌روز شد"));
        return true;
      }
      const data = { ...st.data, times: parsed.times };
      await setState(env.bot.id, chatId, "rm_confirm", data);
      await send(await confirmScreen(env, data));
      return true;
    }
    // rm_days / rm_confirm: منتظرِ دکمه‌ایم، نه متن.
    await send({ text: "لطفاً از دکمه‌هایِ زیرِ پیامِ قبلی استفاده کنید، یا انصراف دهید.", kb: CANCEL });
    return true;
  } catch (err) {
    if (err instanceof ReminderError) { await send({ text: `⚠️ ${esc(err.message)}`, kb: CANCEL }); return true; }
    throw err;
  }
}

export { ADMIN_LIKE };
