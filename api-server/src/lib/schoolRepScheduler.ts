/**
 * lib/schoolRepScheduler.ts — جاب پس‌زمینهٔ «دانش‌آموزِ منتخب» (هر ۵ دقیقه؛ همان الگویِ setInterval + advisory lockِ paymentSweeper).
 *
 *  ۱. یادآوری: برایِ هر موردِ فعال که «امروز» دقیقاً N روز مانده به موعدش است و N جزوِ روزهایِ انتخابیِ منتخب است،
 *     پیامِ یادآوری در هر گروهِ انتخاب‌شده فرستاده می‌شود — **حداکثر یک‌بار** برایِ هر (مورد، گروه، N)
 *     (کلیدِ اصلیِ `school_rep_reminder_log`؛ ثبتِ ردیف پیش از ارسال = claim، پس چندنمونه‌ای/ری‌استارت امن است).
 *     اگر مورد گروهی ندارد، یادآوری به خودِ منتخب (پیوی) می‌رود (`school_rep_dm_log`).
 *     فقط از ساعتِ `SCHOOL_REP_REMIND_HOUR` (پیش‌فرض ۱۵) تا ۲۳ به وقتِ تهران.
 *  ۲. پرسشِ روزانه: عصر (`SCHOOL_REP_PROMPT_HOUR`، پیش‌فرض ۱۸ تا ۲۱) به هر منتخبِ متصل به بات: «تکلیف یا امتحان داری؟»
 *     حداکثر یک‌بار در روز (`school_class_reps.last_prompt_on`)، جمعه‌ها نه، و اگر امروز خودش موردی ثبت کرده نه.
 *  ۳. مواردِ گذشته (`due_date < امروز`) → `done`.
 * خطای هر مرحله مرحله‌هایِ بعد را متوقف نمی‌کند؛ هیچ‌چیز از این‌جا throw نمی‌شود.
 * خاموش‌کردن: SCHOOL_REP_ENABLED=0.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, schoolRepItemsTable, schoolRepItemGroupsTable, schoolBotGroupsTable, schoolRepReminderLogTable, schoolRepDmLogTable,
  schoolClassRepsTable, schoolClassesTable, schoolMembersTable, usersTable, schoolBotSubscribersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { loadSchoolBotBySchool } from "./schoolBotCore";
import { BotSender } from "./schoolBot/tg";
import { repPromptScreen } from "./schoolBot/reps";
import { tehranDateStr } from "./schoolBot/util";
import { addDays, buildReminderText, dowOf, normalizeRemindDays, reminderDueToday, tehranHour, type RepKind } from "./schoolRepSchedule";

export const SWEEP_INTERVAL_MS = 5 * 60_000;
const LOCK_KEY = "school_rep_scheduler";
const MAX_PROMPTS_PER_SWEEP = 100;
const MAX_REMINDERS_PER_SWEEP = 400;
const REMIND_UNTIL_HOUR = 23;
const PROMPT_UNTIL_HOUR = 21;
const FRIDAY = 6;

const envInt = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d; };
export const remindHour = () => envInt("SCHOOL_REP_REMIND_HOUR", 15);
export const promptHour = () => envInt("SCHOOL_REP_PROMPT_HOUR", 18);

export interface RepSweepReport {
  at: Date;
  skipped?: "lock_held" | "disabled";
  expired: number;
  remindersSent: number;
  remindersFailed: number;
  dmFallbacks: number;
  promptsSent: number;
}
const emptyReport = (at: Date): RepSweepReport => ({ at, expired: 0, remindersSent: 0, remindersFailed: 0, dmFallbacks: 0, promptsSent: 0 });

// فرستنده به‌ازایِ هر مدرسه، فقط در همین جاروب cache می‌شود.
type Sender = { bot: { id: string }; sender: BotSender } | null;
async function senderFor(cache: Map<string, Sender>, schoolId: string): Promise<Sender> {
  if (cache.has(schoolId)) return cache.get(schoolId)!;
  const loaded = await loadSchoolBotBySchool(schoolId);
  const v: Sender = loaded ? { bot: { id: loaded.bot.id }, sender: new BotSender(loaded.bot.id, loaded.token) } : null;
  cache.set(schoolId, v);
  return v;
}

/** chat_id پیویِ کاربر در بات (فقط اگر دسترس‌پذیر). */
async function dmChatOf(botId: string, userId: string): Promise<string | null> {
  const [s] = await db.select().from(schoolBotSubscribersTable)
    .where(and(eq(schoolBotSubscribersTable.schoolBotId, botId), eq(schoolBotSubscribersTable.userId, userId)))
    .orderBy(desc(schoolBotSubscribersTable.linkedAt)).limit(1);
  return s && !s.unreachableAt ? s.telegramChatId : null;
}

const PERMANENT_GROUP_ERR = /chat not found|bot was kicked|bot is not a member|have no rights to send|not enough rights|group chat was deleted|CHAT_WRITE_FORBIDDEN|Forbidden/i;

async function sweepReminders(today: string, rep: RepSweepReport, cache: Map<string, Sender>) {
  const items = await db.select().from(schoolRepItemsTable)
    .where(and(eq(schoolRepItemsTable.status, "active"), sql`${schoolRepItemsTable.dueDate} >= ${today}`, sql`${schoolRepItemsTable.dueDate} <= ${addDays(today, 7)}`))
    .limit(2000);
  let budget = MAX_REMINDERS_PER_SWEEP;

  for (const item of items) {
    if (budget <= 0) break;
    const diff = reminderDueToday(today, item.dueDate, normalizeRemindDays(item.remindDays));
    if (diff === null) continue;
    const s = await senderFor(cache, item.schoolId);
    if (!s) continue;

    const [cls] = await db.select({ name: schoolClassesTable.name }).from(schoolClassesTable).where(eq(schoolClassesTable.id, item.classId)).limit(1);
    const [creator] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, item.createdByUserId)).limit(1);
    const text = buildReminderText({
      kind: item.kind as RepKind, title: item.title, dueDate: item.dueDate, diff,
      className: cls?.name ?? "—", repName: creator?.name ?? "دانش‌آموزِ منتخب",
    });

    const groups = await db.select({ g: schoolBotGroupsTable }).from(schoolRepItemGroupsTable)
      .innerJoin(schoolBotGroupsTable, eq(schoolBotGroupsTable.id, schoolRepItemGroupsTable.groupId))
      .where(and(eq(schoolRepItemGroupsTable.itemId, item.id), eq(schoolBotGroupsTable.schoolBotId, s.bot.id)));

    if (groups.length === 0) {
      // بدونِ گروه ← یادآوریِ شخصی برایِ منتخب (یک‌بار برایِ هر (مورد، N)).
      const claim = await db.insert(schoolRepDmLogTable).values({ itemId: item.id, daysBefore: diff }).onConflictDoNothing().returning({ itemId: schoolRepDmLogTable.itemId });
      if (!claim.length) continue;
      const chat = await dmChatOf(s.bot.id, item.createdByUserId);
      if (!chat) continue;
      budget--;
      const r = await s.sender.send(chat, text);
      if (r.ok) rep.dmFallbacks++; else rep.remindersFailed++;
      continue;
    }

    for (const { g } of groups) {
      if (budget <= 0) break;
      if (!["administrator", "member", "restricted"].includes(g.botStatus) || !g.canPost) continue;
      const claim = await db.insert(schoolRepReminderLogTable).values({ itemId: item.id, groupId: g.id, daysBefore: diff, ok: true })
        .onConflictDoNothing().returning({ itemId: schoolRepReminderLogTable.itemId });
      if (!claim.length) continue; // قبلاً ارسال/claim شده
      budget--;
      const r = await s.sender.send(g.telegramChatId, text, undefined, { silent: diff > 0 });
      if (r.ok) { rep.remindersSent++; continue; }
      rep.remindersFailed++;
      if (r.description === "network") {
        // خطای گذرا: claim را برمی‌داریم تا جاروبِ بعدی دوباره تلاش کند.
        await db.delete(schoolRepReminderLogTable).where(and(eq(schoolRepReminderLogTable.itemId, item.id), eq(schoolRepReminderLogTable.groupId, g.id), eq(schoolRepReminderLogTable.daysBefore, diff)));
        continue;
      }
      await db.update(schoolRepReminderLogTable).set({ ok: false })
        .where(and(eq(schoolRepReminderLogTable.itemId, item.id), eq(schoolRepReminderLogTable.groupId, g.id), eq(schoolRepReminderLogTable.daysBefore, diff)));
      if (PERMANENT_GROUP_ERR.test(r.description ?? "")) {
        await db.update(schoolBotGroupsTable).set({ canPost: false, updatedAt: new Date() }).where(eq(schoolBotGroupsTable.id, g.id));
        const chat = await dmChatOf(s.bot.id, item.createdByUserId);
        if (chat) await s.sender.send(chat, `⚠️ نتوانستم در گروهِ «${g.title.replace(/[<>&]/g, "")}» یادآوری بفرستم (بات حذف شده یا اجازهٔ ارسال ندارد). بات را دوباره به گروه اضافه/ادمین کنید.`);
      }
    }
  }
}

async function sweepPrompts(today: string, rep: RepSweepReport, cache: Map<string, Sender>) {
  const rows = await db.select({
    studentMemberId: schoolClassRepsTable.studentMemberId, schoolId: schoolClassRepsTable.schoolId, className: schoolClassesTable.name,
  }).from(schoolClassRepsTable)
    .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolClassRepsTable.classId))
    .where(sql`(${schoolClassRepsTable.lastPromptOn} IS NULL OR ${schoolClassRepsTable.lastPromptOn} < ${today})`)
    .limit(1000);
  if (!rows.length) return;

  const byStudent = new Map<string, { schoolId: string; classes: Set<string> }>();
  for (const r of rows) {
    const cur = byStudent.get(r.studentMemberId) ?? { schoolId: r.schoolId, classes: new Set<string>() };
    cur.classes.add(r.className);
    byStudent.set(r.studentMemberId, cur);
  }
  const memberIds = [...byStudent.keys()];
  const members = await db.select({ id: schoolMembersTable.id, userId: schoolMembersTable.userId, name: usersTable.name })
    .from(schoolMembersTable).innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
    .where(inArray(schoolMembersTable.id, memberIds));
  const mById = new Map<string, typeof members[number]>(members.map((m: typeof members[number]) => [m.id, m]));

  // امروز خودش موردی ثبت کرده؟ ← نپرس.
  const doneToday = await db.selectDistinct({ m: schoolRepItemsTable.createdByMemberId }).from(schoolRepItemsTable)
    .where(and(inArray(schoolRepItemsTable.createdByMemberId, memberIds), sql`to_char(${schoolRepItemsTable.createdAt} AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD') = ${today}`));
  const skip = new Set<string>(doneToday.map((x: { m: string }) => x.m));

  let sent = 0;
  for (const [memberId, v] of byStudent) {
    if (sent >= MAX_PROMPTS_PER_SWEEP) break;
    const markDone = () => db.update(schoolClassRepsTable).set({ lastPromptOn: today }).where(eq(schoolClassRepsTable.studentMemberId, memberId));
    if (skip.has(memberId)) { await markDone(); continue; }
    const m = mById.get(memberId);
    const s = await senderFor(cache, v.schoolId);
    if (!m || !s) continue;
    const chat = await dmChatOf(s.bot.id, m.userId);
    if (!chat) continue; // هنوز به بات وصل نشده؛ دوباره بعداً امتحان می‌شود
    const screen = repPromptScreen(m.name || "دوست", [...v.classes].join("، "));
    const r = await s.sender.send(chat, screen.text, screen.kb);
    await markDone();
    if (r.ok) { rep.promptsSent++; sent++; }
  }
}

/** یک دورِ کاملِ جاروب (بدونِ قفل؛ برایِ تست و فراخوانیِ دستی). `now` تزریق‌پذیر است. */
export async function runSchoolRepSweep(now = new Date()): Promise<RepSweepReport> {
  const rep = emptyReport(now);
  if (process.env.SCHOOL_REP_ENABLED === "0") { rep.skipped = "disabled"; return rep; }
  const today = tehranDateStr(now);
  const hour = tehranHour(now);
  const cache = new Map<string, Sender>();

  try {
    const r = await db.update(schoolRepItemsTable).set({ status: "done", updatedAt: new Date() })
      .where(and(eq(schoolRepItemsTable.status, "active"), sql`${schoolRepItemsTable.dueDate} < ${today}`)).returning({ id: schoolRepItemsTable.id });
    rep.expired = r.length;
  } catch (err) { logger.error({ err }, "schoolRep sweep: expire failed"); }

  if (hour >= remindHour() && hour < REMIND_UNTIL_HOUR) {
    try { await sweepReminders(today, rep, cache); } catch (err) { logger.error({ err }, "schoolRep sweep: reminders failed"); }
  }
  if (hour >= promptHour() && hour < PROMPT_UNTIL_HOUR && dowOf(today) !== FRIDAY) {
    try { await sweepPrompts(today, rep, cache); } catch (err) { logger.error({ err }, "schoolRep sweep: prompts failed"); }
  }
  return rep;
}

export interface PoolLike { connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void }> }

/** با advisory lockِ سطحِ session: فقط یک نمونه هم‌زمان جاروب می‌کند. */
export async function runSchoolRepSweepLocked(pool: PoolLike, now = new Date()): Promise<RepSweepReport> {
  const conn = await pool.connect();
  try {
    const { rows } = await conn.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok", [LOCK_KEY]);
    if (!rows[0]?.ok) { const r = emptyReport(now); r.skipped = "lock_held"; return r; }
    try { return await runSchoolRepSweep(now); }
    finally { try { await conn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]); } catch { /* با بسته‌شدنِ session آزاد می‌شود */ } }
  } finally { conn.release(); }
}

export function startSchoolRepScheduler(pool: PoolLike): void {
  if (process.env.SCHOOL_REP_ENABLED === "0") { logger.info("school rep scheduler disabled (SCHOOL_REP_ENABLED=0)"); return; }
  const tick = () => {
    void runSchoolRepSweepLocked(pool)
      .then((r) => { if (r.remindersSent || r.promptsSent || r.remindersFailed || r.dmFallbacks || r.expired) logger.info({ report: r }, "school rep sweep"); })
      .catch((err) => logger.error({ err }, "school rep sweep failed"));
  };
  setTimeout(tick, 90_000);
  setInterval(tick, SWEEP_INTERVAL_MS).unref?.();
}
