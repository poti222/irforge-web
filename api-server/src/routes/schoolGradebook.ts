/**
 * routes/schoolGradebook.ts — بخش "/schools" فاز ۶ (بندِ ۲): نمایِ ترکیبیِ
 * نمره‌ها (تکلیف + آزمون) برایِ یک دانش‌آموز یا کلّ یک کلاس.
 * ─────────────────────────────────────────────────────────────────────────
 * تصمیمِ اسکوپ (طبقِ درخواست): هیچ موتورِ نمره‌بندیِ وزن‌دار/تنظیم‌پذیر ساخته
 * نمی‌شود — فقط فهرستِ تخت (تکلیف/آزمون → نمره) + یک میانگینِ ساده. برایِ
 * محاسبه‌ی میانگین، نمره‌ی آزمونِ خودکار («۳/۵») به درصد تبدیل می‌شود و نمره‌ی
 * متنیِ تکلیف/آزمونِ دستی («۱۸.۵») عدد خام می‌ماند — ترکیبِ این دو مقیاس در
 * یک میانگین ذاتاً دقیق نیست، اما دقیقاً همان کاری‌ست که اسکوپ می‌خواهد
 * («لیست + میانگینِ ساده»، نه موتورِ نمره‌بندی).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolAssignmentsTable, schoolAssignmentSubmissionsTable,
  schoolExamsTable, schoolExamAttemptsTable,
  schoolClassMembersTable, schoolMembersTable, schoolGuardianshipsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

function toNumeric(value: string | null): number | null {
  if (!value) return null;
  const fraction = value.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const a = parseFloat(fraction[1]);
    const b = parseFloat(fraction[2]);
    return b ? (a / b) * 100 : null;
  }
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/** معلمِ همین کلاس یا مدیرِ همین مدرسه — کپیِ isClassTeacherOrAdmin از schoolAssignments.ts. */
async function isClassTeacherOrAdmin(userId: string, schoolId: string, classId: string) {
  const { ok: isAdmin, member } = await canAccessSchool(userId, schoolId, SCHOOL_ADMIN_ONLY);
  if (isAdmin) return { ok: true, member };
  if (!member) return { ok: false, member: null };
  const [row] = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "teacher")))
    .limit(1);
  return { ok: !!row, member };
}

async function myChildrenMemberIdsInSchool(parentUserId: string, schoolId: string) {
  const links = await db.select().from(schoolGuardianshipsTable).where(eq(schoolGuardianshipsTable.parentUserId, parentUserId));
  if (links.length === 0) return [];
  const memberIds = links.map((l: typeof links[number]) => l.studentMemberId);
  const members = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, memberIds));
  return members.filter((m: typeof members[number]) => m.schoolId === schoolId).map((m: typeof members[number]) => m.id);
}

interface GradeItem {
  itemType: "assignment" | "exam";
  itemId: string;
  itemTitle: string;
  classId: string;
  value: string | null;
}

/** فهرستِ تخت + میانگینِ سادۀ همه‌یِ نمره‌های یک دانش‌آموز، اختیاراً محدود به یک کلاس. */
async function buildStudentGrades(studentMemberId: string, classId?: string): Promise<{ items: GradeItem[]; average: number | null }> {
  const submissions = await db.select().from(schoolAssignmentSubmissionsTable).where(eq(schoolAssignmentSubmissionsTable.studentMemberId, studentMemberId));
  const assignmentIds = submissions.map((s: typeof submissions[number]) => s.assignmentId);
  const assignments = assignmentIds.length ? await db.select().from(schoolAssignmentsTable).where(inArray(schoolAssignmentsTable.id, assignmentIds)) : [];
  const assignmentMap = new Map(assignments.map((a: typeof assignments[number]) => [a.id, a]));

  const attempts = await db.select().from(schoolExamAttemptsTable).where(eq(schoolExamAttemptsTable.studentMemberId, studentMemberId));
  const examIds = attempts.map((a: typeof attempts[number]) => a.examId);
  const exams = examIds.length ? await db.select().from(schoolExamsTable).where(inArray(schoolExamsTable.id, examIds)) : [];
  const examMap = new Map(exams.map((e: typeof exams[number]) => [e.id, e]));

  const items: GradeItem[] = [];
  for (const s of submissions) {
    const a = assignmentMap.get(s.assignmentId);
    if (!a) continue;
    if (classId && a.classId !== classId) continue;
    items.push({ itemType: "assignment", itemId: a.id, itemTitle: a.title, classId: a.classId, value: s.grade });
  }
  for (const at of attempts) {
    const e = examMap.get(at.examId);
    if (!e) continue;
    if (classId && e.classId !== classId) continue;
    items.push({ itemType: "exam", itemId: e.id, itemTitle: e.title, classId: e.classId, value: at.score });
  }

  const numericValues = items.map((i) => toNumeric(i.value)).filter((v): v is number => v !== null);
  const average = numericValues.length ? numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length : null;
  return { items, average };
}

/**
 * نسخه‌ی دسته‌ایِ buildStudentGrades برایِ «نمره‌نامه‌ی کلاس» — همان محاسبه،
 * فقط برایِ همه‌یِ دانش‌آموزانِ روستر با **۴ کوئری ثابت** به‌جایِ ۴ کوئری
 * به‌ازایِ هر دانش‌آموز (N+1 — روی یک کلاسِ ۳۰نفره یعنی ۱۲۰ کوئری در هر بازِ
 * صفحه، دقیقاً همان کلاسِ باگِ عملکردی که دورِ دیباگ دنبالش بود).
 */
async function buildClassGrades(studentMemberIds: string[], classId?: string) {
  const [submissions, attempts] = await Promise.all([
    db.select().from(schoolAssignmentSubmissionsTable).where(inArray(schoolAssignmentSubmissionsTable.studentMemberId, studentMemberIds)),
    db.select().from(schoolExamAttemptsTable).where(inArray(schoolExamAttemptsTable.studentMemberId, studentMemberIds)),
  ]);
  const assignmentIds = [...new Set(submissions.map((s: typeof submissions[number]) => s.assignmentId))];
  const examIds = [...new Set(attempts.map((a: typeof attempts[number]) => a.examId))];
  const [assignments, exams] = await Promise.all([
    assignmentIds.length ? db.select().from(schoolAssignmentsTable).where(inArray(schoolAssignmentsTable.id, assignmentIds)) : Promise.resolve([]),
    examIds.length ? db.select().from(schoolExamsTable).where(inArray(schoolExamsTable.id, examIds)) : Promise.resolve([]),
  ]);
  const assignmentMap = new Map(assignments.map((a: typeof assignments[number]) => [a.id, a]));
  const examMap = new Map(exams.map((e: typeof exams[number]) => [e.id, e]));

  const itemsByStudent = new Map<string, GradeItem[]>();
  for (const s of submissions) {
    const a = assignmentMap.get(s.assignmentId);
    if (!a || (classId && a.classId !== classId)) continue;
    const list = itemsByStudent.get(s.studentMemberId) ?? [];
    list.push({ itemType: "assignment", itemId: a.id, itemTitle: a.title, classId: a.classId, value: s.grade });
    itemsByStudent.set(s.studentMemberId, list);
  }
  for (const at of attempts) {
    const e = examMap.get(at.examId);
    if (!e || (classId && e.classId !== classId)) continue;
    const list = itemsByStudent.get(at.studentMemberId) ?? [];
    list.push({ itemType: "exam", itemId: e.id, itemTitle: e.title, classId: e.classId, value: at.score });
    itemsByStudent.set(at.studentMemberId, list);
  }

  return studentMemberIds.map((studentMemberId) => {
    const items = itemsByStudent.get(studentMemberId) ?? [];
    const numericValues = items.map((i) => toNumeric(i.value)).filter((v): v is number => v !== null);
    const average = numericValues.length ? numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length : null;
    return { studentMemberId, items, average };
  });
}

// GET /api/schools/:schoolId/gradebook/class/:classId — معلمِ همان کلاس یا مدیر: نمره‌هایِ همه‌یِ دانش‌آموزانِ کلاس.
router.get("/schools/:schoolId/gradebook/class/:classId", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, req.params.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const roster = await db.select().from(schoolClassMembersTable)
      .where(and(eq(schoolClassMembersTable.classId, req.params.classId), eq(schoolClassMembersTable.roleInClass, "student")));
    const result = roster.length
      ? await buildClassGrades(roster.map((r: typeof roster[number]) => r.schoolMemberId), req.params.classId)
      : [];
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Get class gradebook error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/gradebook/my — دانش‌آموز: نمره‌هایِ خودش (همه‌یِ کلاس‌ها).
router.get("/schools/:schoolId/gradebook/my", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await buildStudentGrades(member.id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Get my gradebook error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/gradebook/child/:studentMemberId — والد: نمره‌هایِ فرزندِ خودش (مرزِ حریمِ خصوصی — school_guardianships).
router.get("/schools/:schoolId/gradebook/child/:studentMemberId", requireAuth, async (req: any, res) => {
  try {
    const childIds = await myChildrenMemberIdsInSchool(req.userId, req.params.schoolId);
    if (!childIds.includes(req.params.studentMemberId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await buildStudentGrades(req.params.studentMemberId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Get child gradebook error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
