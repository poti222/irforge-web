/**
 * routes/schoolContentLessons.ts — لایه‌یِ «درس» رویِ کتابخانه‌ی محتوا
 * (ببینید schema/schoolContentLessons.ts برایِ توضیحِ کاملِ طراحی).
 * خواندن برایِ هر عضوِ مدرسه آزاد است؛ نوشتن (ساخت/ویرایش/حذف) فقط
 * admin/teacher — و معلم فقط در `subject`ی که در `school_teacher_subjects`
 * به او تخصیص داده شده، دقیقاً همان گیتی که routes/schoolContent.ts رویِ
 * آیتم‌ها دارد (قصداً تکرار شده، نه import از آن فایل، تا این دو مسیر مستقل
 * از هم باقی بمانند).
 *
 * حذفِ یک درس *کَسکِید* نمی‌شود: آیتم‌هایِ داخلش از بین نمی‌روند، فقط
 * `lessonId`شان NULL می‌شود (برمی‌گردند به حالتِ «بدونِ‌درس»). یک معلم که
 * اشتباهی یک درس را حذف می‌کند، نباید ده‌ها لغت/شعرِ واقعی را هم با خودش
 * ببرد — محتوا باقی می‌ماند، فقط گروه‌بندی‌اش از بین می‌رود.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolContentLessonsTable, schoolContentItemsTable, schoolTeacherSubjectsTable,
  SCHOOL_SUBJECTS, SCHOOL_MEMBER_ROLES,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

function formatLesson(l: typeof schoolContentLessonsTable.$inferSelect) {
  return {
    id: l.id,
    schoolId: l.schoolId,
    subject: l.subject,
    title: l.title,
    createdByUserId: l.createdByUserId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

const NOT_ASSIGNED_ERROR = "شما هنوز به هیچ درسی تخصیص داده‌نشده‌اید";
const WRONG_SUBJECT_ERROR = "شما اجازه‌ی نوشتن در این درس را ندارید";

type WriteCheck =
  | { ok: true; isAdmin: boolean }
  | { ok: false; status: number; error: string };

/** همان گیتِ موضوعیِ canWrite در routes/schoolContent.ts، مختصِ یک `schoolId` معلوم (درس همیشه مختصِ یک مدرسه است، نه سراسریِ پلتفرم). */
async function canWriteLesson(userId: string, schoolId: string, subject: string): Promise<WriteCheck> {
  const { ok, member } = await canAccessSchool(userId, schoolId, SCHOOL_MEMBER_ROLES);
  if (!ok || !member) return { ok: false, status: 403, error: "Forbidden" };
  if (member.role !== "admin" && member.role !== "teacher") return { ok: false, status: 403, error: "Forbidden" };
  if (member.role === "admin") return { ok: true, isAdmin: true };

  const assignments = await db.select().from(schoolTeacherSubjectsTable)
    .where(and(eq(schoolTeacherSubjectsTable.teacherUserId, userId), eq(schoolTeacherSubjectsTable.schoolId, schoolId)));
  if (assignments.length === 0) return { ok: false, status: 403, error: NOT_ASSIGNED_ERROR };
  const subjects = new Set(assignments.map((a: typeof assignments[number]) => a.subject));
  if (!subjects.has(subject)) return { ok: false, status: 403, error: WRONG_SUBJECT_ERROR };
  return { ok: true, isAdmin: false };
}

// GET /api/schools/:schoolId/content-lessons?subject= — هر عضوِ مدرسه
router.get("/schools/:schoolId/content-lessons", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const subject = typeof req.query.subject === "string" ? req.query.subject : undefined;
    const whereClause = subject
      ? and(eq(schoolContentLessonsTable.schoolId, req.params.schoolId), eq(schoolContentLessonsTable.subject, subject))
      : eq(schoolContentLessonsTable.schoolId, req.params.schoolId);
    const rows = await db.select().from(schoolContentLessonsTable).where(whereClause);
    res.json(rows.map(formatLesson));
  } catch (err) {
    logger.error({ err }, "List school content lessons error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/content-lessons/:id — هر عضوِ مدرسه (مثلاً صفحه‌ی درس برایِ عنوان/موضوعِ خودِ درس)
router.get("/schools/:schoolId/content-lessons/:id", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [lesson] = await db.select().from(schoolContentLessonsTable)
      .where(and(eq(schoolContentLessonsTable.id, req.params.id), eq(schoolContentLessonsTable.schoolId, req.params.schoolId)))
      .limit(1);
    if (!lesson) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatLesson(lesson));
  } catch (err) {
    logger.error({ err }, "Get school content lesson error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/content-lessons — فقط admin/teacher، معلم فقط در درسِ تخصیص‌داده‌شده‌اش
router.post("/schools/:schoolId/content-lessons", requireAuth, async (req: any, res) => {
  try {
    const { subject, title } = req.body ?? {};
    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!subject || !(SCHOOL_SUBJECTS as readonly string[]).includes(subject)) {
      res.status(400).json({ error: "Invalid subject" });
      return;
    }
    const check = await canWriteLesson(req.userId, req.params.schoolId, subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    const [lesson] = await db.insert(schoolContentLessonsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      subject,
      title: title.trim(),
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json(formatLesson(lesson));
  } catch (err) {
    logger.error({ err }, "Create school content lesson error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/content-lessons/:id — تغییرِ عنوان/درس؛ معلم فقط اگر درسِ (فعلی/جدید) را داشته باشد
router.patch("/schools/:schoolId/content-lessons/:id", requireAuth, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(schoolContentLessonsTable)
      .where(and(eq(schoolContentLessonsTable.id, req.params.id), eq(schoolContentLessonsTable.schoolId, req.params.schoolId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const check = await canWriteLesson(req.userId, req.params.schoolId, existing.subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    const { title, subject } = req.body ?? {};
    if (subject !== undefined && subject !== existing.subject) {
      if (!subject || !(SCHOOL_SUBJECTS as readonly string[]).includes(subject)) {
        res.status(400).json({ error: "Invalid subject" });
        return;
      }
      if (!check.isAdmin) {
        const recheck = await canWriteLesson(req.userId, req.params.schoolId, subject);
        if (!recheck.ok) {
          res.status(recheck.status).json({ error: recheck.error });
          return;
        }
      }
    }
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title.trim();
    if (subject !== undefined) patch.subject = subject;
    const [updated] = await db.update(schoolContentLessonsTable).set(patch)
      .where(eq(schoolContentLessonsTable.id, req.params.id)).returning();
    res.json(formatLesson(updated));
  } catch (err) {
    logger.error({ err }, "Update school content lesson error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/content-lessons/:id — غیرِکَسکِید: آیتم‌های داخلش فقط lessonId=NULL می‌شوند
router.delete("/schools/:schoolId/content-lessons/:id", requireAuth, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(schoolContentLessonsTable)
      .where(and(eq(schoolContentLessonsTable.id, req.params.id), eq(schoolContentLessonsTable.schoolId, req.params.schoolId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const check = await canWriteLesson(req.userId, req.params.schoolId, existing.subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    // غیرِکَسکِید طبقِ‌عمد — ببینید توضیحِ بالایِ فایل.
    await db.update(schoolContentItemsTable).set({ lessonId: null }).where(eq(schoolContentItemsTable.lessonId, req.params.id));
    await db.delete(schoolContentLessonsTable).where(eq(schoolContentLessonsTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school content lesson error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
