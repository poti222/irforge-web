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
  db, schoolAttendanceTable, schoolClassMembersTable, schoolMembersTable, schoolGuardianshipsTable, usersTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";

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
router.post("/schools/:schoolId/attendance", requireAuth, async (req: any, res) => {
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
    const isAbsentLike = (s: string) => s === "absent" || s === "late";

    // فازِ ۸: بجایِ اعتماد به وضعیتِ تازه‌ی هر ردیف، وضعیت/یادداشتِ قبلی را هم
    // نگه می‌داریم تا سه حالت را از هم تشخیص دهیم — نشانه‌گذاریِ اولیه‌ی غیبت،
    // بازگشتِ دانش‌آموز (غیبت→حاضر)، یا صرفاً افزودن/ویرایشِ دلیل روی همان
    // غیبتِ قبلاً اطلاع‌رسانی‌شده. اگر فقط به payloadِ ورودی تکیه کنیم (بدونِ
    // خواندنِ ردیفِ موجود) نمی‌توانیم این‌ها را از هم تشخیص دهیم و یا اعلانِ
    // غیبت را برایِ هر ویرایش دوباره می‌فرستیم (اسپم) یا اصلاً اعلانِ بازگشت
    // را نمی‌فرستیم.
    const results: (typeof schoolAttendanceTable.$inferSelect)[] = [];
    const newAbsences: (typeof schoolAttendanceTable.$inferSelect)[] = [];
    const arrivals: (typeof schoolAttendanceTable.$inferSelect)[] = [];
    const reasonAdded: (typeof schoolAttendanceTable.$inferSelect)[] = [];
    for (const entry of entries) {
      const studentMemberId = entry?.studentMemberId;
      const status = ["present", "absent", "late", "excused"].includes(entry?.status) ? entry.status : "present";
      const newNote = entry?.note ?? null;
      if (!studentMemberId) continue;
      const [existing] = await db.select().from(schoolAttendanceTable)
        .where(and(eq(schoolAttendanceTable.classId, classId), eq(schoolAttendanceTable.studentMemberId, studentMemberId), eq(schoolAttendanceTable.date, date)))
        .limit(1);
      const oldStatus = existing?.status ?? null;
      const oldNote = existing?.note ?? null;
      let row;
      if (existing) {
        [row] = await db.update(schoolAttendanceTable)
          .set({ status, note: newNote, markedByUserId: req.userId })
          .where(eq(schoolAttendanceTable.id, existing.id))
          .returning();
      } else {
        [row] = await db.insert(schoolAttendanceTable).values({
          id: crypto.randomUUID(),
          classId,
          studentMemberId,
          date,
          status,
          note: newNote,
          markedByUserId: req.userId,
        }).returning();
      }
      results.push(row);

      const wasAbsentLike = oldStatus !== null && isAbsentLike(oldStatus);
      const nowAbsentLike = isAbsentLike(status);
      if (!wasAbsentLike && nowAbsentLike) {
        // ردیفِ تازه یا ردیفی که تازه از «حاضر» به «غایب/دیر» تغییر کرده — اولین بارِ گزارشِ این غیبت.
        newAbsences.push(row);
      } else if (wasAbsentLike && !nowAbsentLike) {
        // از غایب/دیر به حاضر — «فرزندتان امروز حاضر شد» (اعلانِ اطمینان‌بخشِ جبرانی).
        arrivals.push(row);
      } else if (wasAbsentLike && nowAbsentLike && oldNote !== newNote && newNote) {
        // همچنان غایب/دیر مانده، فقط دلیل/یادداشت اضافه یا عوض شده — نه دوباره اعلانِ «غایب بود»
        // (که برایِ والد تکراری و آزاردهنده است)، بلکه فقط اعلانِ کوچکِ «دلیل ثبت شد».
        reasonAdded.push(row);
      }
      // بقیه‌ی حالت‌ها (حاضر مانده، یا حاضر مانده با تغییرِ یادداشت) عمداً اعلانی ندارند.
    }

    // فازِ ۷ (بخشِ C) + فازِ ۸: اعلان‌هایِ غیبت/بازگشت/دلیل — فقط به والدینِ همان
    // دانش‌آموز (school_guardianships). عمداً «فرزندتان» خنثی است نه پسر/دختر:
    // این سیستم جنسیتِ دانش‌آموز را برای هر خانواده‌ای مطمئن نمی‌داند، پس حدسِ
    // اشتباه بهتر است اصلاً زده نشود.
    const notifyRows = [...newAbsences, ...arrivals, ...reasonAdded];
    if (notifyRows.length > 0) {
      const studentIds = [...new Set(notifyRows.map((r) => r.studentMemberId))];
      const [students, links] = await Promise.all([
        db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, studentIds)),
        db.select().from(schoolGuardianshipsTable).where(inArray(schoolGuardianshipsTable.studentMemberId, studentIds)),
      ]);
      const studentUserIds = students.map((s: typeof students[number]) => s.userId);
      const studentUsers = studentUserIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, studentUserIds)) : [];
      const nameByMemberId = new Map(students.map((s: typeof students[number]) => {
        const u = studentUsers.find((x: typeof studentUsers[number]) => x.id === s.userId);
        return [s.id, u?.name ?? "دانش‌آموز"];
      }));
      const guardiansByStudent = new Map<string, string[]>();
      for (const l of links as typeof links) {
        const arr = guardiansByStudent.get(l.studentMemberId) ?? [];
        arr.push(l.parentUserId);
        guardiansByStudent.set(l.studentMemberId, arr);
      }

      for (const row of newAbsences) {
        const parentIds = guardiansByStudent.get(row.studentMemberId);
        if (!parentIds || parentIds.length === 0) continue;
        const statusFa = row.status === "absent" ? "غایب" : "دیر حاضر";
        const name = nameByMemberId.get(row.studentMemberId);
        await notifySchoolUsers({
          userIds: parentIds,
          schoolId: req.params.schoolId,
          kind: "school_attendance_absent",
          severity: row.status === "absent" ? "warning" : "info",
          title: `${statusFa}یِ امروزِ فرزندتان`,
          body: `فرزندتان (${name}) امروز (${row.date}) ${statusFa} بود.` + (row.note ? ` دلیل: ${row.note}` : ""),
        });
      }

      for (const row of arrivals) {
        const parentIds = guardiansByStudent.get(row.studentMemberId);
        if (!parentIds || parentIds.length === 0) continue;
        const name = nameByMemberId.get(row.studentMemberId);
        await notifySchoolUsers({
          userIds: parentIds,
          schoolId: req.params.schoolId,
          kind: "school_attendance_arrived",
          severity: "info",
          title: `حضورِ فرزندتان در مدرسه`,
          body: `فرزندتان (${name}) امروز (${row.date}) در مدرسه حاضر شد.` + (row.note ? ` دلیل: ${row.note}` : ""),
        });
      }

      for (const row of reasonAdded) {
        const parentIds = guardiansByStudent.get(row.studentMemberId);
        if (!parentIds || parentIds.length === 0) continue;
        const name = nameByMemberId.get(row.studentMemberId);
        await notifySchoolUsers({
          userIds: parentIds,
          schoolId: req.params.schoolId,
          kind: "school_attendance_reason_added",
          severity: "info",
          title: `دلیلِ غیبتِ فرزندتان ثبت شد`,
          body: `دلیلِ غیبتِ امروزِ فرزندتان (${name}) ثبت شد: ${row.note}`,
        });
      }
    }

    res.status(200).json(results.map(formatAttendance));
  } catch (err) {
    logger.error({ err }, "Mark attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/attendance?classId=&date=&from=&to= — معلمِ همان کلاس یا مدیر/معاون/معاونِ‌انضباطی.
router.get("/schools/:schoolId/attendance", requireAuth, async (req: any, res) => {
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
router.get("/schools/:schoolId/attendance/my", requireAuth, async (req: any, res) => {
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
router.get("/schools/:schoolId/attendance/child/:studentMemberId", requireAuth, async (req: any, res) => {
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
