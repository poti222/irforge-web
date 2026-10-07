/**
 * routes/schoolSubjects.ts — «درس‌ها»ِ هر مدرسه (ادبیات، ریاضی، ...)؛
 * ببینید schema/schoolSubjects.ts برایِ توضیحِ طراحی.
 *
 * خواندن: هر عضوِ مدرسه. ساخت/حذف/تغییرِ نام/آیکن/رنگ: فقط admin.
 * روشن/خاموش‌کردنِ انواعِ محتوا (enabledTypes): admin یا معلمِ تخصیص‌داده‌شده
 * به همان درس.
 *
 * ── تصمیم‌هایِ مستند ──────────────────────────────────────────────────────
 * • ارجاعِ ستون‌هایِ `subject` به این جدول با «نام» است (نه id)؛ پس تغییرِ نام
 *   در یک تراکنش، چهار جا را با هم عوض می‌کند: school_subjects، lessons، items،
 *   teacher_subjects — یا همه یا هیچ.
 * • حذف: اگر درس جلسه/آیتم/تخصیصِ معلم دارد، بدونِ `?force=true` پاسخ ۴۰۹ با
 *   شمارش‌ها می‌دهد. با force: جلسه‌هایِ درس حذف می‌شوند (آیتم‌هایِ داخلشان
 *   *پاک نمی‌شوند*: lessonId و subject → NULL، یعنی «بدونِ درس»، دقیقاً مثلِ
 *   حذفِ یک جلسه) و تخصیصِ معلم‌ها به این درس لغو می‌شود. ردیف‌هایِ پیشرفتِ
 *   دانش‌آموزان دست‌نخورده می‌مانند (به آیتم اشاره می‌کنند، نه به درس).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  schoolSubjectsTable,
  schoolSubjectClassesTable,
  schoolClassesTable,
  schoolContentLessonsTable,
  schoolContentItemsTable,
  schoolTeacherSubjectsTable,
  SCHOOL_CONTENT_TYPE_KEYS,
} from "@workspace/db";
import { requireAuth } from "./auth";
import {
  canManageSubjectName,
  describeLesson,
  ensureSchoolSubjectsSeeded,
  getContentScope,
  loadContentContext,
  loadLessonStats,
  normalizeEnabledTypes,
  subjectVisibleTo,
} from "../lib/schoolContentAccess";

const router = Router();

const STYLE_KEY_RE = /^[a-z0-9-]{1,32}$/;
const NAME_MAX = 60;

function formatSubject(
  s: typeof schoolSubjectsTable.$inferSelect,
  extra: { lessonCount: number; progress: { mastered: number; total: number }; canManage: boolean; classIds?: string[] | null },
) {
  return {
    id: s.id,
    schoolId: s.schoolId,
    name: s.name,
    icon: s.icon,
    color: s.color,
    enabledTypes: s.enabledTypes,
    sortOrder: s.sortOrder,
    lessonCount: extra.lessonCount,
    progress: extra.progress,
    canManage: extra.canManage,
    /** فقط برایِ مدیر: کلاس‌هایِ مجازِ درس (null = همهٔ کلاس‌ها). */
    ...(extra.classIds !== undefined ? { classIds: extra.classIds } : {}),
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * کلیدِ مقایسه‌یِ نامِ درس: «ادبیاتِ فارسی» / «ادبیات فارسی» / «ادبیات‌فارسی» / «ادبيات فارسي» (ي و ك عربی،
 * اِعراب، کشیده، فاصله و نیم‌فاصله) را یکی می‌گیرد. قیدِ unique در دیتابیس فقط تطابقِ دقیقِ رشته را می‌گیرد؛
 * بدونِ این کلید کاربر «ادبیات فارسی» را کنارِ seedشده‌یِ «ادبیاتِ فارسی» می‌ساخت و یک بار موفق، بار بعد ۴۰۹ می‌دید
 * که انگار «همان درس» را هم نمی‌بیند. این‌جا قبل از درج می‌سنجیم و به کاربر می‌گوییم کدام درس مانعِ اوست.
 */
export function subjectNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u200C\u200D\u200E\u200F\s]+/g, "")
    .toLowerCase();
}

async function findNameConflict(schoolId: string, name: string, exceptId?: string) {
  const key = subjectNameKey(name);
  const rows = await db.select({ id: schoolSubjectsTable.id, name: schoolSubjectsTable.name })
    .from(schoolSubjectsTable).where(eq(schoolSubjectsTable.schoolId, schoolId));
  return rows.find((r: { id: string; name: string }) => r.id !== exceptId && subjectNameKey(r.name) === key) ?? null;
}

function duplicateBody(existing: { id: string; name: string } | null, schoolId: string) {
  return {
    error: existing ? `A subject named "${existing.name}" already exists in this school` : "A subject with this name already exists",
    code: "duplicate_name",
    existing: existing ? { id: existing.id, name: existing.name, schoolId } : undefined,
  };
}

function isUniqueViolation(err: any) {
  return err?.code === "23505" || err?.cause?.code === "23505";
}

async function buildSubjectView(schoolId: string, userId: string, onlyId?: string) {
  const scope = await getContentScope(userId, schoolId);
  if (!scope.isMember) return null;
  const ctx = await loadContentContext(schoolId); // شاملِ ensureSchoolSubjectsSeeded
  const stats = await loadLessonStats(schoolId, scope.memberId);
  const lessons = [...ctx.lessonsById.values()];
  let subjects = [...ctx.subjectsByName.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fa"));
  if (onlyId) subjects = subjects.filter((s) => s.id === onlyId);
  // درس فقط در کلاس‌هایِ انتخاب‌شده وجود دارد: دانش‌آموز/معلمِ کلاس‌هایِ دیگر آن را نمی‌بینند (مدیر همه را).
  subjects = subjects.filter((s) => subjectVisibleTo(s.name, ctx, scope));
  return subjects.map((s) => {
    const own = lessons.filter((l) => l.subject === s.name);
    let mastered = 0;
    let total = 0;
    for (const l of own) {
      const d = describeLesson(l, ctx, scope, stats);
      mastered += d.progress.mastered;
      total += d.progress.total;
    }
    return formatSubject(s, {
      lessonCount: own.length,
      progress: { mastered, total },
      canManage: canManageSubjectName(scope, s.name),
      classIds: scope.isAdmin ? (ctx.subjectClassesByName.get(s.name) ? [...ctx.subjectClassesByName.get(s.name)!] : null) : undefined,
    });
  });
}

/** ورودیِ classIds: آرایهٔ idِ کلاس‌هایِ *همین مدرسه* یا null/[] = همهٔ کلاس‌ها. نامعتبر → undefined. */
async function parseClassIds(schoolId: string, input: unknown): Promise<string[] | null | undefined> {
  if (input === null || (Array.isArray(input) && input.length === 0)) return null;
  if (!Array.isArray(input) || !input.every((x) => typeof x === "string") || input.length > 500) return undefined;
  const ids = [...new Set(input as string[])];
  const own = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable)
    .where(and(eq(schoolClassesTable.schoolId, schoolId), inArray(schoolClassesTable.id, ids)));
  return own.length === ids.length ? ids : undefined;
}

async function replaceSubjectClasses(tx: any, subjectId: string, classIds: string[] | null) {
  await tx.delete(schoolSubjectClassesTable).where(eq(schoolSubjectClassesTable.subjectId, subjectId));
  if (classIds?.length) await tx.insert(schoolSubjectClassesTable).values(classIds.map((classId) => ({ subjectId, classId })));
}

// GET /api/schools/:schoolId/subjects — هر عضوِ مدرسه
router.get("/schools/:schoolId/subjects", requireAuth, async (req: any, res) => {
  try {
    const view = await buildSubjectView(req.params.schoolId, req.userId);
    if (!view) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(view);
  } catch (err) {
    logger.error({ err }, "List school subjects error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/subjects/:id
router.get("/schools/:schoolId/subjects/:id", requireAuth, async (req: any, res) => {
  try {
    const view = await buildSubjectView(req.params.schoolId, req.userId, req.params.id);
    if (!view) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (view.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(view[0]);
  } catch (err) {
    logger.error({ err }, "Get school subject error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/subjects — فقط admin
router.post("/schools/:schoolId/subjects", requireAuth, async (req: any, res) => {
  try {
    const scope = await getContentScope(req.userId, req.params.schoolId);
    if (!scope.isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { name, icon, color, enabledTypes, classIds } = req.body ?? {};
    const parsedClassIds = classIds === undefined ? null : await parseClassIds(req.params.schoolId, classIds);
    if (parsedClassIds === undefined) { res.status(400).json({ error: "Invalid classIds", code: "invalid_class_ids" }); return; }
    const cleanName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
    if (!cleanName || cleanName.length > NAME_MAX) {
      res.status(400).json({ error: "name is required (max 60 chars)" });
      return;
    }
    if ((icon != null && !STYLE_KEY_RE.test(icon)) || (color != null && !STYLE_KEY_RE.test(color))) {
      res.status(400).json({ error: "Invalid icon/color" });
      return;
    }
    const types = enabledTypes === undefined ? [...SCHOOL_CONTENT_TYPE_KEYS] : normalizeEnabledTypes(enabledTypes);
    if (!types) {
      res.status(400).json({ error: "Invalid enabledTypes" });
      return;
    }
    // قبل از اولین درجِ دستی، seedِ پیش‌فرض‌ها انجام شده باشد؛ وگرنه lazy-seedِ بعدی
    // کنارِ درسِ تازه می‌نشست (ایمن است ولی ترتیبِ sortOrder را بی‌ربط می‌کند).
    await ensureSchoolSubjectsSeeded(req.params.schoolId);
    const conflict = await findNameConflict(req.params.schoolId, cleanName);
    if (conflict) {
      res.status(409).json(duplicateBody(conflict, req.params.schoolId));
      return;
    }
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schoolSubjectsTable.sortOrder}), -1)::int` })
      .from(schoolSubjectsTable).where(eq(schoolSubjectsTable.schoolId, req.params.schoolId));
    const row = await db.transaction(async (tx: any) => {
      const [r] = await tx.insert(schoolSubjectsTable).values({
        id: randomUUID(),
        schoolId: req.params.schoolId,
        name: cleanName,
        icon: icon ?? null,
        color: color ?? null,
        enabledTypes: types,
        sortOrder: max + 1,
      }).returning();
      await replaceSubjectClasses(tx, r.id, parsedClassIds);
      return r;
    });
    res.status(201).json(formatSubject(row, { lessonCount: 0, progress: { mastered: 0, total: 0 }, canManage: true, classIds: parsedClassIds }));
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await findNameConflict(req.params.schoolId, String(req.body?.name ?? "").trim().replace(/\s+/g, " ")).catch(() => null);
      res.status(409).json(duplicateBody(existing, req.params.schoolId));
      return;
    }
    logger.error({ err }, "Create school subject error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/subjects/:id — name/icon/color/sortOrder: admin؛ enabledTypes: admin یا معلمِ همین درس
router.patch("/schools/:schoolId/subjects/:id", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, id } = req.params;
    const scope = await getContentScope(req.userId, schoolId);
    if (!scope.isMember) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [existing] = await db.select().from(schoolSubjectsTable)
      .where(and(eq(schoolSubjectsTable.id, id), eq(schoolSubjectsTable.schoolId, schoolId))).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { name, icon, color, sortOrder, enabledTypes, classIds } = req.body ?? {};
    const touchesAdminFields = name !== undefined || icon !== undefined || color !== undefined || sortOrder !== undefined || classIds !== undefined;
    if (touchesAdminFields && !scope.isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (enabledTypes !== undefined && !canManageSubjectName(scope, existing.name)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const patch: Record<string, unknown> = {};
    let newName: string | undefined;
    if (name !== undefined) {
      newName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
      if (!newName || newName.length > NAME_MAX) {
        res.status(400).json({ error: "name is required (max 60 chars)" });
        return;
      }
      patch.name = newName;
      const conflict = await findNameConflict(schoolId, newName, id);
      if (conflict) {
        res.status(409).json(duplicateBody(conflict, schoolId));
        return;
      }
    }
    if (icon !== undefined) {
      if (icon !== null && !STYLE_KEY_RE.test(icon)) { res.status(400).json({ error: "Invalid icon" }); return; }
      patch.icon = icon;
    }
    if (color !== undefined) {
      if (color !== null && !STYLE_KEY_RE.test(color)) { res.status(400).json({ error: "Invalid color" }); return; }
      patch.color = color;
    }
    if (sortOrder !== undefined) {
      if (!Number.isInteger(sortOrder)) { res.status(400).json({ error: "Invalid sortOrder" }); return; }
      patch.sortOrder = sortOrder;
    }
    if (enabledTypes !== undefined) {
      const types = normalizeEnabledTypes(enabledTypes);
      if (!types) { res.status(400).json({ error: "Invalid enabledTypes" }); return; }
      patch.enabledTypes = types;
    }
    let parsedClassIds: string[] | null | undefined;
    if (classIds !== undefined) {
      parsedClassIds = await parseClassIds(schoolId, classIds);
      if (parsedClassIds === undefined) { res.status(400).json({ error: "Invalid classIds", code: "invalid_class_ids" }); return; }
    }
    if (Object.keys(patch).length === 0 && classIds === undefined) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    await db.transaction(async (tx: any) => {
      if (Object.keys(patch).length) await tx.update(schoolSubjectsTable).set(patch).where(eq(schoolSubjectsTable.id, id));
      if (classIds !== undefined) await replaceSubjectClasses(tx, id, parsedClassIds ?? null);
      if (newName && newName !== existing.name) {
        // نام ارجاعِ متنیِ سه ستونِ دیگر است — همه در همین تراکنش هم‌گام می‌شوند.
        await tx.update(schoolContentLessonsTable).set({ subject: newName })
          .where(and(eq(schoolContentLessonsTable.schoolId, schoolId), eq(schoolContentLessonsTable.subject, existing.name)));
        await tx.update(schoolContentItemsTable).set({ subject: newName })
          .where(and(eq(schoolContentItemsTable.schoolId, schoolId), eq(schoolContentItemsTable.subject, existing.name)));
        await tx.update(schoolTeacherSubjectsTable).set({ subject: newName })
          .where(and(eq(schoolTeacherSubjectsTable.schoolId, schoolId), eq(schoolTeacherSubjectsTable.subject, existing.name)));
      }
    });
    const view = await buildSubjectView(schoolId, req.userId, id);
    res.json(view?.[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json(duplicateBody(null, req.params.schoolId));
      return;
    }
    logger.error({ err }, "Update school subject error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/subjects/:id?force=true — فقط admin
router.delete("/schools/:schoolId/subjects/:id", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, id } = req.params;
    const scope = await getContentScope(req.userId, schoolId);
    if (!scope.isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [existing] = await db.select().from(schoolSubjectsTable)
      .where(and(eq(schoolSubjectsTable.id, id), eq(schoolSubjectsTable.schoolId, schoolId))).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const force = req.query.force === "true";
    const lessons = await db.select({ id: schoolContentLessonsTable.id }).from(schoolContentLessonsTable)
      .where(and(eq(schoolContentLessonsTable.schoolId, schoolId), eq(schoolContentLessonsTable.subject, existing.name)));
    const lessonIds = lessons.map((l: { id: string }) => l.id);
    const [{ items }] = await db.select({ items: sql<number>`count(*)::int` }).from(schoolContentItemsTable)
      .where(and(eq(schoolContentItemsTable.schoolId, schoolId), eq(schoolContentItemsTable.subject, existing.name)));
    const [{ assignments }] = await db.select({ assignments: sql<number>`count(*)::int` }).from(schoolTeacherSubjectsTable)
      .where(and(eq(schoolTeacherSubjectsTable.schoolId, schoolId), eq(schoolTeacherSubjectsTable.subject, existing.name)));
    const counts = { lessons: lessonIds.length, items, assignments };
    if (!force && (counts.lessons > 0 || counts.items > 0 || counts.assignments > 0)) {
      res.status(409).json({ error: "Subject is not empty", code: "subject_not_empty", counts });
      return;
    }
    await db.transaction(async (tx: any) => {
      if (lessonIds.length > 0) {
        await tx.update(schoolContentItemsTable).set({ lessonId: null }).where(inArray(schoolContentItemsTable.lessonId, lessonIds));
      }
      await tx.update(schoolContentItemsTable).set({ subject: null })
        .where(and(eq(schoolContentItemsTable.schoolId, schoolId), eq(schoolContentItemsTable.subject, existing.name)));
      await tx.delete(schoolContentLessonsTable)
        .where(and(eq(schoolContentLessonsTable.schoolId, schoolId), eq(schoolContentLessonsTable.subject, existing.name)));
      await tx.delete(schoolTeacherSubjectsTable)
        .where(and(eq(schoolTeacherSubjectsTable.schoolId, schoolId), eq(schoolTeacherSubjectsTable.subject, existing.name)));
      await tx.delete(schoolSubjectClassesTable).where(eq(schoolSubjectClassesTable.subjectId, id));
      await tx.delete(schoolSubjectsTable).where(eq(schoolSubjectsTable.id, id));
    });
    res.json({ ok: true, deleted: counts });
  } catch (err) {
    logger.error({ err }, "Delete school subject error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
