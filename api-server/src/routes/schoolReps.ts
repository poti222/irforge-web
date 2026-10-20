/**
 * routes/schoolReps.ts — «دانش‌آموزِ منتخب» (مسئولِ کلاس): معلم/مدیر در سایت منتخب‌ها را انتخاب و مدیریت می‌کند،
 * مواردی (تکلیف/امتحان/یادآوری) که منتخب‌ها از طریقِ بات ثبت کرده‌اند را می‌بیند/لغو می‌کند، و گروه‌هایِ باتِ مدرسه را می‌بیند.
 * ثبتِ تکلیف/امتحان توسطِ خودِ منتخب در بات انجام می‌شود (lib/schoolBot/reps.ts)، نه از این روت‌ها.
 *
 * مجوز: مدیر/معاون/معاونِ انضباطی (همهٔ کلاس‌هایِ مدرسه) یا معلمِ همان کلاس (class_members با roleInClass="teacher").
 * همهٔ idها با مرزِ مدرسه سنجیده می‌شوند (classBelongsToSchool) — idِ مدرسهٔ دیگر ← ۴۰۴.
 */
import crypto from "crypto";
import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, schoolClassesTable, schoolClassMembersTable, schoolMembersTable, usersTable, schoolClassRepsTable, schoolRepItemsTable,
  schoolRepItemGroupsTable, schoolBotGroupsTable, schoolBotsTable, schoolBotSubscribersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { canAccessSchool, classBelongsToSchool, getSchoolMember } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";

const router = Router();

const ADMIN_LIKE = ["admin", "deputy", "deputy_discipline"] as const;
const MANAGER_ROLES = ["teacher", ...ADMIN_LIKE] as const;
/** سقفِ تعدادِ منتخب به‌ازایِ هر (کلاس، معلم). */
export const MAX_REPS_PER_TEACHER_PER_CLASS = 5;

const nameOf = (u?: { name?: string | null; email?: string | null } | null) => u?.name || u?.email || "—";

async function isAdminLike(userId: string, schoolId: string): Promise<boolean> {
  return (await canAccessSchool(userId, schoolId, ADMIN_LIKE)).ok;
}

/** کلاس‌هایی که کاربر می‌تواند مدیریت کند: مدیر/معاون = همهٔ کلاس‌هایِ مدرسه؛ معلم = کلاس‌هایی که در آن‌ها teacher است. */
async function managedClassIds(userId: string, schoolId: string): Promise<string[] | null> {
  const gate = await canAccessSchool(userId, schoolId, MANAGER_ROLES);
  if (!gate.ok) return null;
  if (await isAdminLike(userId, schoolId)) {
    const all = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, schoolId));
    return all.map((c: { id: string }) => c.id);
  }
  const member = gate.member ?? await getSchoolMember(userId);
  if (!member || member.schoolId !== schoolId) return [];
  const rows = await db.select({ classId: schoolClassMembersTable.classId }).from(schoolClassMembersTable)
    .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolClassMembersTable.classId))
    .where(and(eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "teacher"), eq(schoolClassesTable.schoolId, schoolId)));
  return rows.map((r: { classId: string }) => r.classId);
}

/** 403/404 را خودش می‌فرستد؛ true یعنی ادامه. */
async function requireClassManager(req: any, res: any, schoolId: string, classId: string): Promise<boolean> {
  const ids = await managedClassIds(req.userId, schoolId);
  if (ids === null) { res.status(403).json({ error: "Forbidden" }); return false; }
  if (!(await classBelongsToSchool(classId, schoolId))) { res.status(404).json({ error: "Class not found" }); return false; }
  if (!ids.includes(classId)) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

async function schoolBotIdOf(schoolId: string): Promise<string | null> {
  const [b] = await db.select({ id: schoolBotsTable.id }).from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
  return b?.id ?? null;
}

// GET /api/schools/:schoolId/classes/:classId/rep-candidates — دانش‌آموزانِ کلاس + وضعیتِ منتخب بودن
router.get("/schools/:schoolId/classes/:classId/rep-candidates", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, classId } = req.params;
    if (!(await requireClassManager(req, res, schoolId, classId))) return;
    const students = await db.select({ memberId: schoolMembersTable.id, userId: schoolMembersTable.userId, grade: schoolMembersTable.grade, name: usersTable.name, email: usersTable.email })
      .from(schoolClassMembersTable)
      .innerJoin(schoolMembersTable, eq(schoolMembersTable.id, schoolClassMembersTable.schoolMemberId))
      .innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
      .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.roleInClass, "student"), eq(schoolMembersTable.schoolId, schoolId)));
    const reps = await db.select().from(schoolClassRepsTable).where(eq(schoolClassRepsTable.classId, classId));
    const botId = await schoolBotIdOf(schoolId);
    const linked = new Set<string>();
    if (botId && students.length) {
      const subs = await db.select({ userId: schoolBotSubscribersTable.userId, unreachableAt: schoolBotSubscribersTable.unreachableAt }).from(schoolBotSubscribersTable)
        .where(and(eq(schoolBotSubscribersTable.schoolBotId, botId), inArray(schoolBotSubscribersTable.userId, students.map((s: typeof students[number]) => s.userId))));
      for (const s of subs) if (!s.unreachableAt) linked.add(s.userId);
    }
    res.json({
      botActive: !!botId,
      maxPerTeacher: MAX_REPS_PER_TEACHER_PER_CLASS,
      students: students.map((s: typeof students[number]) => {
        const mine = reps.find((r: typeof reps[number]) => r.studentMemberId === s.memberId && r.teacherUserId === req.userId);
        return {
          memberId: s.memberId, userId: s.userId, name: nameOf(s), grade: s.grade ?? null,
          repId: mine?.id ?? null,
          repCount: reps.filter((r: typeof reps[number]) => r.studentMemberId === s.memberId).length,
          botLinked: linked.has(s.userId),
        };
      }).sort((a: any, b: any) => a.name.localeCompare(b.name, "fa")),
    });
  } catch (err) {
    logger.error({ err }, "List rep candidates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/classes/:classId/reps { studentMemberId } — انتخابِ دانش‌آموزِ منتخب
router.post("/schools/:schoolId/classes/:classId/reps", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, classId } = req.params;
    if (!(await requireClassManager(req, res, schoolId, classId))) return;
    const studentMemberId = typeof req.body?.studentMemberId === "string" ? req.body.studentMemberId : "";
    if (!studentMemberId) { res.status(400).json({ error: "studentMemberId is required" }); return; }

    const [st] = await db.select({ memberId: schoolMembersTable.id, userId: schoolMembersTable.userId }).from(schoolClassMembersTable)
      .innerJoin(schoolMembersTable, eq(schoolMembersTable.id, schoolClassMembersTable.schoolMemberId))
      .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, studentMemberId),
        eq(schoolClassMembersTable.roleInClass, "student"), eq(schoolMembersTable.schoolId, schoolId))).limit(1);
    if (!st) { res.status(400).json({ error: "این دانش‌آموز در این کلاس نیست" }); return; }

    const mine = await db.select({ id: schoolClassRepsTable.id, studentMemberId: schoolClassRepsTable.studentMemberId }).from(schoolClassRepsTable)
      .where(and(eq(schoolClassRepsTable.classId, classId), eq(schoolClassRepsTable.teacherUserId, req.userId)));
    if (mine.some((r: { studentMemberId: string }) => r.studentMemberId === studentMemberId)) { res.status(409).json({ error: "این دانش‌آموز قبلاً منتخب شده است" }); return; }
    if (mine.length >= MAX_REPS_PER_TEACHER_PER_CLASS) { res.status(400).json({ error: `حداکثر ${MAX_REPS_PER_TEACHER_PER_CLASS} دانش‌آموزِ منتخب برایِ هر کلاس` }); return; }

    const id = crypto.randomUUID();
    const ins = await db.insert(schoolClassRepsTable).values({ id, schoolId, classId, studentMemberId, teacherUserId: req.userId })
      .onConflictDoNothing().returning({ id: schoolClassRepsTable.id });
    if (!ins.length) { res.status(409).json({ error: "این دانش‌آموز قبلاً منتخب شده است" }); return; }

    const [cls] = await db.select({ name: schoolClassesTable.name }).from(schoolClassesTable).where(eq(schoolClassesTable.id, classId)).limit(1);
    // به دانش‌آموز خبر بده (سایت + تلگرام با دکمهٔ «شروع»؛ اگر هنوز به بات وصل نیست فقط اعلانِ سایت).
    void notifySchoolUsers({
      userIds: [st.userId], schoolId, kind: "school_rep_elected",
      title: "شما دانش‌آموزِ منتخب شدید ⭐",
      body: `معلم شما را مسئولِ کلاس «${cls?.name ?? ""}» کرده است. تکلیف و امتحانِ کلاس را در بات ثبت کنید تا بات پیش از موعد در گروه‌ها یادآوری کند.`,
      refId: id, telegramButtons: [[{ text: "⭐ شروع", callback_data: "r:home" }]],
    }).catch((err) => logger.warn({ err }, "rep elected notify failed (non-fatal)"));

    res.status(201).json({ id });
  } catch (err) {
    logger.error({ err }, "Elect school rep error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/reps/:repId[?cancelItems=true] — برکناریِ منتخب (فقط انتخاب‌کننده یا مدیر)
router.delete("/schools/:schoolId/reps/:repId", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, repId } = req.params;
    const [rep] = await db.select().from(schoolClassRepsTable).where(and(eq(schoolClassRepsTable.id, repId), eq(schoolClassRepsTable.schoolId, schoolId))).limit(1);
    if (!rep) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await requireClassManager(req, res, schoolId, rep.classId))) return;
    if (rep.teacherUserId !== req.userId && !(await isAdminLike(req.userId, schoolId))) { res.status(403).json({ error: "Forbidden" }); return; }

    await db.delete(schoolClassRepsTable).where(eq(schoolClassRepsTable.id, rep.id));
    let cancelled = 0;
    if (req.query.cancelItems === "true") {
      const still = await db.select({ id: schoolClassRepsTable.id }).from(schoolClassRepsTable)
        .where(and(eq(schoolClassRepsTable.classId, rep.classId), eq(schoolClassRepsTable.studentMemberId, rep.studentMemberId))).limit(1);
      if (!still.length) { // فقط وقتی دیگر هیچ معلمی او را منتخب نگه نداشته
        const r = await db.update(schoolRepItemsTable).set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(schoolRepItemsTable.classId, rep.classId), eq(schoolRepItemsTable.createdByMemberId, rep.studentMemberId), eq(schoolRepItemsTable.status, "active")))
          .returning({ id: schoolRepItemsTable.id });
        cancelled = r.length;
      }
    }
    res.json({ ok: true, cancelledItems: cancelled });
  } catch (err) {
    logger.error({ err }, "Remove school rep error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/reps — منتخب‌هایِ قابلِ مشاهده (معلم: کلاس‌هایِ خودش؛ مدیر: همه)
router.get("/schools/:schoolId/reps", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const ids = await managedClassIds(req.userId, schoolId);
    if (ids === null) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!ids.length) { res.json([]); return; }
    const rows = await db.select({
      id: schoolClassRepsTable.id, classId: schoolClassRepsTable.classId, className: schoolClassesTable.name, studentMemberId: schoolClassRepsTable.studentMemberId,
      teacherUserId: schoolClassRepsTable.teacherUserId, createdAt: schoolClassRepsTable.createdAt, studentUserId: schoolMembersTable.userId,
      studentName: usersTable.name, studentEmail: usersTable.email,
    }).from(schoolClassRepsTable)
      .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolClassRepsTable.classId))
      .innerJoin(schoolMembersTable, eq(schoolMembersTable.id, schoolClassRepsTable.studentMemberId))
      .innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
      .where(and(eq(schoolClassRepsTable.schoolId, schoolId), inArray(schoolClassRepsTable.classId, ids)))
      .orderBy(desc(schoolClassRepsTable.createdAt));
    const teacherIds = [...new Set(rows.map((r: typeof rows[number]) => r.teacherUserId))] as string[];
    const teachers = teacherIds.length ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, teacherIds)) : [];
    const tName = new Map<string, string>(teachers.map((t: typeof teachers[number]) => [t.id, nameOf(t)]));
    res.json(rows.map((r: typeof rows[number]) => ({
      id: r.id, classId: r.classId, className: r.className, studentMemberId: r.studentMemberId, studentName: nameOf({ name: r.studentName, email: r.studentEmail }),
      teacherUserId: r.teacherUserId, teacherName: tName.get(r.teacherUserId) ?? "—", mine: r.teacherUserId === req.userId, createdAt: r.createdAt,
    })));
  } catch (err) {
    logger.error({ err }, "List school reps error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/rep-items?classId=&status= — تکلیف/امتحان/یادآوریِ ثبت‌شده توسطِ منتخب‌ها
router.get("/schools/:schoolId/rep-items", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const ids = await managedClassIds(req.userId, schoolId);
    if (ids === null) { res.status(403).json({ error: "Forbidden" }); return; }
    const classId = typeof req.query.classId === "string" && req.query.classId ? req.query.classId : null;
    const wanted = classId ? ids.filter((i) => i === classId) : ids;
    if (!wanted.length) { res.json([]); return; }
    const status = ["active", "cancelled", "done"].includes(String(req.query.status)) ? String(req.query.status) : "active";

    const items = await db.select({
      id: schoolRepItemsTable.id, classId: schoolRepItemsTable.classId, className: schoolClassesTable.name, kind: schoolRepItemsTable.kind,
      title: schoolRepItemsTable.title, dueDate: schoolRepItemsTable.dueDate, remindDays: schoolRepItemsTable.remindDays, status: schoolRepItemsTable.status,
      createdAt: schoolRepItemsTable.createdAt, createdByName: usersTable.name, createdByEmail: usersTable.email,
    }).from(schoolRepItemsTable)
      .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolRepItemsTable.classId))
      .innerJoin(usersTable, eq(usersTable.id, schoolRepItemsTable.createdByUserId))
      .where(and(eq(schoolRepItemsTable.schoolId, schoolId), inArray(schoolRepItemsTable.classId, wanted), eq(schoolRepItemsTable.status, status)))
      .orderBy(status === "active" ? schoolRepItemsTable.dueDate : desc(schoolRepItemsTable.createdAt)).limit(200);
    const itemIds = items.map((i: typeof items[number]) => i.id);
    const groups = itemIds.length ? await db.select({ itemId: schoolRepItemGroupsTable.itemId, title: schoolBotGroupsTable.title }).from(schoolRepItemGroupsTable)
      .innerJoin(schoolBotGroupsTable, eq(schoolBotGroupsTable.id, schoolRepItemGroupsTable.groupId))
      .where(inArray(schoolRepItemGroupsTable.itemId, itemIds)) : [];
    res.json(items.map((i: typeof items[number]) => ({
      id: i.id, classId: i.classId, className: i.className, kind: i.kind, title: i.title, dueDate: i.dueDate, remindDays: i.remindDays, status: i.status,
      createdAt: i.createdAt, createdByName: nameOf({ name: i.createdByName, email: i.createdByEmail }),
      groups: groups.filter((g: typeof groups[number]) => g.itemId === i.id).map((g: typeof groups[number]) => g.title),
    })));
  } catch (err) {
    logger.error({ err }, "List rep items error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/rep-items/:itemId { status: "cancelled" } — لغوِ یک مورد توسطِ معلم/مدیر
router.patch("/schools/:schoolId/rep-items/:itemId", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, itemId } = req.params;
    if (req.body?.status !== "cancelled") { res.status(400).json({ error: "فقط status=cancelled پذیرفته می‌شود" }); return; }
    const [it] = await db.select().from(schoolRepItemsTable).where(and(eq(schoolRepItemsTable.id, itemId), eq(schoolRepItemsTable.schoolId, schoolId))).limit(1);
    if (!it) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await requireClassManager(req, res, schoolId, it.classId))) return;
    await db.update(schoolRepItemsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schoolRepItemsTable.id, it.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Cancel rep item error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/bot-groups — گروه‌هایی که باتِ مدرسه در آن‌هاست (برایِ اطلاعِ معلم/مدیر؛ بدونِ chat_id)
router.get("/schools/:schoolId/bot-groups", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const gate = await canAccessSchool(req.userId, schoolId, MANAGER_ROLES);
    if (!gate.ok) { res.status(403).json({ error: "Forbidden" }); return; }
    const botId = await schoolBotIdOf(schoolId);
    if (!botId) { res.json({ botActive: false, groups: [] }); return; }
    const rows = await db.select().from(schoolBotGroupsTable)
      .where(and(eq(schoolBotGroupsTable.schoolBotId, botId), sql`${schoolBotGroupsTable.botStatus} NOT IN ('left','kicked')`))
      .orderBy(desc(schoolBotGroupsTable.updatedAt)).limit(100);
    res.json({
      botActive: true,
      groups: rows.map((g: typeof rows[number]) => ({ id: g.id, title: g.title || "گروهِ بدونِ نام", botStatus: g.botStatus, canPost: g.canPost, chatType: g.chatType })),
    });
  } catch (err) {
    logger.error({ err }, "List bot groups error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
