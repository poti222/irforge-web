/**
 * routes/schoolEnrollment.ts — انتخابِ کلاس/درسِ خودِ دانش‌آموز و معلم هنگامِ پیوستن به مدرسه.
 * ─────────────────────────────────────────────────────────────────────────
 * • دانش‌آموز: دقیقاً یک کلاس. خودش یک‌بار انتخاب می‌کند (POST /enrollment/student)؛ انتخابِ دوم ۴۰۹ است و
 *   تغییرش فقط با مدیر (حذف از کلاسِ قبلی در روسترِ کلاس). مدیر هم نمی‌تواند به‌طورِ هم‌زمان دانش‌آموز را در دو کلاس
 *   بگذارد (schoolClasses.ts همین را اعمال می‌کند).
 * • معلم: چند کلاس × چند درس (PUT /enrollment/teacher، «جایگزینیِ کلِ مجموعه» تا بشود بعداً ویرایشش کرد). برای هر
 *   کلاس یک ردیفِ school_class_members (teacher) و برای هر ترکیبِ (کلاس، درس) یک ردیفِ school_teacher_subjects
 *   با classId. گیتِ نوشتنِ محتوا (getContentScope) هر ردیفِ تخصیص را «تدریسِ این درس» می‌شمارد.
 *   ردیف‌هایِ تخصیصِ بدونِ کلاس (classId=null؛ «همه‌یِ کلاس‌ها»، کارِ مدیر) دست‌نخورده می‌مانند.
 * کدِ معرف کنترلِ دسترسی است؛ هر انتخاب در لاگِ مدرسه ثبت می‌شود و مدیر از پنلِ اعضا/تخصیص‌ها می‌تواند اصلاحش کند.
 * همه‌جا هویتِ *عضویتِ واقعیِ* کاربر در همان مدرسه لازم است (نه دسترسیِ admin/super).
 */
import { Router } from "express";
import crypto from "crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db, schoolClassesTable, schoolClassMembersTable, schoolMembersTable, schoolSubjectsTable,
  schoolTeacherSubjectsTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "./auth";
import { getSchoolMember } from "../lib/schoolAuth";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import { ensureTestIdentityClass } from "../lib/testIdentityClass";
import { ensureSchoolSubjectsSeeded } from "../lib/schoolContentAccess";
import { logger } from "../lib/logger";

const router = Router();

async function ownMember(userId: string, schoolId: string, role: "student" | "teacher" | null) {
  const m = await getSchoolMember(userId);
  if (!m || m.schoolId !== schoolId) return null;
  if (role && m.role !== role) return null;
  return m;
}

async function actorName(userId: string) {
  const [u] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.name || u?.email || userId;
}

// GET /api/schools/:schoolId/enrollment/me — وضعیتِ انتخابِ کلاس + داده‌یِ لازم برایِ فرمِ انتخاب.
router.get("/schools/:schoolId/enrollment/me", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const member = await ownMember(req.userId, schoolId, null);
    if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
    // هویتِ آزمایشیِ /super هرگز انتخابگر نمی‌بیند: اگر (قدیمی و) بدونِ کلاس است، همین‌جا خودکار کلاس می‌گیرد.
    if (member.role === "student" || member.role === "teacher") {
      const [u] = await db.select({ t: usersTable.isPlatformTestAccount }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
      if (u?.t) await ensureTestIdentityClass({ schoolId, memberId: member.id, role: member.role, grade: member.grade });
    }
    const isStudent = member.role === "student";
    const isTeacher = member.role === "teacher";
    const classes = await db.select().from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, schoolId));
    const classIds = new Set(classes.map((c: typeof classes[number]) => c.id));
    let studentClassId: string | null = null;
    let teacherAssignments: { classId: string; subject: string }[] = [];
    let teacherClassIds: string[] = [];
    let hasAnyTeacherAssignment = false;
    if (isStudent || isTeacher) {
      const mine = await db.select().from(schoolClassMembersTable).where(eq(schoolClassMembersTable.schoolMemberId, member.id));
      const mineInSchool = mine.filter((m: typeof mine[number]) => classIds.has(m.classId));
      if (isStudent) studentClassId = mineInSchool.find((m: typeof mine[number]) => m.roleInClass === "student")?.classId ?? null;
      if (isTeacher) {
        teacherClassIds = mineInSchool.filter((m: typeof mine[number]) => m.roleInClass === "teacher").map((m: typeof mine[number]) => m.classId);
        const ts = await db.select().from(schoolTeacherSubjectsTable)
          .where(and(eq(schoolTeacherSubjectsTable.schoolId, schoolId), eq(schoolTeacherSubjectsTable.teacherUserId, req.userId)));
        hasAnyTeacherAssignment = ts.length > 0;
        teacherAssignments = ts.filter((r: typeof ts[number]) => r.classId).map((r: typeof ts[number]) => ({ classId: r.classId as string, subject: r.subject }));
      }
    }
    await ensureSchoolSubjectsSeeded(schoolId);
    const subjects = isTeacher
      ? (await db.select({ name: schoolSubjectsTable.name, sortOrder: schoolSubjectsTable.sortOrder }).from(schoolSubjectsTable)
          .where(eq(schoolSubjectsTable.schoolId, schoolId))).sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((s: any) => s.name)
      : [];
    const needsSelection = isStudent ? !studentClassId : isTeacher ? teacherClassIds.length === 0 && !hasAnyTeacherAssignment : false;
    res.json({
      role: member.role,
      grade: member.grade,
      classes: classes.map((c: typeof classes[number]) => ({ id: c.id, name: c.name, grade: c.grade, academicYear: c.academicYear })),
      needsSelection,
      studentClassId,
      teacherClassIds,
      teacherAssignments,
      subjects,
    });
  } catch (err) {
    logger.error({ err }, "Enrollment status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/enrollment/student { classId } — یک‌بار؛ بعدش فقط مدیر.
router.post("/schools/:schoolId/enrollment/student", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const classId = typeof req.body?.classId === "string" ? req.body.classId.trim() : "";
    const member = await ownMember(req.userId, schoolId, "student");
    if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!classId) { res.status(400).json({ error: "classId is required" }); return; }
    const [cls] = await db.select().from(schoolClassesTable)
      .where(and(eq(schoolClassesTable.id, classId), eq(schoolClassesTable.schoolId, schoolId))).limit(1);
    if (!cls) { res.status(404).json({ error: "Class not found", code: "class_not_found" }); return; }
    let conflict = false;
    await db.transaction(async (tx: any) => {
      // قفلِ ردیفِ عضو: دو درخواستِ هم‌زمان نتوانند هر دو «هنوز کلاس ندارد» ببینند و دو ردیف بسازند.
      await tx.select({ id: schoolMembersTable.id }).from(schoolMembersTable).where(eq(schoolMembersTable.id, member.id)).for("update");
      const existing = await tx.select({ id: schoolClassMembersTable.id }).from(schoolClassMembersTable)
        .where(and(eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "student")));
      if (existing.length > 0) { conflict = true; return; } // هیچ نوشتنی انجام نشده؛ commitِ خالی بی‌ضرر است.
      await tx.insert(schoolClassMembersTable).values({ id: crypto.randomUUID(), classId, schoolMemberId: member.id, roleInClass: "student" });
    });
    if (conflict) {
      res.status(409).json({ error: "شما قبلاً کلاس را انتخاب کرده‌اید؛ تغییرِ کلاس فقط با مدیر مدرسه است.", code: "already_enrolled" });
      return;
    }
    await logSchoolAudit(schoolId, req.userId, "member.class_selected", `${await actorName(req.userId)} → ${cls.name}`);
    res.status(201).json({ ok: true, classId });
  } catch (err) {
    logger.error({ err }, "Student class selection error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/schools/:schoolId/enrollment/teacher { assignments: [{ classId, subjects: string[] }] }
router.put("/schools/:schoolId/enrollment/teacher", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const member = await ownMember(req.userId, schoolId, "teacher");
    if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
    const raw = req.body?.assignments;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 60) {
      res.status(400).json({ error: "assignments must be a non-empty array", code: "invalid_assignments" });
      return;
    }
    const wanted = new Map<string, Set<string>>();
    for (const a of raw) {
      if (!a || typeof a.classId !== "string" || !Array.isArray(a.subjects) || a.subjects.length === 0 || a.subjects.length > 40 || a.subjects.some((s: unknown) => typeof s !== "string")) {
        res.status(400).json({ error: "Each assignment needs a classId and at least one subject", code: "invalid_assignments" });
        return;
      }
      const set = wanted.get(a.classId) ?? new Set<string>();
      for (const s of a.subjects) set.add(s);
      wanted.set(a.classId, set);
    }
    const classIds = [...wanted.keys()];
    const classes = await db.select().from(schoolClassesTable)
      .where(and(eq(schoolClassesTable.schoolId, schoolId), inArray(schoolClassesTable.id, classIds)));
    if (classes.length !== classIds.length) {
      res.status(404).json({ error: "Class not found", code: "class_not_found" });
      return;
    }
    await ensureSchoolSubjectsSeeded(schoolId);
    const realSubjects = new Set((await db.select({ name: schoolSubjectsTable.name }).from(schoolSubjectsTable)
      .where(eq(schoolSubjectsTable.schoolId, schoolId))).map((r: { name: string }) => r.name));
    for (const set of wanted.values()) {
      for (const s of set) {
        if (!realSubjects.has(s)) { res.status(400).json({ error: "Invalid subject", code: "invalid_subject", subject: s }); return; }
      }
    }
    const allClassIds = (await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, schoolId))).map((c: { id: string }) => c.id);
    let combos = 0;
    await db.transaction(async (tx: any) => {
      await tx.select({ id: schoolMembersTable.id }).from(schoolMembersTable).where(eq(schoolMembersTable.id, member.id)).for("update");
      await tx.delete(schoolClassMembersTable).where(and(
        eq(schoolClassMembersTable.schoolMemberId, member.id),
        eq(schoolClassMembersTable.roleInClass, "teacher"),
        inArray(schoolClassMembersTable.classId, allClassIds),
      ));
      await tx.delete(schoolTeacherSubjectsTable).where(and(
        eq(schoolTeacherSubjectsTable.schoolId, schoolId),
        eq(schoolTeacherSubjectsTable.teacherUserId, req.userId),
        isNotNull(schoolTeacherSubjectsTable.classId),
      ));
      for (const [classId, subs] of wanted) {
        await tx.insert(schoolClassMembersTable).values({ id: crypto.randomUUID(), classId, schoolMemberId: member.id, roleInClass: "teacher" });
        for (const subject of subs) {
          await tx.insert(schoolTeacherSubjectsTable).values({ id: crypto.randomUUID(), schoolId, teacherUserId: req.userId, subject, classId });
          combos++;
        }
      }
    });
    await logSchoolAudit(schoolId, req.userId, "teacher.assignments_set", `${await actorName(req.userId)}: ${classIds.length} کلاس، ${combos} ترکیبِ کلاس×درس`);
    res.json({ ok: true, classes: classIds.length, combos });
  } catch (err) {
    logger.error({ err }, "Teacher assignment selection error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
