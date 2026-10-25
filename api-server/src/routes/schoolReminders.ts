/**
 * routes/schoolReminders.ts — «یادآورهایِ دانش‌آموزی»: ساخت/ویرایش/حذفِ یادآورهایِ تکرارشونده (روزهایِ هفتهٔ دلخواه × چند ساعت در روز)
 * که بات به پیویِ دانش‌آموزانِ کلاس (و گروه‌هایِ انتخابی) می‌فرستد. دسترسی و قوانین: lib/schoolReminders.ts (مدیر/معاون، معلمِ کلاس، دانش‌آموزِ منتخب).
 *
 *   GET    /api/schools/:schoolId/reminders              فهرست + کلاس‌هایِ قابل‌مدیریت + گروه‌ها + اجراهایِ بعدی
 *   POST   /api/schools/:schoolId/reminders              ساخت   { classId|null, message, weekdays, times, … , groupIds }
 *   PATCH  /api/schools/:schoolId/reminders/:id          ویرایش/روشن‌خاموش (هر زیرمجموعه‌ای از فیلدها)
 *   DELETE /api/schools/:schoolId/reminders/:id
 *   POST   /api/schools/:schoolId/reminders/:id/test     ارسالِ همین پیام همین حالا فقط به پیویِ خودِ کاربر (تست)
 *   GET    /api/schools/:schoolId/reminders/recipients?classId=   چند دانش‌آموز / چند نفر به بات وصل‌اند
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, schoolClassesTable, schoolBotSubscribersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { loadSchoolBotBySchool } from "../lib/schoolBotCore";
import { BotSender } from "../lib/schoolBot/tg";
import { jalaliString, weekdayFa } from "../lib/schoolRepSchedule";
import {
  MAX_MESSAGE, MAX_TIMES, MAX_TITLE, buildReminderMessage, describeSchedule, nextRuns, tehranNow, validateReminder,
  type ReminderValue,
} from "../lib/schoolReminderSchedule";
import {
  MAX_REMINDERS_PER_CLASS, ReminderError, createReminder, deleteReminder, getReminder, groupsOfSchool, listReminders,
  recipientStats, resolveScope, scopeCan, updateReminder, type ReminderRow, type Scope,
} from "../lib/schoolReminders";

const router = Router();

function fail(res: any, err: unknown, fallback: string) {
  if (err instanceof ReminderError) return res.status(err.status).json({ error: err.message });
  logger.error({ err }, fallback);
  return res.status(500).json({ error: "Internal server error" });
}

async function scopeOr403(req: any, res: any): Promise<Scope | null> {
  const scope = await resolveScope(req.userId, req.params.schoolId);
  if (!scope) { res.status(403).json({ error: "Forbidden" }); return null; }
  return scope;
}

function present(r: ReminderRow) {
  const now = tehranNow();
  const runs = r.active ? nextRuns(r, now, 3).map((x) => ({ ...x, label: `${weekdayFa(x.date)} ${jalaliString(x.date)} · ${x.time}` })) : [];
  return {
    id: r.id, classId: r.classId, className: r.className, title: r.title, message: r.message, weekdays: r.weekdays, times: r.times,
    startDate: r.startDate, endDate: r.endDate, skipDates: r.skipDates, sendDm: r.sendDm, active: r.active, groupIds: r.groupIds,
    createdByUserId: r.createdByUserId, createdByName: r.createdByName, createdByRole: r.createdByRole,
    lastFiredAt: r.lastFiredAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
    scheduleText: describeSchedule(r), nextRuns: runs,
  };
}

router.get("/schools/:schoolId/reminders", requireAuth, async (req: any, res) => {
  try {
    const scope = await scopeOr403(req, res);
    if (!scope) return;
    const { schoolId } = req.params;
    const [reminders, groups, classRows] = await Promise.all([
      listReminders(schoolId, scope), groupsOfSchool(schoolId),
      scope.classIds.length ? db.select({ id: schoolClassesTable.id, name: schoolClassesTable.name }).from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, schoolId)) : [],
    ]);
    const mine = new Set(scope.classIds);
    res.json({
      role: scope.roleLabel,
      canSchoolWide: scope.all,
      classes: classRows.filter((c: { id: string }) => scope.all || mine.has(c.id)).sort((a: any, b: any) => a.name.localeCompare(b.name, "fa")),
      groups,
      limits: { maxPerClass: MAX_REMINDERS_PER_CLASS, maxTimes: MAX_TIMES, maxMessage: MAX_MESSAGE, maxTitle: MAX_TITLE },
      reminders: reminders.map(present),
    });
  } catch (err) { fail(res, err, "List reminders error"); }
});

router.get("/schools/:schoolId/reminders/recipients", requireAuth, async (req: any, res) => {
  try {
    const scope = await scopeOr403(req, res);
    if (!scope) return;
    const classId = typeof req.query.classId === "string" && req.query.classId ? req.query.classId : null;
    if (!scopeCan(scope, classId)) { res.status(403).json({ error: "Forbidden" }); return; }
    res.json(await recipientStats(req.params.schoolId, classId));
  } catch (err) { fail(res, err, "Reminder recipients error"); }
});

router.post("/schools/:schoolId/reminders", requireAuth, async (req: any, res) => {
  try {
    const scope = await scopeOr403(req, res);
    if (!scope) return;
    const v = validateReminder(req.body ?? {});
    if (!v.ok) { res.status(400).json({ error: v.errors[0], errors: v.errors }); return; }
    const classId = typeof req.body?.classId === "string" && req.body.classId ? req.body.classId : null;
    const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter((x: unknown) => typeof x === "string") : [];
    const id = await createReminder(req.params.schoolId, scope, classId, v.value as ReminderValue, groupIds);
    res.status(201).json({ reminder: present(await getReminder(req.params.schoolId, id, scope)) });
  } catch (err) { fail(res, err, "Create reminder error"); }
});

router.patch("/schools/:schoolId/reminders/:id", requireAuth, async (req: any, res) => {
  try {
    const scope = await scopeOr403(req, res);
    if (!scope) return;
    const v = validateReminder(req.body ?? {}, true);
    if (!v.ok) { res.status(400).json({ error: v.errors[0], errors: v.errors }); return; }
    const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds.filter((x: unknown) => typeof x === "string") : undefined;
    if (Object.keys(v.value).length === 0 && groupIds === undefined) { res.status(400).json({ error: "چیزی برایِ ویرایش نیست" }); return; }
    await updateReminder(req.params.schoolId, scope, req.params.id, v.value, groupIds);
    res.json({ reminder: present(await getReminder(req.params.schoolId, req.params.id, scope)) });
  } catch (err) { fail(res, err, "Update reminder error"); }
});

router.delete("/schools/:schoolId/reminders/:id", requireAuth, async (req: any, res) => {
  try {
    const scope = await scopeOr403(req, res);
    if (!scope) return;
    await deleteReminder(req.params.schoolId, scope, req.params.id);
    res.json({ deleted: true });
  } catch (err) { fail(res, err, "Delete reminder error"); }
});

// تست: همین پیام را همین حالا فقط به پیویِ خودِ کاربر بفرست (دیدنِ ظاهرِ واقعی). حداکثر یک بار در ۱۰ ثانیه برایِ هر کاربر.
const lastTest = new Map<string, number>();
router.post("/schools/:schoolId/reminders/:id/test", requireAuth, async (req: any, res) => {
  try {
    const scope = await scopeOr403(req, res);
    if (!scope) return;
    const now = Date.now();
    if (now - (lastTest.get(req.userId) ?? 0) < 10_000) { res.status(429).json({ error: "چند ثانیه صبر کنید و دوباره امتحان کنید" }); return; }
    const r = await getReminder(req.params.schoolId, req.params.id, scope);
    const loaded = await loadSchoolBotBySchool(req.params.schoolId);
    if (!loaded) { res.status(409).json({ error: "برایِ این مدرسه هنوز باتی فعال نیست" }); return; }
    const [sub] = await db.select().from(schoolBotSubscribersTable)
      .where(and(eq(schoolBotSubscribersTable.schoolBotId, loaded.bot.id), eq(schoolBotSubscribersTable.userId, req.userId)))
      .orderBy(desc(schoolBotSubscribersTable.linkedAt)).limit(1);
    if (!sub || sub.unreachableAt) { res.status(409).json({ error: "حسابِ شما هنوز به باتِ مدرسه وصل نیست؛ اول در تلگرام بات را Start کنید" }); return; }
    lastTest.set(req.userId, now);
    const out = await new BotSender(loaded.bot.id, loaded.token).send(sub.telegramChatId, `🧪 <b>نمونه</b>\n\n${buildReminderMessage(r.message, r.className)}`);
    if (!out.ok) { res.status(502).json({ error: "ارسال به تلگرام ناموفق بود" }); return; }
    res.json({ sent: true });
  } catch (err) { fail(res, err, "Test reminder error"); }
});

export default router;
