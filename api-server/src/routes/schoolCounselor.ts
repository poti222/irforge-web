/**
 * routes/schoolCounselor.ts — بخش "/schools" فاز ۲: لیستِ دانش‌آموزانِ مشاور
 * + یادداشتِ محرمانه رویِ هر دانش‌آموز. فقط role="counselor"/"admin" از همان
 * مدرسه — دانش‌آموز/والد/معلم هرگز به این مسیرها دسترسی ندارند.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolMembersTable, schoolCounselorNotesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";

const router = Router();

async function requireCounselor(req: any, res: any, schoolId: string) {
  const [member] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, req.userId)).limit(1);
  if (!member || member.schoolId !== schoolId || !["counselor", "admin"].includes(member.role ?? "")) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return member;
}

// GET /api/schools/:schoolId/counselor/students — دانش‌آموزانِ همان مدرسه.
router.get("/api/schools/:schoolId/counselor/students", requireAuth, async (req: any, res) => {
  try {
    const ok = await requireCounselor(req, res, req.params.schoolId);
    if (!ok) return;
    const rows = await db.select().from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.schoolId, req.params.schoolId), eq(schoolMembersTable.role, "student")));
    res.json(rows.map((m: typeof rows[number]) => ({ id: m.id, userId: m.userId, grade: m.grade, city: m.city })));
  } catch (err) {
    logger.error({ err }, "List counselor students error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/counselor/students/:studentMemberId/notes
router.get("/api/schools/:schoolId/counselor/students/:studentMemberId/notes", requireAuth, async (req: any, res) => {
  try {
    const ok = await requireCounselor(req, res, req.params.schoolId);
    if (!ok) return;
    const rows = await db.select().from(schoolCounselorNotesTable)
      .where(eq(schoolCounselorNotesTable.studentMemberId, req.params.studentMemberId));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map((n: typeof rows[number]) => ({ id: n.id, counselorUserId: n.counselorUserId, studentMemberId: n.studentMemberId, note: n.note, createdAt: n.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "List counselor notes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/counselor/students/:studentMemberId/notes
router.post("/api/schools/:schoolId/counselor/students/:studentMemberId/notes", requireAuth, async (req: any, res) => {
  try {
    const ok = await requireCounselor(req, res, req.params.schoolId);
    if (!ok) return;
    const { note } = req.body ?? {};
    if (!note?.trim()) {
      res.status(400).json({ error: "note is required" });
      return;
    }
    const [row] = await db.insert(schoolCounselorNotesTable).values({
      id: crypto.randomUUID(),
      counselorUserId: req.userId,
      studentMemberId: req.params.studentMemberId,
      note: note.trim(),
    }).returning();
    res.status(201).json({ id: row.id, counselorUserId: row.counselorUserId, studentMemberId: row.studentMemberId, note: row.note, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "Create counselor note error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
