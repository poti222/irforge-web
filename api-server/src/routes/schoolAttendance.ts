/**
 * routes/schoolAttendance.ts — بخش "/schools" فاز ۶ (بندِ ۱): حضور و غیاب.
 * ─────────────────────────────────────────────────────────────────────────
 * نشانه‌گذاری: معلمِ همان کلاس یا admin/deputy/deputy_discipline — یک
 * endpointِ دسته‌جمعی (کلّ روسترِ یک روز در یک درخواست) طبقِ اسپکِ فاز، الگویِ
 * روسترِ کلاس از schoolClasses.ts/schoolAssignments.ts گرفته شده. هر ردیف
 * upsert می‌شود (ایندکسِ یکتایِ classId+studentMemberId+date). خواندن:
 * دانش‌آموز/والد فقط تاریخچه‌ی خودشان/فرزندشان؛ معلم/مدیر بازه‌ی یک کلاس.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolAttendanceTable, schoolClassMembersTable, schoolMembersTable, schoolGuardianshipsTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

function formatAttendance(a: typeof schoolAttendanceTable.$inferSelect) {
  return {
    id: a.id,
    classId: a.classId,
    studentMemberId: a.studentMemberId,
    date: a.date,
    status: a.status,
    markedByUserId: a.markedByUserId,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
  };
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/** معلمِ همین کلاس (roleInClass="teacher") یا مدیر/معاون/معاونِ‌انضباطیِ همین مدرسه — کپیِ الگویِ isClassTeacherOrAdmin با نقش‌هایِ بیشتر (طبقِ اسپکِ بندِ ۱). */
async function canMarkClass(userId: string, schoolId: string, classId: string) {
  const { ok: isAdminLike, member } = await canAccessSchool(userId, schoolId, ["admin", "deputy", "deputy_discipline"]);
  if (isAdminLike) return { ok: true, member };
  const plain = member ?? (await getMember(userId));
  if (!plain) return { ok: false, member: null };
  const [row] = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, plain.id), eq(schoolClassMembersTable.roleInClass, "teacher")))
    .limit(1);
  return { ok: !!row, member: plain };
}

/** والدِ studentMemberIdهایِ فرزندانِ این کاربر در همین مدرسه — عیناً همان الگویِ schoolCounselorReports.ts. */
async function myChildrenMemberIdsInSchool(parentUserId: string, schoolId: string) {
  const links = await db.select().from(schoolGuardianshipsTable).where(eq(schoolGuardianshipsTable.parentUserId, parentUserId));
  if (links.length === 0) return [];
  const memberIds = links.map((l: typeof links[number]) => l.studentMemberId);
  const members = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, memberIds));
  return members.filter((m: typeof members[number]) => m.schoolId === schoolId).map((m: typeof members[number]) => m.id);
}

// POST /api/schools/:schoolId/attendance — نشانه‌گذاریِ دسته‌جمعی: { classId, date, entries: [{studentMemberId, status, note?}] }
router.post("/api/schools/:schoolId/attendance", requireAuth, async (req: any, res) => {
  try {
    const { classId, date, entries } = req.body ?? {};
    if (!classId?.trim() || !date?.trim() || !Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "classId, date and at least one entry are required" });
      return;
    }
    const { ok } = await canMarkClass(req.userId, req.params.schoolId, classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const results: (typeof schoolAttendanceTable.$inferSelect)[] = [];
    for (const entry of entries) {
      const studentMemberId = entry?.studentMemberId;
      const status = ["present", "absent", "late", "excused"].includes(entry?.status) ? entry.status : "present";
      if (!studentMemberId) continue;
      const [existing] = await db.select().from(schoolAttendanceTable)
        .where(and(eq(schoolAttendanceTable.classId, classId), eq(schoolAttendanceTable.studentMemberId, studentMemberId), eq(schoolAttendanceTable.date, date)))
        .limit(1);
      let row;
      if (existing) {
        [row] = await db.update(schoolAttendanceTable)
          .set({ status, note: entry?.note ?? null, markedByUserId: req.userId })
          .where(eq(schoolAttendanceTable.id, existing.id))
          .returning();
      } else {
        [row] = await db.insert(schoolAttendanceTable).values({
          id: crypto.randomUUID(),
          classId,
          studentMemberId,
          date,
          status,
          note: entry?.note ?? null,
          markedByUserId: req.userId,
        }).returning();
      }
      results.push(row);
    }
    res.status(200).json(results.map(formatAttendance));
  } catch (err) {
    logger.error({ err }, "Mark attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/attendance?classId=&date=&from=&to= — معلمِ همان کلاس یا مدیر/معاون/معاونِ‌انضباطی.
router.get("/api/schools/:schoolId/attendance", requireAuth, async (req: any, res) => {
  try {
    const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
    if (!classId) {
      res.status(400).json({ error: "classId is required" });
      return;
    }
    const { ok } = await canMarkClass(req.userId, req.params.schoolId, classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const conditions = [eq(schoolAttendanceTable.classId, classId)];
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (date) conditions.push(eq(schoolAttendanceTable.date, date));
    if (from) conditions.push(gte(schoolAttendanceTable.date, from));
    if (to) conditions.push(lte(schoolAttendanceTable.date, to));
    const rows = await db.select().from(schoolAttendanceTable).where(and(...conditions));
    res.json(rows.map(formatAttendance));
  } catch (err) {
    logger.error({ err }, "List class attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/attendance/my?from=&to= — تاریخچه‌ی خودِ دانش‌آموز.
router.get("/api/schools/:schoolId/attendance/my", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const conditions = [eq(schoolAttendanceTable.studentMemberId, member.id)];
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (from) conditions.push(gte(schoolAttendanceTable.date, from));
    if (to) conditions.push(lte(schoolAttendanceTable.date, to));
    const rows = await db.select().from(schoolAttendanceTable).where(and(...conditions));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => (a.date < b.date ? 1 : -1));
    res.json(rows.map(formatAttendance));
  } catch (err) {
    logger.error({ err }, "Get my attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/attendance/child/:studentMemberId?from=&to= — والد: فقط تاریخچه‌ی فرزندِ خودش
// (مرزِ حریمِ خصوصی سمتِ سرور با school_guardianships — عیناً همان الگویِ
// myChildrenMemberIdsInSchool در schoolCounselorReports.ts).
router.get("/api/schools/:schoolId/attendance/child/:studentMemberId", requireAuth, async (req: any, res) => {
  try {
    const childIds = await myChildrenMemberIdsInSchool(req.userId, req.params.schoolId);
    if (!childIds.includes(req.params.studentMemberId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const conditions = [eq(schoolAttendanceTable.studentMemberId, req.params.studentMemberId)];
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (from) conditions.push(gte(schoolAttendanceTable.date, from));
    if (to) conditions.push(lte(schoolAttendanceTable.date, to));
    const rows = await db.select().from(schoolAttendanceTable).where(and(...conditions));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => (a.date < b.date ? 1 : -1));
    res.json(rows.map(formatAttendance));
  } catch (err) {
    logger.error({ err }, "Get child attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
