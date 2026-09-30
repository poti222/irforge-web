/**
 * routes/schoolExams.ts — بخش "/schools" فاز ۴ (بندِ ۲): آزمونِ معلم (چند
 * سؤال از بانکِ سؤال، برایِ یک کلاس) + شروع/ارسالِ تلاشِ دانش‌آموز + نمره‌دهی.
 * ─────────────────────────────────────────────────────────────────────────
 * دسترسیِ ساختن/دیدنِ همه‌یِ تلاش‌ها/نمره‌دادن: فقط معلمِ همان کلاس
 * (school_class_members با roleInClass="teacher") یا مدیرِ مدرسه — الگویِ
 * `isClassTeacherOrAdmin` مستقیماً از schoolAssignments.ts کپی شده.
 *
 * تصمیمِ «یک تلاش به‌ازایِ هر دانش‌آموز»: شروعِ دوباره وقتی یک تلاش (حتی
 * ارسال‌نشده) از قبل هست، همان تلاش را برمی‌گرداند نه ردیفِ تازه — چون
 * ایندکسِ یکتایِ (examId, studentMemberId) این‌را در دیتابیس هم تضمین
 * می‌کند. یعنی نه ادامه‌ی «تلاشِ رهاشده» از سرور مسدود می‌شود و نه تلاشِ
 * دوم بعد از ارسال ممکن است.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolExamsTable, schoolExamAttemptsTable, schoolQuestionsTable,
  schoolClassMembersTable, schoolMembersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";

const router = Router();

function formatExam(e: typeof schoolExamsTable.$inferSelect) {
  return {
    id: e.id,
    classId: e.classId,
    teacherUserId: e.teacherUserId,
    title: e.title,
    questionIds: e.questionIds,
    scheduledAt: e.scheduledAt ? e.scheduledAt.toISOString() : null,
    durationMinutes: e.durationMinutes,
    createdAt: e.createdAt.toISOString(),
  };
}

function formatAttempt(a: typeof schoolExamAttemptsTable.$inferSelect) {
  return {
    id: a.id,
    examId: a.examId,
    studentMemberId: a.studentMemberId,
    answers: a.answers,
    score: a.score,
    startedAt: a.startedAt.toISOString(),
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    lateSubmission: a.lateSubmission,
  };
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/** معلمِ همین کلاس (roleInClass="teacher") یا مدیرِ همین مدرسه — کپیِ عینِ schoolAssignments.ts. */
async function isClassTeacherOrAdmin(userId: string, schoolId: string, classId: string) {
  const { ok: isAdmin, member } = await canAccessSchool(userId, schoolId, SCHOOL_ADMIN_ONLY);
  if (isAdmin) return { ok: true, member };
  if (!member) return { ok: false, member: null };
  const [row] = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "teacher")))
    .limit(1);
  return { ok: !!row, member };
}

// GET /api/schools/:schoolId/exams?classId= — هر عضوِ مدرسه (دانش‌آموز هم برایِ دیدنِ فهرستِ آزمون‌هایِ کلاسش).
router.get("/schools/:schoolId/exams", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
    // school_exams رفرنس به schoolId ندارد (فقط classId) — کلاس‌ها همه از طریقِ classId به مدرسه وصل می‌شوند،
    // پس فیلترِ classId این‌جا هم مرزِ مدرسه را تضمین می‌کند (فرانت همیشه با یک classId واقعی صدا می‌زند).
    if (!classId) {
      res.status(400).json({ error: "classId is required" });
      return;
    }
    const rows = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.classId, classId));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatExam));
  } catch (err) {
    logger.error({ err }, "List school exams error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/exams — فقط معلمِ همان کلاس یا مدیر.
router.post("/schools/:schoolId/exams", requireAuth, async (req: any, res) => {
  try {
    const { classId, title, questionIds, scheduledAt, durationMinutes } = req.body ?? {};
    if (!classId?.trim() || !title?.trim() || !Array.isArray(questionIds) || questionIds.length === 0) {
      res.status(400).json({ error: "classId, title and at least one questionId are required" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.insert(schoolExamsTable).values({
      id: crypto.randomUUID(),
      classId,
      teacherUserId: req.userId,
      title: title.trim(),
      questionIds,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      durationMinutes: durationMinutes ?? null,
    }).returning();

    // فازِ ۷ (بخشِ C): «آزمون داری» به همه‌یِ دانش‌آموزانِ روسترِ همین کلاس.
    const roster = await db.select().from(schoolClassMembersTable)
      .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.roleInClass, "student")));
    const memberIds = roster.map((r: typeof roster[number]) => r.schoolMemberId);
    if (memberIds.length > 0) {
      const students = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, memberIds));
      const studentUserIds = students.map((s: typeof students[number]) => s.userId);
      const when = row.scheduledAt ? new Date(row.scheduledAt).toLocaleDateString("fa-IR") : null;
      await notifySchoolUsers({
        userIds: studentUserIds,
        schoolId: req.params.schoolId,
        kind: "school_exam",
        severity: "info",
        title: "آزمون داری",
        body: when ? `آزمونِ «${row.title}» برای ${when} تعیین شده.` : `آزمونِ «${row.title}» برایِ کلاسِ شما ثبت شد.`,
      });
    }

    res.status(201).json(formatExam(row));
  } catch (err) {
    logger.error({ err }, "Create school exam error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/exams/:id/questions — سؤال‌هایِ همین آزمون؛ برایِ
// دانش‌آموز correctAnswer حذف می‌شود، برایِ معلم/مدیر کامل برمی‌گردد.
router.get("/schools/:schoolId/exams/:id/questions", requireAuth, async (req: any, res) => {
  try {
    const [exam] = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.id, req.params.id)).limit(1);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok: isTeacher } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, exam.classId);
    const { ok: isMember } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!isMember) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const ids = (exam.questionIds ?? []) as string[];
    const rows: (typeof schoolQuestionsTable.$inferSelect)[] = ids.length
      ? await db.select().from(schoolQuestionsTable).where(inArray(schoolQuestionsTable.id, ids))
      : [];
    // ترتیبِ questionIds حفظ می‌شود (نه ترتیبِ برگشتیِ کوئری).
    const byId = new Map(rows.map((q) => [q.id, q]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
    res.json(ordered.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      choices: q.choices,
      correctAnswer: isTeacher ? q.correctAnswer : undefined,
    })));
  } catch (err) {
    logger.error({ err }, "List exam questions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/exams/:id/attempts — فقط معلمِ همان کلاس یا مدیر (همه‌یِ تلاش‌ها، برایِ نمره‌دهی).
router.get("/schools/:schoolId/exams/:id/attempts", requireAuth, async (req: any, res) => {
  try {
    const [exam] = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.id, req.params.id)).limit(1);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, exam.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolExamAttemptsTable).where(eq(schoolExamAttemptsTable.examId, req.params.id));
    res.json(rows.map(formatAttempt));
  } catch (err) {
    logger.error({ err }, "List exam attempts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/exams/:id/my-attempt — تلاشِ خودِ دانش‌آموز (اگر باشد).
router.get("/schools/:schoolId/exams/:id/my-attempt", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.select().from(schoolExamAttemptsTable)
      .where(and(eq(schoolExamAttemptsTable.examId, req.params.id), eq(schoolExamAttemptsTable.studentMemberId, member.id)))
      .limit(1);
    res.json(row ? formatAttempt(row) : null);
  } catch (err) {
    logger.error({ err }, "Get my exam attempt error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** روسترِ کلاسِ همین آزمون شاملِ این دانش‌آموز است؟ */
async function isStudentInExamClass(member: NonNullable<Awaited<ReturnType<typeof getMember>>>, classId: string) {
  const [roster] = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "student")))
    .limit(1);
  return !!roster;
}

// POST /api/schools/:schoolId/exams/:id/attempts/start — دانش‌آموزِ عضوِ همان کلاس؛ idempotent (تلاشِ موجود را برمی‌گرداند).
router.post("/schools/:schoolId/exams/:id/attempts/start", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [exam] = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.id, req.params.id)).limit(1);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!(await isStudentInExamClass(member, exam.classId))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // فازِ ۶ (بندِ ۳): پنجره‌ی زمانی سمتِ سرور اجرا می‌شود — چکِ سمتِ کلاینت به‌تنهایی
    // با تغییرِ ساعتِ سیستم/درخواستِ مستقیم دور زده می‌شود.
    if (exam.scheduledAt && new Date() < exam.scheduledAt) {
      res.status(403).json({ error: "Exam has not started yet" });
      return;
    }
    const [existing] = await db.select().from(schoolExamAttemptsTable)
      .where(and(eq(schoolExamAttemptsTable.examId, req.params.id), eq(schoolExamAttemptsTable.studentMemberId, member.id)))
      .limit(1);
    if (existing) {
      res.json(formatAttempt(existing));
      return;
    }
    const [row] = await db.insert(schoolExamAttemptsTable).values({
      id: crypto.randomUUID(),
      examId: req.params.id,
      studentMemberId: member.id,
      answers: {},
    }).returning();
    res.status(201).json(formatAttempt(row));
  } catch (err) {
    logger.error({ err }, "Start exam attempt error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/exams/:id/attempts/submit — بستنِ تلاشِ موجود + نمره‌دهیِ خودکار (وقتی ممکن باشد).
router.post("/schools/:schoolId/exams/:id/attempts/submit", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [exam] = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.id, req.params.id)).limit(1);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [attempt] = await db.select().from(schoolExamAttemptsTable)
      .where(and(eq(schoolExamAttemptsTable.examId, req.params.id), eq(schoolExamAttemptsTable.studentMemberId, member.id)))
      .limit(1);
    if (!attempt) {
      res.status(404).json({ error: "No attempt started" });
      return;
    }
    if (attempt.submittedAt) {
      // یک تلاش به‌ازایِ هر دانش‌آموز — ارسالِ دوباره یعنی همان نتیجه‌ی قبلی.
      res.json(formatAttempt(attempt));
      return;
    }
    const { answers } = req.body ?? {};
    const finalAnswers: Record<string, string> = typeof answers === "object" && answers ? answers : {};

    const ids = (exam.questionIds ?? []) as string[];
    const questions: (typeof schoolQuestionsTable.$inferSelect)[] = ids.length
      ? await db.select().from(schoolQuestionsTable).where(inArray(schoolQuestionsTable.id, ids))
      : [];
    // نمره‌ی خودکار فقط وقتی همه‌ی سؤال‌ها چندگزینه‌ای با correctAnswer مشخص‌اند؛
    // وگرنه null می‌ماند تا معلم دستی نمره بدهد (دقیقاً مثلِ grade در schoolAssignments).
    const canAutoScore = questions.length > 0 && questions.every((q) => !!q.choices && q.correctAnswer !== null && q.correctAnswer !== undefined);
    let score: string | null = null;
    if (canAutoScore) {
      const correctCount = questions.filter((q) => finalAnswers[q.id] === q.correctAnswer).length;
      score = `${correctCount}/${questions.length}`;
    }

    // فازِ ۶ (بندِ ۳): ارسالِ دیرهنگام رد نمی‌شود (کارِ دانش‌آموز هرگز بی‌صدا دور
    // ریخته نمی‌شود)، فقط برایِ دیدِ معلم علامت می‌خورد — محاسبه‌ی گذرِ زمان
    // کاملاً سمتِ سرور و بر مبنایِ startedAtِ همان تلاش (نه ساعتِ کلاینت).
    let lateSubmission = false;
    if (exam.durationMinutes) {
      const elapsedMinutes = (Date.now() - attempt.startedAt.getTime()) / 60000;
      lateSubmission = elapsedMinutes > exam.durationMinutes;
    }

    const [row] = await db.update(schoolExamAttemptsTable)
      .set({ answers: finalAnswers, submittedAt: new Date(), score, lateSubmission })
      .where(eq(schoolExamAttemptsTable.id, attempt.id))
      .returning();
    res.json(formatAttempt(row));
  } catch (err) {
    logger.error({ err }, "Submit exam attempt error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/exams/:id/attempts/:attemptId — فقط معلمِ همان
// کلاس یا مدیر: «بازنشانیِ تلاش» (فاز ۵ بندِ ۳، از چک‌لیستِ فازِ ۴). چونِ
// ایندکسِ یکتایِ (examId, studentMemberId) اجازه‌ی دو ردیف نمی‌دهد، «حذفِ
// همان ردیف» ساده‌ترین راهِ اجازه‌دادنِ به یک تلاشِ تازه است — بعدِ حذف،
// POST /attempts/start دوباره یک ردیفِ نو می‌سازد.
router.delete("/schools/:schoolId/exams/:id/attempts/:attemptId", requireAuth, async (req: any, res) => {
  try {
    const [exam] = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.id, req.params.id)).limit(1);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, exam.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.delete(schoolExamAttemptsTable)
      .where(and(eq(schoolExamAttemptsTable.id, req.params.attemptId), eq(schoolExamAttemptsTable.examId, req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Reset exam attempt error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/exams/:id/attempts/:attemptId — نمره‌ی دستیِ معلم (برایِ سؤالِ تشریحی).
router.patch("/schools/:schoolId/exams/:id/attempts/:attemptId", requireAuth, async (req: any, res) => {
  try {
    const [exam] = await db.select().from(schoolExamsTable).where(eq(schoolExamsTable.id, req.params.id)).limit(1);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, exam.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { score } = req.body ?? {};
    const [row] = await db.update(schoolExamAttemptsTable).set({ score: score ?? null })
      .where(and(eq(schoolExamAttemptsTable.id, req.params.attemptId), eq(schoolExamAttemptsTable.examId, req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatAttempt(row));
  } catch (err) {
    logger.error({ err }, "Grade exam attempt error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
