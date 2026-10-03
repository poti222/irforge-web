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
  db, schoolAttendanceTable, schoolClassMembersTable, schoolMembersTable, schoolGuardianshipsTable, usersTable, schoolsTable,
} from "@workspace/db";
import { eq, and, gte, lte, lt, inArray, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";
import { issueSchoolStudentAlert } from "./schoolStudentAlerts";

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

const isAbsentLikeStatus = (s: string) => s === "absent" || s === "late";

/**
 * فازِ ۱۰ (بندِ ۱.۳): طولِ رشته‌ی غیبت/دیرحضورِ پیاپیِ یک دانش‌آموز در یک کلاس،
 * تا و شاملِ `uptoDate`. تصمیم: «پیاپی» یعنی پیاپی در میانِ **ردیف‌هایِ
 * ثبت‌شده‌یِ واقعی** (مرتب بر اساسِ تاریخ، نزولی) — نه روزهایِ تقویمی؛ وگرنه
 * هر آخرهفته/تعطیلیِ ثبت‌نشده رشته را قطع می‌کرد که برایِ یک مدرسه‌ی واقعی
 * بی‌معنا است. اولین ردیفِ «حاضر» رشته را متوقف می‌کند.
 */
async function consecutiveAbsenceStreak(classId: string, studentMemberId: string, uptoDate: string): Promise<number> {
  const rows = await db.select().from(schoolAttendanceTable)
    .where(and(
      eq(schoolAttendanceTable.classId, classId),
      eq(schoolAttendanceTable.studentMemberId, studentMemberId),
      lte(schoolAttendanceTable.date, uptoDate),
    ));
  rows.sort((a: typeof rows[number], b: typeof rows[number]) => (a.date < b.date ? 1 : -1));
  let streak = 0;
  for (const r of rows) {
    if (isAbsentLikeStatus(r.status)) streak++;
    else break;
  }
  return streak;
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
    const isAbsentLike = isAbsentLikeStatus;

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

    // فازِ ۱۰ (بندِ ۱.۳): اخطارِ خودکارِ «غیبتِ پیاپی» — روی هر ردیفی که بعدِ
    // این درخواست غایب/دیرحاضر ماند (نه فقط newAbsences، چون یک روزِ میانیِ
    // یک رشته‌یِ قبلاً شروع‌شده هم باید چک شود)، طولِ رشته را از همین تاریخ به
    // عقب می‌شماریم. برایِ این‌که این اخطار دوباره‌و‌دوباره برایِ همان رشته
    // صادر نشود، فقط دقیقاً در لحظه‌ی «عبور از آستانه» (streak === threshold)
    // صادر می‌شود، نه هر روزی که streak >= threshold بماند.
    const stillAbsentRows = results.filter((r) => isAbsentLike(r.status));
    if (stillAbsentRows.length > 0) {
      const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, req.params.schoolId)).limit(1);
      const threshold = school?.consecutiveAbsenceAlertThreshold ?? 3;
      if (threshold > 0) {
        for (const row of stillAbsentRows) {
          const streak = await consecutiveAbsenceStreak(classId, row.studentMemberId, row.date);
          if (streak !== threshold) continue;
          const [studentMember] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.id, row.studentMemberId)).limit(1);
          const studentUser = studentMember ? (await db.select().from(usersTable).where(eq(usersTable.id, studentMember.userId)).limit(1))[0] : undefined;
          const name = studentUser?.name ?? "دانش‌آموز";
          await issueSchoolStudentAlert({
            schoolId: req.params.schoolId,
            studentMemberId: row.studentMemberId,
            issuedByUserId: req.userId,
            severity: "warning",
            title: `غیبتِ پیاپیِ ${name}`,
            body: `${name} به‌مدتِ ${streak} روزِ پیاپی غایب/دیرحاضر بوده است (آخرین روز: ${row.date}).`,
          });
        }
      }
    }

    res.status(200).json(results.map(formatAttendance));
  } catch (err) {
    logger.error({ err }, "Mark attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/attendance/previous-date?classId=&before= — نزدیک‌ترین تاریخِ ثبت‌شده‌ی قبل از `before` برای این کلاس؛
// برایِ دکمه‌ی «کپی از روز قبل» در فرانت (معلم همان تاریخ را به‌عنوانِ پیش‌فرضِ وضعیت/یادداشتِ امروز می‌گیرد، نه ارسالِ خودکار).
router.get("/schools/:schoolId/attendance/previous-date", requireAuth, async (req: any, res) => {
  try {
    const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
    const before = typeof req.query.before === "string" ? req.query.before : undefined;
    if (!classId || !before) {
      res.status(400).json({ error: "classId and before are required" });
      return;
    }
    const { ok } = await canMarkClass(req.userId, req.params.schoolId, classId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.select({ date: schoolAttendanceTable.date }).from(schoolAttendanceTable)
      .where(and(eq(schoolAttendanceTable.classId, classId), lt(schoolAttendanceTable.date, before)))
      .orderBy(desc(schoolAttendanceTable.date))
      .limit(1);
    res.json(row ? { date: row.date } : null);
  } catch (err) {
    logger.error({ err }, "Get previous attendance date error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/attendance/export?classId=&from=&to= — خروجیِ CSV (نام دانش‌آموز، تاریخ، وضعیت، یادداشت).
// معلمِ همان کلاس یا مدیر/معاون/معاونِ‌انضباطی — دقیقاً همان مجوزِ GET لیستِ معمولی.
router.get("/schools/:schoolId/attendance/export", requireAuth, async (req: any, res) => {
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
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (from) conditions.push(gte(schoolAttendanceTable.date, from));
    if (to) conditions.push(lte(schoolAttendanceTable.date, to));
    const rows = await db.select().from(schoolAttendanceTable).where(and(...conditions));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => (a.date < b.date ? -1 : 1));

    const memberIds = [...new Set(rows.map((r: typeof rows[number]) => r.studentMemberId))];
    const members = memberIds.length ? await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, memberIds)) : [];
    const userIds = members.map((m: typeof members[number]) => m.userId);
    const users = userIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const nameByMemberId = new Map(members.map((m: typeof members[number]) => {
      const u = users.find((x: typeof users[number]) => x.id === m.userId);
      return [m.id, u?.name ?? u?.email ?? m.id];
    }));

    // اسکیپِ استانداردِ CSV: اگر مقدار شاملِ کاما/گیومه/خطِ‌جدید باشد، داخلِ
    // گیومه می‌رود و خودِ گیومه‌ها دوبرابر می‌شوند — وگرنه یادداشتی مثلِ
    // `"سرماخوردگی، تب بالا"` خودِ فایلِ CSV را خراب می‌کند.
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ["student", "date", "status", "note"].join(",");
    const lines = rows.map((r: typeof rows[number]) => [
      esc(nameByMemberId.get(r.studentMemberId) ?? r.studentMemberId),
      r.date,
      r.status,
      esc(r.note ?? ""),
    ].join(","));
    const csv = "﻿" + [header, ...lines].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${classId}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    logger.error({ err }, "Export attendance CSV error");
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
