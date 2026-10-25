/**
 * lib/schoolReminders.ts — لایهٔ سرویسِ «یادآورهایِ دانش‌آموزی» (DB + مجوز). هم routes/schoolReminders.ts هم منوی بات (lib/schoolBot/reminders.ts)
 * فقط از همین‌جا می‌خوانند/می‌نویسند؛ پس قوانینِ دسترسی یک جا و برایِ هر دو کانال یکسان است.
 *
 * دسترسی (چه کسی می‌تواند «ساخت/ویرایش/حذف/روشن‌وخاموش» کند):
 *   • مدیر/معاون/معاونِ انضباطی (و سوپرادمین از طریقِ canAccessSchool): همهٔ کلاس‌ها + یادآورِ کلِ مدرسه (class_id = NULL)
 *   • معلم: کلاس‌هایی که در آن‌ها teacher است
 *   • دانش‌آموزِ منتخب: کلاس(های) خودش
 * هر کس که به یک کلاس دسترسی دارد، همهٔ یادآورهایِ آن کلاس را (حتی ساختهٔ دیگری) می‌تواند تغییر دهد؛ هر تغییر در school_audit_log ثبت می‌شود.
 */
import crypto from "crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, schoolRemindersTable, schoolReminderGroupsTable, schoolClassesTable, schoolClassMembersTable, schoolMembersTable,
  schoolClassRepsTable, schoolBotSubscribersTable, schoolBotGroupsTable, schoolBotsTable, usersTable,
} from "@workspace/db";
import { canAccessSchool, classBelongsToSchool, getSchoolMember } from "./schoolAuth";
import { logSchoolAudit } from "./schoolAuditLog";
import type { ReminderValue } from "./schoolReminderSchedule";

export const ADMIN_LIKE = ["admin", "deputy", "deputy_discipline"] as const;
/** سقفِ تعدادِ یادآور برایِ هر کلاس (و برایِ کلِ مدرسه). */
export const MAX_REMINDERS_PER_CLASS = 40;

export interface Scope {
  userId: string;
  /** برایِ نمایش و ثبتِ created_by_role */
  roleLabel: "admin" | "teacher" | "rep";
  /** مدیر: همهٔ کلاس‌ها + کلِ مدرسه */
  all: boolean;
  classIds: string[];
  memberId: string | null;
}

export class ReminderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ─── دسترسی ───────────────────────────────────────────────────────────────────
export async function resolveScope(userId: string, schoolId: string): Promise<Scope | null> {
  if ((await canAccessSchool(userId, schoolId, ADMIN_LIKE)).ok) {
    const m = await getSchoolMember(userId);
    const all = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, schoolId));
    return { userId, roleLabel: "admin", all: true, classIds: all.map((c: { id: string }) => c.id), memberId: m?.schoolId === schoolId ? m.id : null };
  }
  const member = await getSchoolMember(userId);
  if (!member || member.schoolId !== schoolId) return null;

  const teaching = member.role === "teacher"
    ? await db.select({ classId: schoolClassMembersTable.classId }).from(schoolClassMembersTable)
        .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolClassMembersTable.classId))
        .where(and(eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "teacher"), eq(schoolClassesTable.schoolId, schoolId)))
    : [];
  const repOf = member.role === "student"
    ? await db.select({ classId: schoolClassRepsTable.classId }).from(schoolClassRepsTable)
        .where(and(eq(schoolClassRepsTable.schoolId, schoolId), eq(schoolClassRepsTable.studentMemberId, member.id)))
    : [];
  const classIds = [...new Set<string>([...teaching, ...repOf].map((r: { classId: string }) => r.classId))];
  if (classIds.length === 0) return null;
  return { userId, roleLabel: teaching.length ? "teacher" : "rep", all: false, classIds, memberId: member.id };
}

export const scopeCan = (scope: Scope, classId: string | null): boolean =>
  classId === null ? scope.all : scope.all || scope.classIds.includes(classId);

// ─── خواندن ───────────────────────────────────────────────────────────────────
export interface ReminderRow {
  id: string; schoolId: string; classId: string | null; className: string | null; title: string; message: string;
  weekdays: number[]; times: string[]; startDate: string | null; endDate: string | null; skipDates: string[];
  sendDm: boolean; active: boolean; createdByUserId: string; createdByName: string; createdByRole: string;
  updatedByUserId: string | null; lastFiredAt: Date | null; createdAt: Date; updatedAt: Date; groupIds: string[];
}

async function hydrate(rows: any[]): Promise<ReminderRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const groups = await db.select().from(schoolReminderGroupsTable).where(inArray(schoolReminderGroupsTable.reminderId, ids));
  const byRem = new Map<string, string[]>();
  for (const g of groups) byRem.set(g.reminderId, [...(byRem.get(g.reminderId) ?? []), g.groupId]);
  const classIds = [...new Set(rows.map((r) => r.classId).filter(Boolean))] as string[];
  const classes = classIds.length ? await db.select({ id: schoolClassesTable.id, name: schoolClassesTable.name }).from(schoolClassesTable).where(inArray(schoolClassesTable.id, classIds)) : [];
  const cName = new Map<string, string>(classes.map((c: { id: string; name: string }) => [c.id, c.name]));
  const userIds = [...new Set(rows.map((r) => r.createdByUserId))] as string[];
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds));
  const uName = new Map<string, string>(users.map((u: { id: string; name: string | null; email: string | null }) => [u.id, u.name || u.email || "—"]));
  return rows.map((r) => ({
    ...r,
    className: r.classId ? cName.get(r.classId) ?? null : null,
    createdByName: uName.get(r.createdByUserId) ?? "—",
    groupIds: byRem.get(r.id) ?? [],
  }));
}

export async function listReminders(schoolId: string, scope: Scope): Promise<ReminderRow[]> {
  const rows = await db.select().from(schoolRemindersTable)
    .where(eq(schoolRemindersTable.schoolId, schoolId))
    .orderBy(desc(schoolRemindersTable.createdAt)).limit(1000);
  const visible = rows.filter((r: any) => scopeCan(scope, r.classId));
  return hydrate(visible);
}

export async function getReminder(schoolId: string, id: string, scope: Scope): Promise<ReminderRow> {
  const [row] = await db.select().from(schoolRemindersTable)
    .where(and(eq(schoolRemindersTable.id, id), eq(schoolRemindersTable.schoolId, schoolId))).limit(1);
  if (!row) throw new ReminderError(404, "یادآور پیدا نشد");
  if (!scopeCan(scope, row.classId)) throw new ReminderError(403, "به این یادآور دسترسی ندارید");
  return (await hydrate([row]))[0];
}

/** گروه‌هایی که باتِ همین مدرسه در آن‌هاست (برایِ انتخابِ مقصد). */
export async function groupsOfSchool(schoolId: string) {
  return db.select({ id: schoolBotGroupsTable.id, title: schoolBotGroupsTable.title, canPost: schoolBotGroupsTable.canPost, botStatus: schoolBotGroupsTable.botStatus })
    .from(schoolBotGroupsTable).innerJoin(schoolBotsTable, eq(schoolBotsTable.id, schoolBotGroupsTable.schoolBotId))
    .where(eq(schoolBotsTable.schoolId, schoolId)).orderBy(asc(schoolBotGroupsTable.title));
}

async function validGroupIds(schoolId: string, wanted: string[]): Promise<string[]> {
  if (!wanted.length) return [];
  const ok = await groupsOfSchool(schoolId);
  const set = new Set<string>(ok.map((g: { id: string }) => g.id));
  return [...new Set(wanted)].filter((id) => set.has(id));
}

// ─── نوشتن ────────────────────────────────────────────────────────────────────
export async function createReminder(
  schoolId: string, scope: Scope, classId: string | null, value: ReminderValue, groupIds: string[],
): Promise<string> {
  if (!scopeCan(scope, classId)) throw new ReminderError(403, classId === null ? "فقط مدیر می‌تواند یادآورِ کلِ مدرسه بسازد" : "به این کلاس دسترسی ندارید");
  if (classId !== null && !(await classBelongsToSchool(classId, schoolId))) throw new ReminderError(404, "کلاس پیدا نشد");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schoolRemindersTable)
    .where(and(eq(schoolRemindersTable.schoolId, schoolId), classId === null ? isNull(schoolRemindersTable.classId) : eq(schoolRemindersTable.classId, classId)));
  if (n >= MAX_REMINDERS_PER_CLASS) throw new ReminderError(409, "تعدادِ یادآورها به سقف رسیده؛ چند موردِ قدیمی را حذف کنید");
  const groups = await validGroupIds(schoolId, groupIds);
  const id = crypto.randomUUID();
  await db.transaction(async (tx: any) => {
    await tx.insert(schoolRemindersTable).values({
      id, schoolId, classId, title: value.title, message: value.message, weekdays: value.weekdays, times: value.times,
      startDate: value.startDate, endDate: value.endDate, skipDates: value.skipDates, sendDm: value.sendDm, active: value.active,
      createdByUserId: scope.userId, createdByRole: scope.roleLabel,
    });
    if (groups.length) await tx.insert(schoolReminderGroupsTable).values(groups.map((groupId) => ({ reminderId: id, groupId })));
  });
  await logSchoolAudit(schoolId, scope.userId, "reminder.create", `${value.message.slice(0, 60)} (${scope.roleLabel})`);
  return id;
}

export async function updateReminder(
  schoolId: string, scope: Scope, id: string, patch: Partial<ReminderValue>, groupIds?: string[],
): Promise<void> {
  const cur = await getReminder(schoolId, id, scope);
  const set: Record<string, unknown> = { updatedByUserId: scope.userId, updatedAt: new Date() };
  for (const k of ["title", "message", "weekdays", "times", "startDate", "endDate", "skipDates", "sendDm", "active"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  const groups = groupIds === undefined ? undefined : await validGroupIds(schoolId, groupIds);
  await db.transaction(async (tx: any) => {
    await tx.update(schoolRemindersTable).set(set).where(eq(schoolRemindersTable.id, id));
    if (groups !== undefined) {
      await tx.delete(schoolReminderGroupsTable).where(eq(schoolReminderGroupsTable.reminderId, id));
      if (groups.length) await tx.insert(schoolReminderGroupsTable).values(groups.map((groupId) => ({ reminderId: id, groupId })));
    }
  });
  await logSchoolAudit(schoolId, scope.userId, "reminder.update", `${(patch.message ?? cur.message).slice(0, 60)} [${Object.keys(patch).concat(groups ? ["groups"] : []).join(",")}]`);
}

export async function deleteReminder(schoolId: string, scope: Scope, id: string): Promise<void> {
  const cur = await getReminder(schoolId, id, scope);
  await db.delete(schoolRemindersTable).where(eq(schoolRemindersTable.id, id));
  await logSchoolAudit(schoolId, scope.userId, "reminder.delete", cur.message.slice(0, 60));
}

// ─── گیرنده‌ها ────────────────────────────────────────────────────────────────
/** دانش‌آموزانِ کلاس (یا کلِ مدرسه) که به بات وصل‌اند و بلاک نکرده‌اند: یک chat برایِ هر کاربر (آخرین اتصال). */
export async function studentChats(schoolId: string, botId: string, classId: string | null): Promise<{ userId: string; chatId: string }[]> {
  const base = db.select({ userId: schoolBotSubscribersTable.userId, chatId: schoolBotSubscribersTable.telegramChatId, linkedAt: schoolBotSubscribersTable.linkedAt })
    .from(schoolMembersTable)
    .innerJoin(schoolBotSubscribersTable, and(eq(schoolBotSubscribersTable.userId, schoolMembersTable.userId), eq(schoolBotSubscribersTable.schoolBotId, botId), isNull(schoolBotSubscribersTable.unreachableAt)));
  const rows = classId
    ? await base.innerJoin(schoolClassMembersTable, and(eq(schoolClassMembersTable.schoolMemberId, schoolMembersTable.id), eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.roleInClass, "student")))
        .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "student")))
    : await base.where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "student")));
  const best = new Map<string, { userId: string; chatId: string; linkedAt: Date }>();
  for (const r of rows as any[]) {
    const cur = best.get(r.userId);
    if (!cur || r.linkedAt > cur.linkedAt) best.set(r.userId, r);
  }
  return [...best.values()].map(({ userId, chatId }) => ({ userId, chatId }));
}

/** برایِ UI: چند دانش‌آموز هست و چند نفر به بات وصل‌اند (یعنی پیام واقعاً به چند نفر می‌رسد). */
export async function recipientStats(schoolId: string, classId: string | null): Promise<{ students: number; connected: number }> {
  const [bot] = await db.select({ id: schoolBotsTable.id }).from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
  const total = classId
    ? await db.select({ n: sql<number>`count(distinct ${schoolMembersTable.id})::int` }).from(schoolClassMembersTable)
        .innerJoin(schoolMembersTable, eq(schoolMembersTable.id, schoolClassMembersTable.schoolMemberId))
        .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.roleInClass, "student"), eq(schoolMembersTable.schoolId, schoolId)))
    : await db.select({ n: sql<number>`count(*)::int` }).from(schoolMembersTable).where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "student")));
  const connected = bot ? (await studentChats(schoolId, bot.id, classId)).length : 0;
  return { students: total[0]?.n ?? 0, connected };
}
