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
  db, schoolContentLessonsTable, schoolContentItemsTable, schoolSubjectsTable,
  SCHOOL_MEMBER_ROLES,
} from "@workspace/db";
import { eq, and, sql, asc } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool } from "../lib/schoolAuth";
import {
  describeLesson, getContentScope, loadContentContext, loadLessonStats, normalizeEnabledTypes,
  ensureSchoolSubjectsSeeded,
} from "../lib/schoolContentAccess";

const router = Router();

/** آیا این نام یکی از «درس»هایِ مدیریت‌شده‌یِ همین مدرسه است؟ (جایگزینِ فهرستِ ثابتِ SCHOOL_SUBJECTS) */
async function subjectExists(schoolId: string, name: unknown): Promise<boolean> {
  if (typeof name !== "string" || !name) return false;
  await ensureSchoolSubjectsSeeded(schoolId);
  const [row] = await db.select({ id: schoolSubjectsTable.id }).from(schoolSubjectsTable)
    .where(and(eq(schoolSubjectsTable.schoolId, schoolId), eq(schoolSubjectsTable.name, name))).limit(1);
  return !!row;
}

/** پاسخِ کاملِ یک جلسه (انواعِ مؤثر، شمارش، پیشرفتِ همین کاربر). */
async function describeOne(lesson: typeof schoolContentLessonsTable.$inferSelect, userId: string) {
  const scope = await getContentScope(userId, lesson.schoolId);
  const [ctx, stats] = await Promise.all([loadContentContext(lesson.schoolId), loadLessonStats(lesson.schoolId, scope.memberId)]);
  return describeLesson(lesson, ctx, scope, stats);
}

const NOT_ASSIGNED_ERROR = "شما هنوز به هیچ درسی تخصیص داده‌نشده‌اید";
const WRONG_SUBJECT_ERROR = "شما اجازه‌ی نوشتن در این درس را ندارید";

type WriteCheck =
  | { ok: true; isAdmin: boolean }
  | { ok: false; status: number; error: string };

/**
 * همان گیتِ موضوعیِ canWrite در routes/schoolContent.ts، مختصِ یک `schoolId`
 * معلوم. از getContentScope استفاده می‌کند تا مدیرِ «مدرسه‌یِ غیرِ اصلی»
 * (school_admins) هم درست تشخیص داده شود.
 */
async function canWriteLesson(userId: string, schoolId: string, subject: string): Promise<WriteCheck> {
  const scope = await getContentScope(userId, schoolId);
  if (!scope.isMember) return { ok: false, status: 403, error: "Forbidden" };
  if (scope.isAdmin) return { ok: true, isAdmin: true };
  if (scope.role !== "teacher") return { ok: false, status: 403, error: "Forbidden" };
  if (scope.assigned.size === 0) return { ok: false, status: 403, error: NOT_ASSIGNED_ERROR };
  if (!scope.assigned.has(subject)) return { ok: false, status: 403, error: WRONG_SUBJECT_ERROR };
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
    const rows = await db.select().from(schoolContentLessonsTable).where(whereClause)
      .orderBy(asc(schoolContentLessonsTable.sortOrder), asc(schoolContentLessonsTable.createdAt));
    const scope = await getContentScope(req.userId, req.params.schoolId);
    const [ctx, stats] = await Promise.all([loadContentContext(req.params.schoolId), loadLessonStats(req.params.schoolId, scope.memberId)]);
    res.json(rows.map((l: any) => describeLesson(l, ctx, scope, stats)));
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
    res.json(await describeOne(lesson, req.userId));
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
    // اول گیتِ دسترسی، بعد اعتبارسنجیِ نامِ درس — تا غیرعضو از این مسیر وجودِ درس‌ها را نفهمد.
    const check = await canWriteLesson(req.userId, req.params.schoolId, typeof subject === "string" ? subject : "");
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    if (!(await subjectExists(req.params.schoolId, subject))) {
      res.status(400).json({ error: "Invalid subject" });
      return;
    }
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schoolContentLessonsTable.sortOrder}), 0)::int` })
      .from(schoolContentLessonsTable)
      .where(and(eq(schoolContentLessonsTable.schoolId, req.params.schoolId), eq(schoolContentLessonsTable.subject, subject)));
    const [lesson] = await db.insert(schoolContentLessonsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      subject,
      title: title.trim(),
      sortOrder: max + 1,
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json(await describeOne(lesson, req.userId));
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
    const { title, subject, enabledTypes } = req.body ?? {};
    if (subject !== undefined && subject !== existing.subject) {
      if (!(await subjectExists(req.params.schoolId, subject))) {
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
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      patch.title = title.trim();
    }
    if (subject !== undefined) patch.subject = subject;
    // enabledTypes: null = از درس ارث ببر؛ آرایه = override برایِ همین جلسه.
    if (enabledTypes !== undefined) {
      const types = enabledTypes === null ? null : normalizeEnabledTypes(enabledTypes);
      if (enabledTypes !== null && !types) {
        res.status(400).json({ error: "Invalid enabledTypes" });
        return;
      }
      patch.enabledTypes = types;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const updated = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(schoolContentLessonsTable).set(patch)
        .where(eq(schoolContentLessonsTable.id, req.params.id)).returning();
      // انتقالِ جلسه به درسِ دیگر: subjectِ آیتم‌هایِ داخلش هم باید دنبالش بیاید، وگرنه
      // گیتِ موضوعیِ معلم رویِ آن‌ها با درسِ قدیمی سنجیده می‌شد.
      if (subject !== undefined && subject !== existing.subject) {
        await tx.update(schoolContentItemsTable).set({ subject }).where(eq(schoolContentItemsTable.lessonId, req.params.id));
      }
      return row;
    });
    res.json(await describeOne(updated, req.userId));
  } catch (err) {
    logger.error({ err }, "Update school content lesson error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/content-lessons/reorder — { subject, orderedIds } ترتیبِ جدیدِ همه‌یِ جلسه‌هایِ یک درس
router.post("/schools/:schoolId/content-lessons/reorder", requireAuth, async (req: any, res) => {
  try {
    const { subject, orderedIds } = req.body ?? {};
    if (typeof subject !== "string" || !Array.isArray(orderedIds) || !orderedIds.every((x: unknown) => typeof x === "string")) {
      res.status(400).json({ error: "subject and orderedIds are required" });
      return;
    }
    const check = await canWriteLesson(req.userId, req.params.schoolId, subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    const rows = await db.select({ id: schoolContentLessonsTable.id }).from(schoolContentLessonsTable)
      .where(and(eq(schoolContentLessonsTable.schoolId, req.params.schoolId), eq(schoolContentLessonsTable.subject, subject)));
    const existingIds = new Set(rows.map((r: { id: string }) => r.id));
    const given = new Set<string>(orderedIds);
    if (given.size !== orderedIds.length || given.size !== existingIds.size || !orderedIds.every((x: string) => existingIds.has(x))) {
      res.status(400).json({ error: "orderedIds must list exactly the lessons of this subject" });
      return;
    }
    await db.transaction(async (tx: any) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(schoolContentLessonsTable).set({ sortOrder: i + 1 }).where(eq(schoolContentLessonsTable.id, orderedIds[i]));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Reorder school content lessons error");
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
