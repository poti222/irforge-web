/**
 * routes/schoolNotificationTriggers.ts — بخش "/schools" فاز ۷ (بخش C):
 * دو تریگرِ اعلانی که نیاز به یک «زمان‌بندِ دوره‌ای» دارند، ولی این ریپو
 * cron/scheduled-job ندارد (دقیقاً همان توضیحِ بالایِ schema/notifications.ts:
 * «چون سرور cron/scheduled job ندارد، این ردیف‌ها به‌صورت lazy تولید
 * می‌شوند»؛ migrate.mjs's cleanupExpired هم فقط روی هر بوت اجرا می‌شود، نه
 * یک زمان‌بندِ واقعی). به‌جایِ ساختنِ یک سیستمِ جاب-اسکجولینگِ تازه (خارج از
 * دامنه‌ی این فاز)، هر دو به‌صورتِ **درخواستیِ ادمین** پیاده شده‌اند:
 *
 *   ۱) «بررسیِ حضور و غیابِ ثبت‌نشده» — دکمه‌ای در داشبوردِ مدیر که همین
 *      الان چک می‌کند کدام کلاس‌ها امروز هیچ ردیفِ school_attendance ندارند،
 *      و به admin/deputy/deputy_discipline همان مدرسه اعلان می‌فرستد.
 *   ۲) «خلاصه‌یِ غیبتِ امروز» — یک شمارشِ ساده (GET)، برایِ کارتِ داشبوردِ
 *      مدیر (pages/schools/admin/index.tsx) — نه پوش، چون آن هم به همان
 *      زمان‌بندِ دوره‌ای نیاز داشت.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolClassesTable, schoolAttendanceTable, schoolMembersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { canAccessSchool } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";
import { requireAuth } from "./auth";

const router = Router();

const ADMIN_LIKE_ROLES = ["admin", "deputy", "deputy_discipline"] as const;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/schools/:schoolId/admin/absence-summary?date= — شمارشِ غایب/دیرآمده‌یِ امروز، برایِ کارتِ داشبورد.
router.get("/schools/:schoolId/admin/absence-summary", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ADMIN_LIKE_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const date = typeof req.query.date === "string" ? req.query.date : todayDateString();
    const classes = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable)
      .where(eq(schoolClassesTable.schoolId, req.params.schoolId));
    const classIds = classes.map((c: typeof classes[number]) => c.id);
    if (classIds.length === 0) {
      res.json({ date, absent: 0, late: 0, classesTotal: 0 });
      return;
    }
    const rows = await db.select({ status: schoolAttendanceTable.status }).from(schoolAttendanceTable)
      .where(and(inArray(schoolAttendanceTable.classId, classIds), eq(schoolAttendanceTable.date, date)));
    res.json({
      date,
      absent: rows.filter((r: typeof rows[number]) => r.status === "absent").length,
      late: rows.filter((r: typeof rows[number]) => r.status === "late").length,
      classesTotal: classIds.length,
    });
  } catch (err) {
    logger.error({ err }, "Get school absence summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/admin/check-unmarked-attendance — دکمه‌یِ «بررسیِ حضور و غیابِ ثبت‌نشده».
router.post("/schools/:schoolId/admin/check-unmarked-attendance", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ADMIN_LIKE_ROLES);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const schoolId = req.params.schoolId;
    const date = todayDateString();

    const classes = await db.select().from(schoolClassesTable).where(eq(schoolClassesTable.schoolId, schoolId));
    if (classes.length === 0) {
      res.json({ date, unmarkedClasses: [] });
      return;
    }
    const classIds = classes.map((c: typeof classes[number]) => c.id);
    const markedRows = await db.select({ classId: schoolAttendanceTable.classId }).from(schoolAttendanceTable)
      .where(and(inArray(schoolAttendanceTable.classId, classIds), eq(schoolAttendanceTable.date, date)));
    const markedClassIds = new Set(markedRows.map((r: typeof markedRows[number]) => r.classId));
    const unmarked = classes.filter((c: typeof classes[number]) => !markedClassIds.has(c.id));

    if (unmarked.length > 0) {
      const admins = await db.select({ userId: schoolMembersTable.userId }).from(schoolMembersTable)
        .where(and(eq(schoolMembersTable.schoolId, schoolId), inArray(schoolMembersTable.role, ADMIN_LIKE_ROLES as unknown as string[])));
      const adminUserIds = [...new Set(admins.map((a: typeof admins[number]) => a.userId))];
      if (adminUserIds.length > 0) {
        const names = unmarked.map((c: typeof unmarked[number]) => c.name).join("، ");
        await notifySchoolUsers({
          userIds: adminUserIds,
          schoolId,
          kind: "school_attendance_unmarked",
          severity: "warning",
          title: "حضور و غیابِ ثبت‌نشده",
          body: `کلاس‌هایِ زیر امروز هنوز حضور و غیاب ثبت نکرده‌اند: ${names}`,
        });
      }
    }

    res.json({ date, unmarkedClasses: unmarked.map((c: typeof unmarked[number]) => ({ id: c.id, name: c.name })) });
  } catch (err) {
    logger.error({ err }, "Check unmarked attendance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
