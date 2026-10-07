/**
 * routes/schoolClasses.ts — بخش "/schools" فاز ۲: مدیریتِ کلاس‌ها.
 * نوشتن (ساخت/ویرایش/حذف کلاس، افزودن/حذفِ عضو) فقط برایِ admin/deputy؛
 * خواندن برایِ هر عضوِ همان مدرسه (طبقِ اسپک: «معلم/دانش‌آموزِ مربوط بتوانند
 * کلاسِ خودشان را بخوانند»).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolClassesTable, schoolClassMembersTable, schoolSubjectClassesTable, schoolMembersTable, SCHOOL_MEMBER_ROLES } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_DEPUTY } from "../lib/schoolAuth";

const router = Router();

function formatClass(c: typeof schoolClassesTable.$inferSelect) {
  return {
    id: c.id,
    schoolId: c.schoolId,
    name: c.name,
    grade: c.grade,
    academicYear: c.academicYear,
    createdAt: c.createdAt.toISOString(),
  };
}

function formatClassMember(m: typeof schoolClassMembersTable.$inferSelect) {
  return {
    id: m.id,
    classId: m.classId,
    schoolMemberId: m.schoolMemberId,
    roleInClass: m.roleInClass,
    addedAt: m.addedAt.toISOString(),
  };
}

async function requireSchoolWrite(req: any, res: any, schoolId: string): Promise<boolean> {
  const { ok } = await canAccessSchool(req.userId, schoolId, SCHOOL_ADMIN_DEPUTY);
  if (!ok) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /api/schools/:schoolId/classes — لیستِ کلاس‌های یک مدرسه؛ هر عضوِ همان مدرسه.
router.get("/schools/:schoolId/classes", requireAuth, async (req: any, res) => {
  try {
    const { ok, member: requester } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, req.params.schoolId));
    // ?mine=true — فقط کلاس‌هایی که خودِ فرستنده در آن‌ها روستر دارد: معلم
    // roleInClass="teacher" (صفحه‌ی «کلاس‌های من»ِ معلم)، دانش‌آموز
    // roleInClass="student" (فاز ۳: صفحه‌ی «تکالیفِ من»ِ دانش‌آموز، تا فقط
    // تکالیفِ کلاسِ خودش را ببیند، نه کلِ کلاس‌هایِ مدرسه).
    if (req.query.mine === "true" && requester) {
      const wantedRole = requester.role === "teacher" ? "teacher" : "student";
      const memberships = await db.select().from(schoolClassMembersTable)
        .where(and(eq(schoolClassMembersTable.schoolMemberId, requester.id), eq(schoolClassMembersTable.roleInClass, wantedRole)));
      const myClassIds = new Set(memberships.map((m: typeof memberships[number]) => m.classId));
      res.json(rows.filter((c: typeof rows[number]) => myClassIds.has(c.id)).map(formatClass));
      return;
    }
    res.json(rows.map(formatClass));
  } catch (err) {
    logger.error({ err }, "List school classes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/classes — فقط admin/deputy
router.post("/schools/:schoolId/classes", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolWrite(req, res, req.params.schoolId);
    if (!allowed) return;
    const { name, grade, academicYear } = req.body ?? {};
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [row] = await db.insert(schoolClassesTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      name: name.trim(),
      grade: grade ?? null,
      academicYear: academicYear ?? null,
    }).returning();
    res.status(201).json(formatClass(row));
  } catch (err) {
    logger.error({ err }, "Create school class error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/classes/:classId — فقط admin/deputy
router.patch("/schools/:schoolId/classes/:classId", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolWrite(req, res, req.params.schoolId);
    if (!allowed) return;
    const { name, grade, academicYear } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (grade !== undefined) patch.grade = grade;
    if (academicYear !== undefined) patch.academicYear = academicYear;
    const [row] = await db.update(schoolClassesTable).set(patch)
      .where(and(eq(schoolClassesTable.id, req.params.classId), eq(schoolClassesTable.schoolId, req.params.schoolId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatClass(row));
  } catch (err) {
    logger.error({ err }, "Update school class error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/classes/:classId — فقط admin/deputy
router.delete("/schools/:schoolId/classes/:classId", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolWrite(req, res, req.params.schoolId);
    if (!allowed) return;
    // کلاس باید متعلق به همین مدرسه باشد؛ قبلاً روسترِ هر classIdی (حتی مدرسهٔ دیگر) پاک می‌شد.
    const [own] = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable)
      .where(and(eq(schoolClassesTable.id, req.params.classId), eq(schoolClassesTable.schoolId, req.params.schoolId))).limit(1);
    if (!own) { res.status(204).end(); return; }
    await db.delete(schoolSubjectClassesTable).where(eq(schoolSubjectClassesTable.classId, req.params.classId));
    await db.delete(schoolClassMembersTable).where(eq(schoolClassMembersTable.classId, req.params.classId));
    await db.delete(schoolClassesTable).where(and(eq(schoolClassesTable.id, req.params.classId), eq(schoolClassesTable.schoolId, req.params.schoolId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school class error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/classes/:classId/members — روسترِ کلاس
router.get("/schools/:schoolId/classes/:classId/members", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolClassMembersTable).where(eq(schoolClassMembersTable.classId, req.params.classId));
    res.json(rows.map(formatClassMember));
  } catch (err) {
    logger.error({ err }, "List class members error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/classes/:classId/members — افزودنِ دانش‌آموز/معلم به روستر؛ فقط admin/deputy
router.post("/schools/:schoolId/classes/:classId/members", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolWrite(req, res, req.params.schoolId);
    if (!allowed) return;
    const { schoolMemberId, roleInClass } = req.body ?? {};
    if (!schoolMemberId?.trim()) {
      res.status(400).json({ error: "schoolMemberId is required" });
      return;
    }
    // کلاس و عضو هر دو باید مالِ همین مدرسه باشند (قبلاً هیچ‌کدام چک نمی‌شد).
    const [cls] = await db.select().from(schoolClassesTable)
      .where(and(eq(schoolClassesTable.id, req.params.classId), eq(schoolClassesTable.schoolId, req.params.schoolId))).limit(1);
    const [target] = await db.select().from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.id, schoolMemberId.trim()), eq(schoolMembersTable.schoolId, req.params.schoolId))).limit(1);
    if (!cls || !target) {
      res.status(404).json({ error: "Class or member not found in this school" });
      return;
    }
    const asRole = roleInClass === "teacher" ? "teacher" : "student";
    // دانش‌آموز دقیقاً یک کلاس دارد؛ برایِ تغییر ابتدا از کلاسِ قبلی حذفش کنید.
    if (asRole === "student") {
      const existing = await db.select().from(schoolClassMembersTable)
        .where(and(eq(schoolClassMembersTable.schoolMemberId, target.id), eq(schoolClassMembersTable.roleInClass, "student")));
      if (existing.length > 0) {
        res.status(409).json({ error: "این دانش‌آموز از قبل در یک کلاس است؛ ابتدا از کلاسِ قبلی حذفش کنید.", code: "student_already_in_class" });
        return;
      }
    }
    const [row] = await db.insert(schoolClassMembersTable).values({
      id: crypto.randomUUID(),
      classId: req.params.classId,
      schoolMemberId: target.id,
      roleInClass: asRole,
    }).returning();
    res.status(201).json(formatClassMember(row));
  } catch (err) {
    logger.error({ err }, "Add class member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/classes/:classId/members/:memberId — فقط admin/deputy
router.delete("/schools/:schoolId/classes/:classId/members/:memberId", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolWrite(req, res, req.params.schoolId);
    if (!allowed) return;
    await db.delete(schoolClassMembersTable).where(and(eq(schoolClassMembersTable.id, req.params.memberId), eq(schoolClassMembersTable.classId, req.params.classId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Remove class member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
