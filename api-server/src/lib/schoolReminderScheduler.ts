/**
 * lib/schoolReminderScheduler.ts — جاب پس‌زمینهٔ «یادآورهایِ دانش‌آموزی» (هر ۶۰ ثانیه؛ همان الگویِ setInterval + advisory lockِ schoolRepScheduler).
 *
 * هر دقیقه: یادآورهایِ فعالی که «امروز» روزِ اجرایشان است و ساعتی از آن‌ها سررسیده (حداکثر ۴۵ دقیقه عقب‌تر؛ قدیمی‌تر از آن دیگر نمی‌رود)
 * را برایِ هر مقصد می‌فرستد:
 *   • پیویِ هر دانش‌آموزِ کلاس که به بات وصل است (اگر send_dm)
 *   • هر گروهِ انتخاب‌شده که بات در آن می‌تواند پیام بدهد
 * ایمنی: ردیفِ `school_reminder_log` (کلیدِ ترکیبیِ یادآور+روز+ساعت+مقصد) **پیش** از ارسال claim می‌شود؛ پس ری‌استارت/چندنمونه‌ای/دوبار-اجرا
 * هرگز پیامِ تکراری نمی‌فرستد. خطای گذرا (شبکه) claim را برمی‌دارد تا دقیقهٔ بعد دوباره تلاش شود؛ خطای دائمی ثبت می‌شود.
 * خاموش‌کردن: SCHOOL_REMINDERS_ENABLED=0.
 */
import { and, desc, eq, inArray, lte, or, isNull, gte, sql } from "drizzle-orm";
import {
  db, schoolRemindersTable, schoolReminderGroupsTable, schoolReminderLogTable, schoolBotGroupsTable, schoolClassesTable,
  schoolBotSubscribersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { loadSchoolBotBySchool } from "./schoolBotCore";
import { BotSender } from "./schoolBot/tg";
import { addDays } from "./schoolRepSchedule";
import { buildReminderMessage, dueSlots, tehranNow } from "./schoolReminderSchedule";
import { studentChats } from "./schoolReminders";

export const REMINDER_SWEEP_INTERVAL_MS = 60_000;
const LOCK_KEY = "school_reminder_scheduler";
const MAX_SENDS_PER_SWEEP = 1500;
const LOG_RETENTION_DAYS = 14;
const PERMANENT_GROUP_ERR = /chat not found|bot was kicked|bot is not a member|have no rights to send|not enough rights|group chat was deleted|CHAT_WRITE_FORBIDDEN|Forbidden/i;

export interface SenderLike { botId: string; send(chatId: string, text: string, kb?: undefined, opts?: { silent?: boolean }): Promise<{ ok: boolean; blocked: boolean; description?: string }> }
export interface ReminderSweepDeps { senderFor?: (schoolId: string) => Promise<SenderLike | null> }

export interface ReminderSweepReport {
  at: Date;
  skipped?: "lock_held" | "disabled";
  remindersFired: number;
  sent: number;
  failed: number;
  blocked: number;
  retryLater: number;
  budgetHit: boolean;
}
const emptyReport = (at: Date): ReminderSweepReport => ({ at, remindersFired: 0, sent: 0, failed: 0, blocked: 0, retryLater: 0, budgetHit: false });

async function defaultSenderFor(schoolId: string): Promise<SenderLike | null> {
  const loaded = await loadSchoolBotBySchool(schoolId);
  if (!loaded) return null;
  const s = new BotSender(loaded.bot.id, loaded.token);
  return { botId: loaded.bot.id, send: (chat, text, kb, opts) => s.send(chat, text, kb, opts) };
}

async function creatorChat(botId: string, userId: string): Promise<string | null> {
  const [s] = await db.select().from(schoolBotSubscribersTable)
    .where(and(eq(schoolBotSubscribersTable.schoolBotId, botId), eq(schoolBotSubscribersTable.userId, userId)))
    .orderBy(desc(schoolBotSubscribersTable.linkedAt)).limit(1);
  return s && !s.unreachableAt ? s.telegramChatId : null;
}

let lastCleanupDate = "";

/** یک دورِ کاملِ جاروب (بدونِ قفل؛ برایِ تست و فراخوانیِ دستی). `now` و فرستنده تزریق‌پذیرند. */
export async function runReminderSweep(now = new Date(), deps: ReminderSweepDeps = {}): Promise<ReminderSweepReport> {
  const rep = emptyReport(now);
  if (process.env.SCHOOL_REMINDERS_ENABLED === "0") { rep.skipped = "disabled"; return rep; }
  const tn = tehranNow(now);
  const senderFor = deps.senderFor ?? defaultSenderFor;
  const cache = new Map<string, SenderLike | null>();
  const getSender = async (schoolId: string) => {
    if (!cache.has(schoolId)) cache.set(schoolId, await senderFor(schoolId));
    return cache.get(schoolId)!;
  };

  const rows = await db.select().from(schoolRemindersTable).where(and(
    eq(schoolRemindersTable.active, true),
    or(isNull(schoolRemindersTable.startDate), lte(schoolRemindersTable.startDate, tn.dateIso)),
    or(isNull(schoolRemindersTable.endDate), gte(schoolRemindersTable.endDate, tn.dateIso)),
  )).limit(5000);

  let budget = MAX_SENDS_PER_SWEEP;
  for (const r of rows) {
    const slots = dueSlots(r, tn);
    if (!slots.length) continue;
    if (budget <= 0) { rep.budgetHit = true; break; }
    const sender = await getSender(r.schoolId);
    if (!sender) continue;

    const [cls] = r.classId ? await db.select({ name: schoolClassesTable.name }).from(schoolClassesTable).where(eq(schoolClassesTable.id, r.classId)).limit(1) : [];
    const text = buildReminderMessage(r.message, cls?.name ?? null);

    const targets: { key: string; chat: string; group?: { id: string; title: string } }[] = [];
    if (r.sendDm) for (const s of await studentChats(r.schoolId, sender.botId, r.classId)) targets.push({ key: `dm:${s.userId}`, chat: s.chatId });
    const groups = await db.select({ g: schoolBotGroupsTable }).from(schoolReminderGroupsTable)
      .innerJoin(schoolBotGroupsTable, eq(schoolBotGroupsTable.id, schoolReminderGroupsTable.groupId))
      .where(and(eq(schoolReminderGroupsTable.reminderId, r.id), eq(schoolBotGroupsTable.schoolBotId, sender.botId)));
    for (const { g } of groups) {
      if (!["administrator", "member", "restricted"].includes(g.botStatus) || !g.canPost) continue;
      targets.push({ key: `g:${g.id}`, chat: g.telegramChatId, group: { id: g.id, title: g.title } });
    }
    if (!targets.length) continue;

    let firedHere = 0;
    for (const slot of slots) {
      for (const t of targets) {
        if (budget <= 0) { rep.budgetHit = true; break; }
        const claim = await db.insert(schoolReminderLogTable).values({ reminderId: r.id, runDate: tn.dateIso, runTime: slot, target: t.key })
          .onConflictDoNothing().returning({ k: schoolReminderLogTable.target });
        if (!claim.length) continue; // قبلاً فرستاده/claim شده
        budget--;
        const res = await sender.send(t.chat, text);
        const unclaim = () => db.delete(schoolReminderLogTable).where(and(
          eq(schoolReminderLogTable.reminderId, r.id), eq(schoolReminderLogTable.runDate, tn.dateIso),
          eq(schoolReminderLogTable.runTime, slot), eq(schoolReminderLogTable.target, t.key)));
        if (res.ok) { rep.sent++; firedHere++; continue; }
        if (res.description === "network") { rep.retryLater++; await unclaim(); continue; }
        rep.failed++;
        if (res.blocked) rep.blocked++;
        await db.update(schoolReminderLogTable).set({ ok: false }).where(and(
          eq(schoolReminderLogTable.reminderId, r.id), eq(schoolReminderLogTable.runDate, tn.dateIso),
          eq(schoolReminderLogTable.runTime, slot), eq(schoolReminderLogTable.target, t.key)));
        if (t.group && PERMANENT_GROUP_ERR.test(res.description ?? "")) {
          await db.update(schoolBotGroupsTable).set({ canPost: false, updatedAt: new Date() }).where(eq(schoolBotGroupsTable.id, t.group.id));
          const chat = await creatorChat(sender.botId, r.createdByUserId);
          if (chat) await sender.send(chat, `⚠️ نتوانستم در گروهِ «${t.group.title.replace(/[<>&]/g, "")}» یادآوری بفرستم (بات حذف شده یا اجازهٔ ارسال ندارد). بات را دوباره به گروه اضافه/ادمین کنید.`);
        }
      }
    }
    if (firedHere > 0) {
      rep.remindersFired++;
      await db.update(schoolRemindersTable).set({ lastFiredAt: now }).where(eq(schoolRemindersTable.id, r.id));
    }
  }

  // پاک‌سازیِ لاگِ قدیمی: روزی یک‌بار.
  if (lastCleanupDate !== tn.dateIso) {
    lastCleanupDate = tn.dateIso;
    try { await db.delete(schoolReminderLogTable).where(sql`${schoolReminderLogTable.runDate} < ${addDays(tn.dateIso, -LOG_RETENTION_DAYS)}`); }
    catch (err) { logger.warn({ err }, "school reminders: log cleanup failed (non-fatal)"); }
  }
  return rep;
}

export interface PoolLike { connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void }> }

/** با advisory lockِ سطحِ session: فقط یک نمونه هم‌زمان جاروب می‌کند. */
export async function runReminderSweepLocked(pool: PoolLike, now = new Date(), deps: ReminderSweepDeps = {}): Promise<ReminderSweepReport> {
  const conn = await pool.connect();
  try {
    const { rows } = await conn.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok", [LOCK_KEY]);
    if (!rows[0]?.ok) { const r = emptyReport(now); r.skipped = "lock_held"; return r; }
    try { return await runReminderSweep(now, deps); }
    finally { try { await conn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]); } catch { /* با بسته‌شدنِ session آزاد می‌شود */ } }
  } finally { conn.release(); }
}

export function startSchoolReminderScheduler(pool: PoolLike): void {
  if (process.env.SCHOOL_REMINDERS_ENABLED === "0") { logger.info("school reminder scheduler disabled (SCHOOL_REMINDERS_ENABLED=0)"); return; }
  const tick = () => {
    void runReminderSweepLocked(pool)
      .then((r) => { if (r.sent || r.failed || r.retryLater) logger.info({ report: r }, "school reminder sweep"); })
      .catch((err) => logger.error({ err }, "school reminder sweep failed"));
  };
  setTimeout(tick, 45_000);
  setInterval(tick, REMINDER_SWEEP_INTERVAL_MS);
}
