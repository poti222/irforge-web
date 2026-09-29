/**
 * routes/schoolTeacherMessages.ts — بخش "/schools" فاز ۵ (بندِ ۱): «ارتباط با
 * معلم». برخلافِ ارتباط با مدیر، این ۱:۱ و مشروط به رابطه‌ی واقعیِ کلاسی است:
 * دانش‌آموز فقط می‌تواند با معلمی گفتگو کند که واقعاً در یکی از کلاس‌هایِ
 * خودِ او تدریس می‌کند (روسترِ school_class_members، دقیقاً همان چیزی که
 * schoolAssignments.ts/schoolExams.ts برایِ isClassTeacherOrAdmin چک می‌کنند).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolTeacherMessagesTable, schoolMembersTable, schoolClassMembersTable, usersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, getSchoolMember } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";

const router = Router();

function formatMessage(m: typeof schoolTeacherMessagesTable.$inferSelect) {
  return {
    id: m.id,
    schoolId: m.schoolId,
    teacherUserId: m.teacherUserId,
    studentMemberId: m.studentMemberId,
    senderUserId: m.senderUserId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

/** کلاس‌هایی که این عضوِ مدرسه با نقشِ داده‌شده در آن‌هاست. */
async function classIdsForMember(schoolMemberId: string, roleInClass: "student" | "teacher") {
  const rows = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.schoolMemberId, schoolMemberId), eq(schoolClassMembersTable.roleInClass, roleInClass)));
  return rows.map((r: typeof rows[number]) => r.classId);
}

/** آیا این teacherUserId واقعاً سرِ حداقل یک کلاسِ مشترک با این دانش‌آموز است؟ */
async function isRealTeacherOfStudent(schoolId: string, teacherUserId: string, studentMemberId: string) {
  const [teacherMember] = await db.select().from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.userId, teacherUserId), eq(schoolMembersTable.schoolId, schoolId)))
    .limit(1);
  if (!teacherMember) return false;
  const teacherClassIds = await classIdsForMember(teacherMember.id, "teacher");
  if (teacherClassIds.length === 0) return false;
  const studentClassIds = await classIdsForMember(studentMemberId, "student");
  return studentClassIds.some((id: string) => teacherClassIds.includes(id));
}

async function canAccessThread(req: any, res: any, schoolId: string, teacherUserId: string, studentMemberId: string) {
  const member = await getSchoolMember(req.userId);
  if (req.userId === teacherUserId) {
    const { ok } = await canAccessSchool(req.userId, schoolId, ["teacher"]);
    if (ok && (await isRealTeacherOfStudent(schoolId, teacherUserId, studentMemberId))) return member;
  }
  if (member && member.schoolId === schoolId && member.id === studentMemberId && member.role === "student"
      && (await isRealTeacherOfStudent(schoolId, teacherUserId, studentMemberId))) {
    return member;
  }
  res.status(403).json({ error: "Forbidden" });
  return null;
}

// GET /api/schools/:schoolId/teacher-messages/my-teachers — دانش‌آموز: معلم‌هایِ واقعیِ کلاس‌هایِ خودش.
router.get("/api/schools/:schoolId/teacher-messages/my-teachers", requireAuth, async (req: any, res) => {
  try {
    const member = await getSchoolMember(req.userId);
    if (!member || member.schoolId !== req.params.schoolId || member.role !== "student") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const classIds = await classIdsForMember(member.id, "student");
    if (classIds.length === 0) {
      res.json([]);
      return;
    }
    const teacherRows = await db.select().from(schoolClassMembersTable)
      .where(and(inArray(schoolClassMembersTable.classId, classIds), eq(schoolClassMembersTable.roleInClass, "teacher")));
    const teacherMemberIds = [...new Set(teacherRows.map((r: typeof teacherRows[number]) => r.schoolMemberId))];
    if (teacherMemberIds.length === 0) {
      res.json([]);
      return;
    }
    const teacherMembers = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, teacherMemberIds));
    const userIds = teacherMembers.map((m: typeof teacherMembers[number]) => m.userId);
    const users = userIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const userMap = new Map(users.map((u: typeof users[number]) => [u.id, u]));
    res.json(teacherMembers.map((m: typeof teacherMembers[number]) => ({
      teacherUserId: m.userId,
      userName: userMap.get(m.userId)?.name ?? null,
      userEmail: userMap.get(m.userId)?.email ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "List my teachers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/teacher-messages/inbox — معلم: صندوقِ ورودی (رشته‌های دانش‌آموزانش).
router.get("/api/schools/:schoolId/teacher-messages/inbox", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["teacher"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolTeacherMessagesTable)
      .where(and(eq(schoolTeacherMessagesTable.schoolId, req.params.schoolId), eq(schoolTeacherMessagesTable.teacherUserId, req.userId)));
    const byStudent = new Map<string, typeof rows[number][]>();
    for (const m of rows) {
      const list = byStudent.get(m.studentMemberId) ?? [];
      list.push(m);
      byStudent.set(m.studentMemberId, list);
    }
    const studentIds = [...byStudent.keys()];
    const students = studentIds.length ? await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.id, studentIds)) : [];
    const studentMap = new Map(students.map((s: typeof students[number]) => [s.id, s]));
    const userIds = students.map((s: typeof students[number]) => s.userId);
    const users = userIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const userMap = new Map(users.map((u: typeof users[number]) => [u.id, u]));

    const threads = studentIds.map((studentMemberId) => {
      const list = byStudent.get(studentMemberId)!.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const last = list[list.length - 1];
      const student = studentMap.get(studentMemberId);
      const user = student ? userMap.get(student.userId) : undefined;
      return {
        studentMemberId,
        studentUserName: user?.name ?? null,
        studentUserEmail: user?.email ?? null,
        lastMessage: formatMessage(last),
        messageCount: list.length,
      };
    });
    threads.sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());
    res.json(threads);
  } catch (err) {
    logger.error({ err }, "List teacher message threads error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/teacher-messages?teacherUserId=&studentMemberId=
router.get("/api/schools/:schoolId/teacher-messages", requireAuth, async (req: any, res) => {
  try {
    const { teacherUserId, studentMemberId } = req.query ?? {};
    if (typeof teacherUserId !== "string" || typeof studentMemberId !== "string") {
      res.status(400).json({ error: "teacherUserId and studentMemberId are required" });
      return;
    }
    const ok = await canAccessThread(req, res, req.params.schoolId, teacherUserId, studentMemberId);
    if (!ok) return;
    const rows = await db.select().from(schoolTeacherMessagesTable).where(and(
      eq(schoolTeacherMessagesTable.schoolId, req.params.schoolId),
      eq(schoolTeacherMessagesTable.teacherUserId, teacherUserId),
      eq(schoolTeacherMessagesTable.studentMemberId, studentMemberId),
    ));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => a.createdAt.getTime() - b.createdAt.getTime());
    res.json(rows.map(formatMessage));
  } catch (err) {
    logger.error({ err }, "List teacher messages error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/teacher-messages
router.post("/api/schools/:schoolId/teacher-messages", requireAuth, async (req: any, res) => {
  try {
    const { teacherUserId, studentMemberId, body } = req.body ?? {};
    if (typeof teacherUserId !== "string" || typeof studentMemberId !== "string" || !body?.trim()) {
      res.status(400).json({ error: "teacherUserId, studentMemberId and body are required" });
      return;
    }
    const ok = await canAccessThread(req, res, req.params.schoolId, teacherUserId, studentMemberId);
    if (!ok) return;
    const [row] = await db.insert(schoolTeacherMessagesTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      teacherUserId,
      studentMemberId,
      senderUserId: req.userId,
      body: body.trim(),
    }).returning();

    // فازِ ۷ (بخشِ C): گیرنده = طرفِ دیگرِ رشته‌ی ۱:۱ (معلم یا دانش‌آموز).
    const [studentMember] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.id, studentMemberId)).limit(1);
    const otherUserId = req.userId === teacherUserId ? studentMember?.userId : teacherUserId;
    if (otherUserId) {
      await notifySchoolUsers({
        userIds: [otherUserId],
        schoolId: req.params.schoolId,
        kind: "school_teacher_message",
        severity: "info",
        title: "پیامِ تازه از ارتباط با معلم",
        body: row.body,
      });
    }

    res.status(201).json(formatMessage(row));
  } catch (err) {
    logger.error({ err }, "Send teacher message error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
