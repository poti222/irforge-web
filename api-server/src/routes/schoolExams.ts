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
import { canAccessSchool, SCHOOL_ADMIN_ONLY, classBelongsToSchool, findExamInSchool } from "../lib/schoolAuth";
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
    /** فازِ ۱۰ (بندِ ۲.۲) */
    randomizeOrder: e.randomizeOrder,
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
    /** فازِ ۱۰ (بندِ ۲.۱) */
    answerBreakdown: a.answerBreakdown ?? null,
    /** فازِ ۱۰ (بندِ ۲.۲) */
    questionOrder: a.questionOrder ?? null,
    startedAt: a.startedAt.toISOString(),
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    lateSubmission: a.lateSubmission,
  };
}

/**
 * فازِ ۱۰ (بندِ ۲.۱): نمره‌ی تجمیعیِ "x/y" را از answerBreakdown می‌سازد —
 * فقط وقتی هر سؤال یک pointsAwarded غیرِ null دارد (یعنی کاملاً نمره‌دهی‌شده،
 * یا خودکار یا دستی)؛ وگرنه null می‌ماند تا معلم بقیه را هم نمره بدهد. این
 * تنها جایی‌ست که score ساخته می‌شود — submit و PATCHِ نمره‌دهی هر دو از
 * همین عبور می‌کنند تا score/answerBreakdown هرگز با هم ناهم‌خوان نشوند.
 */
function deriveScoreFromBreakdown(breakdown: Array<{ pointsAwarded: number | null }>): string | null {
  if (breakdown.length === 0) return null;
  if (breakdown.some((b) => b.pointsAwarded === null)) return null;
  const sum = breakdown.reduce((s, b) => s + (b.pointsAwarded ?? 0), 0);
  const rounded = Math.round(sum * 100) / 100;
  return `${rounded}/${breakdown.length}`;
}

/** چندگزینه‌ای‌هایِ auto-gradable همین‌جا نمره می‌گیرند؛ تشریحی null می‌ماند. مشترکِ submit و fallbackِ PATCH (برایِ تلاش‌هایِ قدیمی‌تر از این فاز که answerBreakdown ندارند). */
function computeAutoBreakdown(
  questions: (typeof schoolQuestionsTable.$inferSelect)[],
  finalAnswers: Record<string, string>,
) {
  return questions.map((q) => {
    const autoGradable = !!q.choices && q.correctAnswer !== null && q.correctAnswer !== undefined;
    if (!autoGradable) return { questionId: q.id, correct: null, pointsAwarded: null };
    const correct = finalAnswers[q.id] === q.correctAnswer;
    return { questionId: q.id, correct, pointsAwarded: correct ? 1 : 0 };
  });
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
    if (!(await classBelongsToSchool(classId, req.params.schoolId))) {
      res.status(404).json({ error: "Class not found" });
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
    const { classId, title, questionIds, scheduledAt, durationMinutes, randomizeOrder } = req.body ?? {};
    if (!classId?.trim() || !title?.trim() || !Array.isArray(questionIds) || questionIds.length === 0) {
      res.status(400).json({ error: "classId, title and at least one questionId are required" });
      return;
    }
    if (!(await classBelongsToSchool(classId, req.params.schoolId))) {
      res.status(404).json({ error: "Class not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // سؤال‌ها هم باید از بانکِ همین مدرسه باشند (وگرنه سؤال/پاسخِ صحیحِ مدرسه‌یِ دیگر از راهِ /exams/:id/questions لو می‌رفت).
    const ownQ = await db.select({ id: schoolQuestionsTable.id }).from(schoolQuestionsTable)
      .where(and(eq(schoolQuestionsTable.schoolId, req.params.schoolId), inArray(schoolQuestionsTable.id, questionIds)));
    if (ownQ.length !== new Set(questionIds).size) {
      res.status(400).json({ error: "Unknown questionIds" });
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
      randomizeOrder: randomizeOrder === true,
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
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
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
    let ids = (exam.questionIds ?? []) as string[];
    // فازِ ۱۰ (بندِ ۲.۲): معلم/مدیر همیشه ترتیبِ بانکِ سؤال (questionIds) را
    // می‌بیند؛ فقط وقتی خودِ دانش‌آموزِ صاحبِ یک تلاشِ واقعی باشد (نه teacher
    // که فقط دارد پیش‌نمایش می‌کند) و questionOrderِ آن تلاش ذخیره شده باشد،
    // همان ترتیبِ شخصی‌شده را می‌بیند — یک‌بار در attempts/start ساخته شده،
    // پس بازدیدِ دوباره هم همان ترتیب را می‌دهد.
    if (!isTeacher && exam.randomizeOrder) {
      const member = await getMember(req.userId);
      if (member) {
        const [attempt] = await db.select().from(schoolExamAttemptsTable)
          .where(and(eq(schoolExamAttemptsTable.examId, exam.id), eq(schoolExamAttemptsTable.studentMemberId, member.id)))
          .limit(1);
        if (attempt?.questionOrder && attempt.questionOrder.length > 0) ids = attempt.questionOrder;
      }
    }
    const rows: (typeof schoolQuestionsTable.$inferSelect)[] = ids.length
      ? await db.select().from(schoolQuestionsTable).where(inArray(schoolQuestionsTable.id, ids))
      : [];
    // ترتیبِ ids (بانکِ سؤال یا شخصی‌شده) حفظ می‌شود، نه ترتیبِ برگشتیِ کوئری.
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
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
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
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
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
    // فازِ ۱۰ (بندِ ۲.۲): فقط همین‌جا، فقط یک‌بار، ترتیبِ شخصی‌شده ساخته می‌شود —
    // Fisher-Yates روی questionIds — تا بازدیدِ دوباره‌ی همین تلاش (رفرش/قطعیِ
    // اینترنت) همان ترتیب را ببیند، نه قاطی‌شده‌یِ تازه.
    let questionOrder: string[] | null = null;
    if (exam.randomizeOrder) {
      const shuffled = [...(exam.questionIds ?? [])];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      questionOrder = shuffled;
    }
    const [row] = await db.insert(schoolExamAttemptsTable).values({
      id: crypto.randomUUID(),
      examId: req.params.id,
      studentMemberId: member.id,
      answers: {},
      questionOrder,
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
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
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
    // فازِ ۱۰ (بندِ ۲.۱): شکستِ نمره به‌ازایِ هر سؤال — چندگزینه‌ایِ با
    // correctAnswer همین‌جا خودکار محاسبه می‌شود (۱ نمره/سؤال)؛ تشریحی تا
    // نمره‌دهیِ معلم (PATCHِ پایین) با correct/pointsAwarded=null می‌ماند.
    // نمره‌ی تجمیعی دیگر این‌جا جدا محاسبه نمی‌شود، فقط از همین breakdown
    // استخراج می‌شود (deriveScoreFromBreakdown) — طبقِ اسپکِ فاز، تا این دو
    // هیچ‌وقت با هم ناهم‌خوان نشوند.
    const answerBreakdown = computeAutoBreakdown(questions, finalAnswers);
    const score = deriveScoreFromBreakdown(answerBreakdown);

    // فازِ ۶ (بندِ ۳): ارسالِ دیرهنگام رد نمی‌شود (کارِ دانش‌آموز هرگز بی‌صدا دور
    // ریخته نمی‌شود)، فقط برایِ دیدِ معلم علامت می‌خورد — محاسبه‌ی گذرِ زمان
    // کاملاً سمتِ سرور و بر مبنایِ startedAtِ همان تلاش (نه ساعتِ کلاینت).
    let lateSubmission = false;
    if (exam.durationMinutes) {
      const elapsedMinutes = (Date.now() - attempt.startedAt.getTime()) / 60000;
      lateSubmission = elapsedMinutes > exam.durationMinutes;
    }

    const [row] = await db.update(schoolExamAttemptsTable)
      .set({ answers: finalAnswers, submittedAt: new Date(), score, answerBreakdown, lateSubmission })
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
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
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

// PATCH /api/schools/:schoolId/exams/:id/attempts/:attemptId — نمره‌دهیِ دستیِ معلم.
// بدنه: { questionPoints?: Record<questionId, number> } — نمره‌یِ هر سؤالِ تشریحی به‌تنهایی (فازِ ۱۰، بندِ ۲.۱).
// `score` خامِ قدیمی هم هنوز پذیرفته می‌شود (برایِ آزمون‌هایی که اصلاً سؤال/breakdown ندارند) ولی وقتی questionPoints
// بیاید، همیشه برنده است — score دیگر هرگز مستقیم ست نمی‌شود وقتی breakdown موجود است.
router.patch("/schools/:schoolId/exams/:id/attempts/:attemptId", requireAuth, async (req: any, res) => {
  try {
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, exam.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [attempt] = await db.select().from(schoolExamAttemptsTable)
      .where(and(eq(schoolExamAttemptsTable.id, req.params.attemptId), eq(schoolExamAttemptsTable.examId, req.params.id)))
      .limit(1);
    if (!attempt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { questionPoints, score: rawScore } = req.body ?? {};
    let patch: Record<string, unknown>;
    if (questionPoints && typeof questionPoints === "object") {
      // اگر این تلاش از قبلِ این فاز است و هنوز breakdown ندارد، همین‌جا از
      // روی سؤال‌هایِ واقعی ساخته می‌شود (fallback) تا نمره‌دهیِ تشریحی رویِ
      // آزمون‌هایِ قدیمی‌تر هم کار کند.
      let breakdown = attempt.answerBreakdown;
      if (!breakdown || breakdown.length === 0) {
        const ids = (exam.questionIds ?? []) as string[];
        const questions = ids.length ? await db.select().from(schoolQuestionsTable).where(inArray(schoolQuestionsTable.id, ids)) : [];
        breakdown = computeAutoBreakdown(questions, attempt.answers ?? {});
      }
      const nextBreakdown = breakdown.map((b) => {
        const points = questionPoints[b.questionId];
        if (typeof points !== "number" || Number.isNaN(points)) return b;
        return { ...b, pointsAwarded: points, correct: points > 0 };
      });
      patch = { answerBreakdown: nextBreakdown, score: deriveScoreFromBreakdown(nextBreakdown) };
    } else {
      patch = { score: rawScore ?? null };
    }
    const [row] = await db.update(schoolExamAttemptsTable).set(patch)
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

// GET /api/schools/:schoolId/exams/:id/analytics — معلمِ همان کلاس یا مدیر: میانگین/بالاترین/پایین‌ترین/توزیعِ نمره‌ها (فازِ ۱۰، بندِ ۲.۴).
router.get("/schools/:schoolId/exams/:id/analytics", requireAuth, async (req: any, res) => {
  try {
    const exam = await findExamInSchool(req.params.id, req.params.schoolId);
    if (!exam) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, exam.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const attempts = await db.select().from(schoolExamAttemptsTable)
      .where(and(eq(schoolExamAttemptsTable.examId, req.params.id)));
    // فقط تلاش‌هایِ ارسال‌شده و نمره‌دار — تلاشِ درحالِ‌انجام/هنوز نمره‌نگرفته‌یِ
    // تشریحی در میانگین/توزیع بی‌معناست.
    const percents: number[] = [];
    for (const a of attempts) {
      if (!a.submittedAt || !a.score) continue;
      const m = a.score.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
      if (!m) continue;
      const total = parseFloat(m[2]);
      if (!total) continue;
      percents.push((parseFloat(m[1]) / total) * 100);
    }
    const submittedCount = attempts.filter((a) => a.submittedAt).length;
    if (percents.length === 0) {
      res.json({ submittedCount, gradedCount: 0, average: null, highest: null, lowest: null, distribution: [] });
      return;
    }
    const average = percents.reduce((s, v) => s + v, 0) / percents.length;
    // توزیعِ ساده روی سطل‌هایِ ۱۰درصدی — همان الگویِ نمودارهایِ بارِ موجود (مثلاً AdminOverview).
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of percents) {
      const idx = Math.min(9, Math.floor(p / 10));
      buckets[idx]++;
    }
    const distribution = buckets.map((count, i) => ({ range: `${i * 10}-${i * 10 + 10}`, count }));
    res.json({
      submittedCount,
      gradedCount: percents.length,
      average: Math.round(average * 10) / 10,
      highest: Math.round(Math.max(...percents) * 10) / 10,
      lowest: Math.round(Math.min(...percents) * 10) / 10,
      distribution,
    });
  } catch (err) {
    logger.error({ err }, "Get exam analytics error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
