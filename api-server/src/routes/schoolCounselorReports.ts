/**
 * routes/schoolCounselorReports.ts — بخش "/schools" فاز ۴ (بندِ ۱): گزارشِ
 * مشاور که برخلافِ یادداشتِ محرمانه (schoolCounselor.ts) مدیر/معاونِ همان
 * مدرسه هم می‌بیند. ساختنِ گزارش: فقط مشاور. دیدن: مشاور فقط گزارش‌هایِ
 * خودش، مدیر/معاون همه‌یِ گزارش‌هایِ مدرسه.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolCounselorReportsTable, schoolGuardianshipsTable, schoolMembersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
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

/**
 * والدِ studentMemberIdهایِ فرزندانِ این کاربر در همین مدرسه — فازِ ۵ (بندِ ۲):
 * مرزِ حریمِ خصوصیِ والد. جدا از `canAccessSchool` است چون پیوندِ
 * والد↔دانش‌آموز در `school_guardianships` است نه `school_members`؛ حتی اگر
 * والد اصلاً عضوِ این مدرسه نباشد (فرزندش در یک مدرسه است، خودش شاید هیچ‌جا
 * ثبت‌نام نکرده)، همین پیوند کافی‌ست. هرگز studentMemberIdِ بیرون از این
 * مجموعه را برنمی‌گرداند.
 */
async function myChildrenMemberIdsInSchool(parentUserId: string, schoolId: string) {
  const links = await db.select().from(schoolGuardianshipsTable).where(eq(schoolGuardianshipsTable.parentUserId, parentUserId));
  if (links.length === 0) return [];
  const memberIds = links.map((l: typeof links[number]) => l.studentMemberId);
  const members = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, memberIds));
  return members.filter((m: typeof members[number]) => m.schoolId === schoolId).map((m: typeof members[number]) => m.id);
}

// GET /api/schools/:schoolId/counselor/reports — مشاور: فقط خودش. مدیر/معاون: همه.
// والد (فازِ ۵ بندِ ۲): فقط‌خواندنی، فقط گزارش‌هایِ خطاب‌به‌studentMemberIdِ
// فرزندِ خودش — هرگز گزارشِ عمومی/گزارشِ دانش‌آموزِ دیگر.
router.get("/schools/:schoolId/counselor/reports", requireAuth, async (req: any, res) => {
  try {
    const { ok, member } = await canAccessSchool(req.userId, req.params.schoolId, ["counselor", "admin", "deputy"]);
    if (ok) {
      const isCounselorOnly = member?.role === "counselor";
      const rows = isCounselorOnly
        ? await db.select().from(schoolCounselorReportsTable)
            .where(and(eq(schoolCounselorReportsTable.schoolId, req.params.schoolId), eq(schoolCounselorReportsTable.counselorUserId, req.userId)))
        : await db.select().from(schoolCounselorReportsTable).where(eq(schoolCounselorReportsTable.schoolId, req.params.schoolId));
      rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
      res.json(rows.map(formatReport));
      return;
    }

    const childIds = await myChildrenMemberIdsInSchool(req.userId, req.params.schoolId);
    if (childIds.length === 0) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolCounselorReportsTable)
      .where(and(eq(schoolCounselorReportsTable.schoolId, req.params.schoolId), inArray(schoolCounselorReportsTable.studentMemberId, childIds)));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatReport));
  } catch (err) {
    logger.error({ err }, "List counselor reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/counselor/reports — فقط مشاور.
router.post("/schools/:schoolId/counselor/reports", requireAuth, async (req: any, res) => {
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
