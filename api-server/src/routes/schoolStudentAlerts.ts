/**
 * routes/schoolStudentAlerts.ts — بخش "/schools" فاز ۶ (بندِ ۴): اخطار/هشدارِ
 * انضباطیِ دانش‌آموز. صدور: admin/deputy/deputy_discipline. دیدن: خودِ
 * دانش‌آموز، والدِ او (مرزِ حریمِ خصوصی با school_guardianships)، و
 * admin/deputy/deputy_discipline/counselor همان مدرسه.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolStudentAlertsTable, schoolMembersTable, schoolGuardianshipsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";

const router = Router();

const SEVERITIES = ["notice", "warning", "serious"] as const;

function formatAlert(a: typeof schoolStudentAlertsTable.$inferSelect) {
  return {
    id: a.id,
    schoolId: a.schoolId,
    studentMemberId: a.studentMemberId,
    issuedByUserId: a.issuedByUserId,
    severity: a.severity,
    title: a.title,
    body: a.body,
    createdAt: a.createdAt.toISOString(),
  };
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

async function isGuardianOf(parentUserId: string, studentMemberId: string) {
  const [row] = await db.select().from(schoolGuardianshipsTable)
    .where(and(eq(schoolGuardianshipsTable.parentUserId, parentUserId), eq(schoolGuardianshipsTable.studentMemberId, studentMemberId)))
    .limit(1);
  return !!row;
}

// POST /api/schools/:schoolId/alerts — فقط admin/deputy/deputy_discipline.
router.post("/api/schools/:schoolId/alerts", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["admin", "deputy", "deputy_discipline"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { studentMemberId, severity, title, body } = req.body ?? {};
    if (!studentMemberId?.trim() || !title?.trim() || !body?.trim()) {
      res.status(400).json({ error: "studentMemberId, title and body are required" });
      return;
    }
    const [row] = await db.insert(schoolStudentAlertsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      studentMemberId: studentMemberId.trim(),
      issuedByUserId: req.userId,
      severity: SEVERITIES.includes(severity) ? severity : "notice",
      title: title.trim(),
      body: body.trim(),
    }).returning();

    // فازِ ۷ (بخشِ C): خودِ دانش‌آموز + والدینِ او — درخواستِ صریحِ کاربر
    // («اخطار/هشدارِ فرزند»). severity مدرسه به severity اعلانِ سایت هم
    // نگاشت می‌شود (notice→info، warning→warning، serious→critical).
    const [studentMember] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.id, row.studentMemberId)).limit(1);
    const guardianRows = await db.select().from(schoolGuardianshipsTable).where(eq(schoolGuardianshipsTable.studentMemberId, row.studentMemberId));
    const recipientUserIds = [
      ...(studentMember ? [studentMember.userId] : []),
      ...guardianRows.map((g: typeof guardianRows[number]) => g.parentUserId),
    ];
    if (recipientUserIds.length > 0) {
      await notifySchoolUsers({
        userIds: [...new Set(recipientUserIds)],
        schoolId: req.params.schoolId,
        kind: "school_student_alert",
        severity: row.severity === "serious" ? "critical" : row.severity === "warning" ? "warning" : "info",
        title: row.title,
        body: row.body,
      });
    }

    res.status(201).json(formatAlert(row));
  } catch (err) {
    logger.error({ err }, "Create student alert error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/alerts?studentMemberId= — مدیر/معاون/معاونِ‌انضباطی/مشاور: همه یا فیلترشده با studentMemberId.
router.get("/api/schools/:schoolId/alerts", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["admin", "deputy", "deputy_discipline", "counselor"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const studentMemberId = typeof req.query.studentMemberId === "string" ? req.query.studentMemberId : undefined;
    const conditions = [eq(schoolStudentAlertsTable.schoolId, req.params.schoolId)];
    if (studentMemberId) conditions.push(eq(schoolStudentAlertsTable.studentMemberId, studentMemberId));
    const rows = await db.select().from(schoolStudentAlertsTable).where(and(...conditions));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatAlert));
  } catch (err) {
    logger.error({ err }, "List school alerts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/alerts/my — دانش‌آموز: اخطارهایِ خودش.
router.get("/api/schools/:schoolId/alerts/my", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolStudentAlertsTable)
      .where(and(eq(schoolStudentAlertsTable.schoolId, req.params.schoolId), eq(schoolStudentAlertsTable.studentMemberId, member.id)));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatAlert));
  } catch (err) {
    logger.error({ err }, "Get my alerts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/alerts/child/:studentMemberId — والد: فقط اخطارهایِ فرزندِ خودش.
router.get("/api/schools/:schoolId/alerts/child/:studentMemberId", requireAuth, async (req: any, res) => {
  try {
    if (!(await isGuardianOf(req.userId, req.params.studentMemberId))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolStudentAlertsTable)
      .where(and(eq(schoolStudentAlertsTable.schoolId, req.params.schoolId), eq(schoolStudentAlertsTable.studentMemberId, req.params.studentMemberId)));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatAlert));
  } catch (err) {
    logger.error({ err }, "Get child alerts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
