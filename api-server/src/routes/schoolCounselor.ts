/**
 * routes/schoolCounselor.ts — بخش "/schools" فاز ۲: لیستِ دانش‌آموزانِ مشاور
 * + یادداشتِ محرمانه رویِ هر دانش‌آموز. فقط role="counselor"/"admin" از همان
 * مدرسه — دانش‌آموز/والد/معلم هرگز به این مسیرها دسترسی ندارند.
 *
 * فاز ۴ (بندِ ۱) به همین فایل اضافه شد: برنامه‌ی هفتگیِ مشاور (رویِ همان
 * جدولِ school_programs، ببینید توضیحِ counselorUserId در schema/schoolPrograms.ts)
 * و چتِ یک‌به‌یکِ مشاور↔دانش‌آموز.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolMembersTable, schoolCounselorNotesTable, schoolProgramsTable, schoolCounselorMessagesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, getSchoolMember } from "../lib/schoolAuth";

const router = Router();

async function requireCounselor(req: any, res: any, schoolId: string) {
  const { ok, member } = await canAccessSchool(req.userId, schoolId, ["counselor", "admin"]);
  if (!ok) {
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

// GET /api/schools/:schoolId/counselor/list — هر عضوِ مدرسه (برایِ دانش‌آموز:
// انتخابِ مشاور برایِ شروعِ چت). فهرستِ عمومی (نام هنوز نداریم، فقط userId).
router.get("/api/schools/:schoolId/counselor/list", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.schoolId, req.params.schoolId), eq(schoolMembersTable.role, "counselor")));
    res.json(rows.map((m: typeof rows[number]) => ({ userId: m.userId })));
  } catch (err) {
    logger.error({ err }, "List school counselors error");
    res.status(500).json({ error: "Internal server error" });
  }
});

function formatScheduleSlot(p: typeof schoolProgramsTable.$inferSelect) {
  return {
    id: p.id,
    schoolId: p.schoolId,
    counselorUserId: p.counselorUserId,
    title: p.title,
    description: p.description,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET /api/schools/:schoolId/counselor/schedule?counselorUserId= — هر عضوِ
// مدرسه (دانش‌آموز هم باید ببیند مشاور کِی دردسترس است)؛ counselorUserId
// اختیاری است (نبودش یعنی برنامه‌ی همه‌یِ مشاورانِ مدرسه).
router.get("/api/schools/:schoolId/counselor/schedule", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, [
      "admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent",
    ]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const counselorUserId = typeof req.query.counselorUserId === "string" ? req.query.counselorUserId : undefined;
    const rows = await db.select().from(schoolProgramsTable).where(
      counselorUserId
        ? and(eq(schoolProgramsTable.schoolId, req.params.schoolId), eq(schoolProgramsTable.counselorUserId, counselorUserId))
        : eq(schoolProgramsTable.schoolId, req.params.schoolId),
    );
    const slots = rows.filter((p: typeof rows[number]) => !!p.counselorUserId);
    res.json(slots.map(formatScheduleSlot));
  } catch (err) {
    logger.error({ err }, "List counselor schedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/counselor/schedule — فقط خودِ مشاور برایِ خودش می‌سازد.
router.post("/api/schools/:schoolId/counselor/schedule", requireAuth, async (req: any, res) => {
  try {
    const ok = await requireCounselor(req, res, req.params.schoolId);
    if (!ok) return;
    const { dayOfWeek, startTime, endTime, note } = req.body ?? {};
    if (!dayOfWeek || !startTime || !endTime) {
      res.status(400).json({ error: "dayOfWeek, startTime and endTime are required" });
      return;
    }
    const [row] = await db.insert(schoolProgramsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      classId: null,
      title: note?.trim() || "زنگِ مشاوره",
      description: note ?? null,
      dayOfWeek,
      startTime,
      endTime,
      counselorUserId: req.userId,
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json(formatScheduleSlot(row));
  } catch (err) {
    logger.error({ err }, "Create counselor schedule slot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/counselor/schedule/:id — فقط همان مشاور (یا مدیر).
router.delete("/api/schools/:schoolId/counselor/schedule/:id", requireAuth, async (req: any, res) => {
  try {
    const { ok: isAdmin } = await canAccessSchool(req.userId, req.params.schoolId, ["admin"]);
    const [row] = await db.select().from(schoolProgramsTable).where(eq(schoolProgramsTable.id, req.params.id)).limit(1);
    if (!row || row.schoolId !== req.params.schoolId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!isAdmin && row.counselorUserId !== req.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(schoolProgramsTable).where(eq(schoolProgramsTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete counselor schedule slot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

function formatMessage(m: typeof schoolCounselorMessagesTable.$inferSelect) {
  return {
    id: m.id,
    schoolId: m.schoolId,
    counselorUserId: m.counselorUserId,
    studentMemberId: m.studentMemberId,
    senderUserId: m.senderUserId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * دسترسیِ یک جفتِ (counselorUserId, studentMemberId): یا خودِ همان مشاور، یا
 * دانش‌آموزی که studentMemberId متعلق به خودش است. عمداً مدیر را رد نکردیم/
 * نپذیرفتیم به‌طورِ خاص — طبقِ تصمیمِ بریفِ فازِ ۴، این یک گفتگوی مشاوره‌ایست و
 * پیشفرض حتی مدیر هم نمی‌بیند.
 */
async function canAccessThread(req: any, res: any, schoolId: string, counselorUserId: string, studentMemberId: string) {
  const member = await getSchoolMember(req.userId);
  if (req.userId === counselorUserId) {
    const { ok } = await canAccessSchool(req.userId, schoolId, ["counselor"]);
    if (ok) return member;
  }
  if (member && member.schoolId === schoolId && member.id === studentMemberId && member.role === "student") {
    return member;
  }
  res.status(403).json({ error: "Forbidden" });
  return null;
}

// GET /api/schools/:schoolId/counselor/messages?counselorUserId=&studentMemberId=
router.get("/api/schools/:schoolId/counselor/messages", requireAuth, async (req: any, res) => {
  try {
    const { counselorUserId, studentMemberId } = req.query ?? {};
    if (typeof counselorUserId !== "string" || typeof studentMemberId !== "string") {
      res.status(400).json({ error: "counselorUserId and studentMemberId are required" });
      return;
    }
    const ok = await canAccessThread(req, res, req.params.schoolId, counselorUserId, studentMemberId);
    if (!ok) return;
    const rows = await db.select().from(schoolCounselorMessagesTable).where(and(
      eq(schoolCounselorMessagesTable.schoolId, req.params.schoolId),
      eq(schoolCounselorMessagesTable.counselorUserId, counselorUserId),
      eq(schoolCounselorMessagesTable.studentMemberId, studentMemberId),
    ));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => a.createdAt.getTime() - b.createdAt.getTime());
    res.json(rows.map(formatMessage));
  } catch (err) {
    logger.error({ err }, "List counselor messages error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/counselor/messages
router.post("/api/schools/:schoolId/counselor/messages", requireAuth, async (req: any, res) => {
  try {
    const { counselorUserId, studentMemberId, body } = req.body ?? {};
    if (typeof counselorUserId !== "string" || typeof studentMemberId !== "string" || !body?.trim()) {
      res.status(400).json({ error: "counselorUserId, studentMemberId and body are required" });
      return;
    }
    const ok = await canAccessThread(req, res, req.params.schoolId, counselorUserId, studentMemberId);
    if (!ok) return;
    const [row] = await db.insert(schoolCounselorMessagesTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      counselorUserId,
      studentMemberId,
      senderUserId: req.userId,
      body: body.trim(),
    }).returning();
    res.status(201).json(formatMessage(row));
  } catch (err) {
    logger.error({ err }, "Send counselor message error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
