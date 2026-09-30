/**
 * routes/schoolPrograms.ts — بخش "/schools" فاز ۲/۳: مدیریتِ برنامه‌ها.
 * نوشتن برایِ admin/deputy/deputy_discipline (فاز ۳، بخشِ ۵: معاون‌انضباطی
 * هم به همین صفحه دسترسیِ نوشتن گرفت)؛ خواندن هر عضوِ همان مدرسه (اعضایِ
 * کلاسِ مربوطه هم چون همگی عضوِ همان مدرسه‌اند، لیستِ کاملِ مدرسه را می‌بینند و
 * روی فرانت بر اساسِ classId فیلتر می‌کنند).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolProgramsTable, SCHOOL_MEMBER_ROLES } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_DEPUTY_DISCIPLINE } from "../lib/schoolAuth";

const router = Router();

function formatProgram(p: typeof schoolProgramsTable.$inferSelect) {
  return {
    id: p.id,
    schoolId: p.schoolId,
    classId: p.classId,
    title: p.title,
    description: p.description,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    createdByUserId: p.createdByUserId,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/schools/:schoolId/programs", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolProgramsTable).where(eq(schoolProgramsTable.schoolId, req.params.schoolId));
    res.json(rows.map(formatProgram));
  } catch (err) {
    logger.error({ err }, "List school programs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/schools/:schoolId/programs", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_DEPUTY_DISCIPLINE);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { title, description, classId, dayOfWeek, startTime, endTime } = req.body ?? {};
    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const [row] = await db.insert(schoolProgramsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      classId: classId ?? null,
      title: title.trim(),
      description: description ?? null,
      dayOfWeek: dayOfWeek ?? null,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json(formatProgram(row));
  } catch (err) {
    logger.error({ err }, "Create school program error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/schools/:schoolId/programs/:programId", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_DEPUTY_DISCIPLINE);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { title, description, classId, dayOfWeek, startTime, endTime } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (classId !== undefined) patch.classId = classId;
    if (dayOfWeek !== undefined) patch.dayOfWeek = dayOfWeek;
    if (startTime !== undefined) patch.startTime = startTime;
    if (endTime !== undefined) patch.endTime = endTime;
    const [row] = await db.update(schoolProgramsTable).set(patch)
      .where(and(eq(schoolProgramsTable.id, req.params.programId), eq(schoolProgramsTable.schoolId, req.params.schoolId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatProgram(row));
  } catch (err) {
    logger.error({ err }, "Update school program error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/schools/:schoolId/programs/:programId", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_DEPUTY_DISCIPLINE);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(schoolProgramsTable).where(and(eq(schoolProgramsTable.id, req.params.programId), eq(schoolProgramsTable.schoolId, req.params.schoolId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school program error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
