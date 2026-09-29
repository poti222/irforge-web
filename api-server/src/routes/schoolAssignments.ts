/**
 * routes/schoolAssignments.ts — بخش "/schools" فاز ۳ (بندِ ۳): تکالیفِ معلم
 * برایِ یک کلاس + ارسالِ دانش‌آموز + نمره‌دهیِ معلم.
 * ─────────────────────────────────────────────────────────────────────────
 * ساختن/دیدنِ همه‌یِ ارسال‌ها/نمره‌دادن: فقط معلمِ همان کلاس (school_class_
 * members با roleInClass="teacher") یا مدیرِ مدرسه. ارسال/دیدنِ ارسالِ خود:
 * فقط دانش‌آموزی که در روسترِ همان کلاس است.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolAssignmentsTable, schoolAssignmentSubmissionsTable,
  schoolClassMembersTable, schoolMembersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

function formatAssignment(a: typeof schoolAssignmentsTable.$inferSelect) {
  return {
    id: a.id,
    classId: a.classId,
    teacherUserId: a.teacherUserId,
    title: a.title,
    description: a.description,
    dueDate: a.dueDate ? a.dueDate.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

function formatSubmission(s: typeof schoolAssignmentSubmissionsTable.$inferSelect) {
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    studentMemberId: s.studentMemberId,
    content: s.content,
    submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
    grade: s.grade,
    feedback: s.feedback,
    createdAt: s.createdAt.toISOString(),
  };
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/** معلمِ همین کلاس (roleInClass="teacher") یا مدیرِ همین مدرسه. */
async function isClassTeacherOrAdmin(userId: string, schoolId: string, classId: string): Promise<{ ok: boolean; member: Awaited<ReturnType<typeof getMember>> }> {
  const { ok: isAdmin, member } = await canAccessSchool(userId, schoolId, SCHOOL_ADMIN_ONLY);
  if (isAdmin) return { ok: true, member };
  if (!member) return { ok: false, member: null };
  const [row] = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "teacher")))
    .limit(1);
  return { ok: !!row, member };
}

// GET /api/schools/:schoolId/assignments?classId= — هر عضوِ مدرسه می‌بیند (فیلترِ classId اختیاری).
router.get("/api/schools/:schoolId/assignments", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
    const rows = classId
      ? await db.select().from(schoolAssignmentsTable).where(eq(schoolAssignmentsTable.classId, classId))
      : await db.select().from(schoolAssignmentsTable);
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatAssignment));
  } catch (err) {
    logger.error({ err }, "List school assignments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/assignments — فقط معلمِ همان کلاس یا مدیر.
router.post("/api/schools/:schoolId/assignments", requireAuth, async (req: any, res) => {
  try {
    const { classId, title, description, dueDate } = req.body ?? {};
    if (!classId?.trim() || !title?.trim()) {
      res.status(400).json({ error: "classId and title are required" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.insert(schoolAssignmentsTable).values({
      id: crypto.randomUUID(),
      classId,
      teacherUserId: req.userId,
      title: title.trim(),
      description: description ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
    }).returning();
    res.status(201).json(formatAssignment(row));
  } catch (err) {
    logger.error({ err }, "Create school assignment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/assignments/:id/submissions — فقط معلمِ همان کلاس یا مدیر (همه‌یِ ارسال‌ها).
router.get("/api/schools/:schoolId/assignments/:id/submissions", requireAuth, async (req: any, res) => {
  try {
    const [assignment] = await db.select().from(schoolAssignmentsTable).where(eq(schoolAssignmentsTable.id, req.params.id)).limit(1);
    if (!assignment) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, assignment.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolAssignmentSubmissionsTable).where(eq(schoolAssignmentSubmissionsTable.assignmentId, req.params.id));
    res.json(rows.map(formatSubmission));
  } catch (err) {
    logger.error({ err }, "List assignment submissions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/assignments/:id/my-submission — ارسالِ خودِ دانش‌آموز (اگر باشد).
router.get("/api/schools/:schoolId/assignments/:id/my-submission", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.select().from(schoolAssignmentSubmissionsTable)
      .where(and(eq(schoolAssignmentSubmissionsTable.assignmentId, req.params.id), eq(schoolAssignmentSubmissionsTable.studentMemberId, member.id)))
      .limit(1);
    res.json(row ? formatSubmission(row) : null);
  } catch (err) {
    logger.error({ err }, "Get my submission error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/assignments/:id/submissions — دانش‌آموزِ عضوِ همان کلاس؛ upsert (یک ارسال به‌ازایِ هر دانش‌آموز).
router.post("/api/schools/:schoolId/assignments/:id/submissions", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [assignment] = await db.select().from(schoolAssignmentsTable).where(eq(schoolAssignmentsTable.id, req.params.id)).limit(1);
    if (!assignment) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [roster] = await db.select().from(schoolClassMembersTable)
      .where(and(eq(schoolClassMembersTable.classId, assignment.classId), eq(schoolClassMembersTable.schoolMemberId, member.id), eq(schoolClassMembersTable.roleInClass, "student")))
      .limit(1);
    if (!roster) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { content } = req.body ?? {};
    const [existing] = await db.select().from(schoolAssignmentSubmissionsTable)
      .where(and(eq(schoolAssignmentSubmissionsTable.assignmentId, req.params.id), eq(schoolAssignmentSubmissionsTable.studentMemberId, member.id)))
      .limit(1);
    let row;
    if (existing) {
      [row] = await db.update(schoolAssignmentSubmissionsTable)
        .set({ content: content ?? "", submittedAt: new Date() })
        .where(eq(schoolAssignmentSubmissionsTable.id, existing.id))
        .returning();
    } else {
      [row] = await db.insert(schoolAssignmentSubmissionsTable).values({
        id: crypto.randomUUID(),
        assignmentId: req.params.id,
        studentMemberId: member.id,
        content: content ?? "",
        submittedAt: new Date(),
      }).returning();
    }
    res.status(existing ? 200 : 201).json(formatSubmission(row));
  } catch (err) {
    logger.error({ err }, "Submit assignment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/assignments/:id/submissions/:submissionId — نمره/بازخوردِ معلم.
router.patch("/api/schools/:schoolId/assignments/:id/submissions/:submissionId", requireAuth, async (req: any, res) => {
  try {
    const [assignment] = await db.select().from(schoolAssignmentsTable).where(eq(schoolAssignmentsTable.id, req.params.id)).limit(1);
    if (!assignment) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ok } = await isClassTeacherOrAdmin(req.userId, req.params.schoolId, assignment.classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { grade, feedback } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (grade !== undefined) patch.grade = grade;
    if (feedback !== undefined) patch.feedback = feedback;
    const [row] = await db.update(schoolAssignmentSubmissionsTable).set(patch)
      .where(and(eq(schoolAssignmentSubmissionsTable.id, req.params.submissionId), eq(schoolAssignmentSubmissionsTable.assignmentId, req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatSubmission(row));
  } catch (err) {
    logger.error({ err }, "Grade submission error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
