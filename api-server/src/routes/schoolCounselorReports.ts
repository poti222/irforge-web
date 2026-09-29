/**
 * routes/schoolCounselorReports.ts — بخش "/schools" فاز ۴ (بندِ ۱): گزارشِ
 * مشاور که برخلافِ یادداشتِ محرمانه (schoolCounselor.ts) مدیر/معاونِ همان
 * مدرسه هم می‌بیند. ساختنِ گزارش: فقط مشاور. دیدن: مشاور فقط گزارش‌هایِ
 * خودش، مدیر/معاون همه‌یِ گزارش‌هایِ مدرسه.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolCounselorReportsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool } from "../lib/schoolAuth";

const router = Router();

function formatReport(r: typeof schoolCounselorReportsTable.$inferSelect) {
  return {
    id: r.id,
    schoolId: r.schoolId,
    counselorUserId: r.counselorUserId,
    studentMemberId: r.studentMemberId,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  };
}

// GET /api/schools/:schoolId/counselor/reports — مشاور: فقط خودش. مدیر/معاون: همه.
router.get("/api/schools/:schoolId/counselor/reports", requireAuth, async (req: any, res) => {
  try {
    const { ok, member } = await canAccessSchool(req.userId, req.params.schoolId, ["counselor", "admin", "deputy"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const isCounselorOnly = member?.role === "counselor";
    const rows = isCounselorOnly
      ? await db.select().from(schoolCounselorReportsTable)
          .where(and(eq(schoolCounselorReportsTable.schoolId, req.params.schoolId), eq(schoolCounselorReportsTable.counselorUserId, req.userId)))
      : await db.select().from(schoolCounselorReportsTable).where(eq(schoolCounselorReportsTable.schoolId, req.params.schoolId));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatReport));
  } catch (err) {
    logger.error({ err }, "List counselor reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/counselor/reports — فقط مشاور.
router.post("/api/schools/:schoolId/counselor/reports", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["counselor"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { title, body, studentMemberId } = req.body ?? {};
    if (!title?.trim() || !body?.trim()) {
      res.status(400).json({ error: "title and body are required" });
      return;
    }
    const [row] = await db.insert(schoolCounselorReportsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      counselorUserId: req.userId,
      studentMemberId: studentMemberId ?? null,
      title: title.trim(),
      body: body.trim(),
    }).returning();
    res.status(201).json(formatReport(row));
  } catch (err) {
    logger.error({ err }, "Create counselor report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
