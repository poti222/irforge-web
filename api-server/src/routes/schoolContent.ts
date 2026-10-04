/**
 * routes/schoolContent.ts — لغت‌نامه/جزوه/کتاب/فرمول (بخش "/schools" فاز ۱).
 * خواندن برای هر عضوِ مدرسه آزاد است؛ نوشتن (ساخت/ویرایش/حذف) فقط برای
 * role های "admin"/"teacher" — دقیقاً طبقِ خواسته‌ی کاربر.
 *
 * فازِ جدید — گیتِ موضوعی: قبلاً هر admin/teacherِ یک مدرسه می‌توانست *هر*
 * آیتمِ محتواییِ همان مدرسه را بسازد/ویرایش/حذف کند (مثلاً معلمِ هندسه،
 * لغت‌نامه‌ی ادبیات را). حالا teacher فقط برایِ `subject`هایی که در
 * `school_teacher_subjects` به او تخصیص داده شده اجازه‌یِ نوشتن دارد؛ admin
 * دست‌نخورده می‌ماند (هر موضوع/هر مدرسه، طبقِ منطقِ قبلی). آیتم‌هایِ
 * `subject=NULL` (محتوایِ از قبل موجود یا عمداً بدونِ‌درس) را فقط admin
 * می‌تواند بنویسد — نه این‌که برایِ هیچ‌کس قابلِ‌ویرایش نباشد، نه این‌که هر
 * معلمی بدونِ مالکیتِ مشخص آن را بگیرد.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolContentItemsTable, schoolContentLessonsTable, schoolMembersTable, schoolTeacherSubjectsTable,
  SCHOOL_CONTENT_TYPES, SCHOOL_SUBJECTS,
} from "@workspace/db";
import { eq, or, isNull, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";

const router = Router();

function formatItem(i: typeof schoolContentItemsTable.$inferSelect) {
  return {
    id: i.id,
    schoolId: i.schoolId,
    type: i.type,
    title: i.title,
    body: i.body,
    language: i.language,
    subject: i.subject,
    imageUrl: i.imageUrl,
    lessonId: i.lessonId,
    createdByUserId: i.createdByUserId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

const NOT_ASSIGNED_ERROR = "شما هنوز به هیچ درسی تخصیص داده‌نشده‌اید";
const WRONG_SUBJECT_ERROR = "شما اجازه‌ی نوشتن در این درس را ندارید";

type WriteCheck =
  | { ok: true; member: typeof schoolMembersTable.$inferSelect }
  | { ok: false; status: number; error: string };

/**
 * آیا `userId` اجازه‌ی نوشتن (ساخت/ویرایش/حذف) رویِ یک آیتمِ محتوایی با
 * `schoolId`/`subject` دادهشده را دارد؟ `subject` همان مقداری است که آن
 * آیتم (موجود یا در‌حالِ‌ساخت) دارد/خواهد داشت.
 */
async function canWrite(userId: string, schoolId: string | null, subject: string | null): Promise<WriteCheck> {
  const [member] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  if (!member) return { ok: false, status: 403, error: "Forbidden" };
  if (member.role !== "admin" && member.role !== "teacher") return { ok: false, status: 403, error: "Forbidden" };
  // محتوایِ عمومی (schoolId=null) را هر مدیر/معلمی می‌تواند بسازد؛ محتوایِ
  // مختصِ یک مدرسه فقط توسطِ عضوِ همان مدرسه.
  if (schoolId && member.schoolId !== schoolId) return { ok: false, status: 403, error: "Forbidden" };
  // admin: بدونِ هیچ گیتِ موضوعی، دقیقاً مثلِ قبل.
  if (member.role === "admin") return { ok: true, member };

  // teacher: گیتِ موضوعی. آیتم‌هایِ بدونِ‌درس (subject=null) فقط admin می‌نویسد.
  if (!subject) return { ok: false, status: 403, error: "Forbidden" };
  // برایِ محتوایِ عمومی (schoolId=null)، تخصیصِ معلم در *مدرسه‌یِ خودش* چک می‌شود.
  const scopeSchoolId = schoolId ?? member.schoolId;
  if (!scopeSchoolId) return { ok: false, status: 403, error: "Forbidden" };
  const assignments = await db.select().from(schoolTeacherSubjectsTable)
    .where(and(eq(schoolTeacherSubjectsTable.teacherUserId, userId), eq(schoolTeacherSubjectsTable.schoolId, scopeSchoolId)));
  if (assignments.length === 0) return { ok: false, status: 403, error: NOT_ASSIGNED_ERROR };
  const subjects = new Set(assignments.map((a: typeof assignments[number]) => a.subject));
  if (!subjects.has(subject)) return { ok: false, status: 403, error: WRONG_SUBJECT_ERROR };
  return { ok: true, member };
}

// GET /api/schools/content?schoolId=&type=&subject=&lessonId= — لیست، شاملِ محتوایِ عمومی + محتوایِ همان مدرسه
// lessonId="none" یعنی فقط آیتم‌هایِ بدونِ‌درس (پسودوگروهِ «بدون درس» در UI).
router.get("/schools/content", requireAuth, async (req: any, res) => {
  try {
    const schoolId = typeof req.query.schoolId === "string" ? req.query.schoolId : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const subject = typeof req.query.subject === "string" ? req.query.subject : undefined;
    const lessonId = typeof req.query.lessonId === "string" ? req.query.lessonId : undefined;
    if (type && !(SCHOOL_CONTENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }
    const scopeFilter = schoolId
      ? or(isNull(schoolContentItemsTable.schoolId), eq(schoolContentItemsTable.schoolId, schoolId))
      : isNull(schoolContentItemsTable.schoolId);
    let whereClause = type ? and(scopeFilter, eq(schoolContentItemsTable.type, type)) : scopeFilter;
    if (subject) whereClause = and(whereClause, eq(schoolContentItemsTable.subject, subject));
    if (lessonId === "none") whereClause = and(whereClause, isNull(schoolContentItemsTable.lessonId));
    else if (lessonId) whereClause = and(whereClause, eq(schoolContentItemsTable.lessonId, lessonId));
    const rows = await db.select().from(schoolContentItemsTable).where(whereClause);
    res.json(rows.map(formatItem));
  } catch (err) {
    logger.error({ err }, "List school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/content/:id
router.get("/schools/content/:id", requireAuth, async (req: any, res) => {
  try {
    const [row] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatItem(row));
  } catch (err) {
    logger.error({ err }, "Get school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/content — فقط admin/teacher، و معلم فقط در درسِ تخصیص‌داده‌شده‌اش
router.post("/schools/content", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, type, title, body, language, subject, imageUrl, lessonId } = req.body ?? {};
    if (!type || !(SCHOOL_CONTENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }
    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    // اگر lessonId داده شده، subjectِ آیتم از خودِ درس گرفته می‌شود (نه از
    // ورودیِ کاربر) — وگرنه ممکن بود آیتمی با subject=X داخلِ درسی با
    // subject=Y قرار بگیرد و گیتِ موضوعی دیگر معنا نمی‌داد (ببینید توضیحِ
    // بالایِ schema/schoolContentLessons.ts).
    let effectiveSubject: string | null = subject ?? null;
    if (lessonId) {
      const [lesson] = await db.select().from(schoolContentLessonsTable).where(eq(schoolContentLessonsTable.id, lessonId)).limit(1);
      if (!lesson || lesson.schoolId !== (schoolId ?? null)) {
        res.status(400).json({ error: "Invalid lessonId" });
        return;
      }
      effectiveSubject = lesson.subject;
    } else if (effectiveSubject && !(SCHOOL_SUBJECTS as readonly string[]).includes(effectiveSubject)) {
      res.status(400).json({ error: "Invalid subject" });
      return;
    }
    const check = await canWrite(req.userId, schoolId ?? null, effectiveSubject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    const [item] = await db.insert(schoolContentItemsTable).values({
      id: crypto.randomUUID(),
      schoolId: schoolId ?? null,
      type,
      title: title.trim(),
      body: body ?? "",
      language: language ?? null,
      subject: effectiveSubject,
      imageUrl: imageUrl ?? null,
      lessonId: lessonId ?? null,
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json(formatItem(item));
  } catch (err) {
    logger.error({ err }, "Create school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/schools/:schoolId/content/bulk — افزودنِ دسته‌ایِ چند آیتم با یک
 * درخواست (طبقِ گزارشِ مستقیمِ کاربر: «به‌جایِ یکی‌یکی، چند خط با هم»).
 * فقط برایِ یک `lessonId` واقعی (نه «بدونِ‌درس») — چون subject از خودِ درس
 * گرفته می‌شود، دقیقاً همان منطقِ POST تکی بالا؛ اینجا هم عمداً از همان
 * `canWrite()` استفاده شده (نه یک گیتِ موازیِ جدا) تا این مسیر هرگز راهِ
 * دورزدنِ گیتِ موضوعی نشود.
 *
 * چرا یک insert با آرایه به‌جایِ N تا درخواست/insert؟ هم کارآمدتر است، هم
 * atomic (یا همه یا هیچ) — تجربه‌یِ معلمی که ۲۰ واژه پیست می‌کند نباید با
 * نیمه‌کاره‌ماندنِ درخواست (مثلاً قطعِ شبکه در میانه‌ی N درخواست) به یک
 * نتیجه‌یِ نامشخص برسد.
 */
router.post("/schools/:schoolId/content/bulk", requireAuth, async (req: any, res) => {
  try {
    const schoolId = req.params.schoolId;
    const { lessonId, type, entries } = req.body ?? {};
    if (!type || !(SCHOOL_CONTENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }
    if (!lessonId || typeof lessonId !== "string") {
      res.status(400).json({ error: "lessonId is required" });
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "entries is required" });
      return;
    }
    const [lesson] = await db.select().from(schoolContentLessonsTable).where(eq(schoolContentLessonsTable.id, lessonId)).limit(1);
    if (!lesson || lesson.schoolId !== schoolId) {
      res.status(400).json({ error: "Invalid lessonId" });
      return;
    }
    // همان گیتِ موضوعیِ POST تکی — subject از خودِ درس، نه از ورودیِ کاربر.
    const check = await canWrite(req.userId, schoolId, lesson.subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    // دفاعی: حتی اگر فرانت پیش از ارسال خط‌هایِ ناقص را فیلتر کرده، سرور هم
    // دوباره چک می‌کند — کلاینت هرگز منبعِ اعتماد نیست.
    const valid = (entries as any[])
      .filter((e) => e && typeof e.title === "string" && e.title.trim() && typeof e.body === "string" && e.body.trim())
      .map((e) => ({
        id: crypto.randomUUID(),
        schoolId,
        type,
        title: String(e.title).trim(),
        body: String(e.body).trim(),
        language: null,
        subject: lesson.subject,
        imageUrl: null,
        lessonId,
        createdByUserId: req.userId,
      }));
    if (valid.length === 0) {
      res.status(400).json({ error: "No valid entries" });
      return;
    }
    const created = await db.insert(schoolContentItemsTable).values(valid).returning();
    res.status(201).json(created.map(formatItem));
  } catch (err) {
    logger.error({ err }, "Bulk create school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/content/:id — فقط admin/teacher، و معلم فقط در درسِ (فعلی/جدیدِ) تخصیص‌داده‌شده‌اش
router.patch("/schools/content/:id", requireAuth, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const check = await canWrite(req.userId, existing.schoolId, existing.subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    let { title, body, language, subject, imageUrl, lessonId } = req.body ?? {};
    // اگر lessonId تغییر کند و به یک درسِ واقعی اشاره کند، subject هم طبقِ
    // همان درس بازنویسی می‌شود (ببینید توضیحِ همین منطق در POST بالا).
    if (lessonId !== undefined && lessonId !== existing.lessonId && lessonId) {
      const [lesson] = await db.select().from(schoolContentLessonsTable).where(eq(schoolContentLessonsTable.id, lessonId)).limit(1);
      if (!lesson || lesson.schoolId !== existing.schoolId) {
        res.status(400).json({ error: "Invalid lessonId" });
        return;
      }
      subject = lesson.subject;
    }
    if (subject !== undefined && subject !== existing.subject) {
      // معلم نمی‌تواند آیتم را به درسی که مالکش نیست منتقل کند (و نه به
      // بدونِ‌درس — آن فقط کارِ admin است)؛ دوباره با `subject` جدید چک می‌شود.
      if (subject !== null && !(SCHOOL_SUBJECTS as readonly string[]).includes(subject)) {
        res.status(400).json({ error: "Invalid subject" });
        return;
      }
      if (check.member.role !== "admin") {
        const recheck = await canWrite(req.userId, existing.schoolId, subject ?? null);
        if (!recheck.ok) {
          res.status(recheck.status).json({ error: recheck.error });
          return;
        }
      }
    }
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (language !== undefined) patch.language = language;
    if (subject !== undefined) patch.subject = subject;
    if (imageUrl !== undefined) patch.imageUrl = imageUrl;
    if (lessonId !== undefined) patch.lessonId = lessonId;
    const [updated] = await db.update(schoolContentItemsTable).set(patch).where(eq(schoolContentItemsTable.id, req.params.id)).returning();
    res.json(formatItem(updated));
  } catch (err) {
    logger.error({ err }, "Update school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/content/:id — فقط admin/teacher، و معلم فقط در درسِ تخصیص‌داده‌شده‌اش
router.delete("/schools/content/:id", requireAuth, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const check = await canWrite(req.userId, existing.schoolId, existing.subject);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    await db.delete(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
