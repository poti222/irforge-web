/**
 * routes/schoolTeacherSubjects.ts — تخصیصِ معلم↔درس (کنترلِ دسترسیِ موضوعی
 * به کتابخانه‌ی محتوا، ببینید schema/schoolTeacherSubjects.ts).
 * خواندن برایِ هر عضوِ مدرسه (لازم برایِ پیکرِ انتخابِ درسِ فرمِ محتوا)؛
 * نوشتن (تخصیص/لغو) فقط برایِ admin.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolTeacherSubjectsTable, schoolMembersTable, schoolSubjectsTable, SCHOOL_MEMBER_ROLES } from "@workspace/db";
import { ensureSchoolSubjectsSeeded } from "../lib/schoolContentAccess";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

function formatRow(r: typeof schoolTeacherSubjectsTable.$inferSelect) {
  return {
    id: r.id,
    schoolId: r.schoolId,
    teacherUserId: r.teacherUserId,
    subject: r.subject,
    classId: r.classId,
    createdAt: r.createdAt.toISOString(),
  };
}

// GET /api/schools/:schoolId/teacher-subjects — هر عضوِ مدرسه (پیکرِ انتخابِ درس هم همین را می‌خواند)
router.get("/schools/:schoolId/teacher-subjects", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const teacherUserId = typeof req.query.teacherUserId === "string" ? req.query.teacherUserId : undefined;
    const whereClause = teacherUserId
      ? and(eq(schoolTeacherSubjectsTable.schoolId, req.params.schoolId), eq(schoolTeacherSubjectsTable.teacherUserId, teacherUserId))
      : eq(schoolTeacherSubjectsTable.schoolId, req.params.schoolId);
    const rows = await db.select().from(schoolTeacherSubjectsTable).where(whereClause);
    res.json(rows.map(formatRow));
  } catch (err) {
    logger.error({ err }, "List teacher subjects error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/teacher-subjects — فقط admin
router.post("/schools/:schoolId/teacher-subjects", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { teacherUserId, subject, classId } = req.body ?? {};
    if (!teacherUserId?.trim()) {
      res.status(400).json({ error: "teacherUserId is required" });
      return;
    }
    // نامِ درس باید یکی از درس‌هایِ *واقعیِ همین مدرسه* باشد (school_subjects) — نه فهرستِ ثابت.
    await ensureSchoolSubjectsSeeded(req.params.schoolId);
    const [subjectRow] = typeof subject === "string" && subject
      ? await db.select({ id: schoolSubjectsTable.id }).from(schoolSubjectsTable)
          .where(and(eq(schoolSubjectsTable.schoolId, req.params.schoolId), eq(schoolSubjectsTable.name, subject))).limit(1)
      : [];
    if (!subjectRow) {
      res.status(400).json({ error: "Invalid subject" });
      return;
    }
    // آن معلم باید واقعاً عضوِ همین مدرسه باشد (و نقش‌اش معلم)؛ وگرنه تخصیص بی‌معناست.
    const [targetMember] = await db.select().from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.userId, teacherUserId.trim()), eq(schoolMembersTable.schoolId, req.params.schoolId)))
      .limit(1);
    if (!targetMember || targetMember.role !== "teacher") {
      res.status(400).json({ error: "User is not a teacher at this school" });
      return;
    }
    const [row] = await db.insert(schoolTeacherSubjectsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      teacherUserId: teacherUserId.trim(),
      subject,
      classId: classId ?? null,
    }).returning();
    res.status(201).json(formatRow(row));
  } catch (err) {
    logger.error({ err }, "Create teacher subject error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/teacher-subjects/:id — فقط admin
router.delete("/schools/:schoolId/teacher-subjects/:id", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(schoolTeacherSubjectsTable)
      .where(and(eq(schoolTeacherSubjectsTable.id, req.params.id), eq(schoolTeacherSubjectsTable.schoolId, req.params.schoolId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete teacher subject error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
