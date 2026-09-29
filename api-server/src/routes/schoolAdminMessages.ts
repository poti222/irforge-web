/**
 * routes/schoolAdminMessages.ts — بخش "/schools" فاز ۵ (بندِ ۱): «ارتباط با
 * مدیر». یک رشته‌ی مشترک به‌ازایِ هر (schoolId, studentMemberId) — همه‌یِ
 * مدیرهایِ همان مدرسه می‌بینند/پاسخ می‌دهند (ببینید توضیحِ تصمیم در
 * schema/schoolAdminMessages.ts). الگویِ پُلینگ/فرمت دقیقاً کپیِ
 * schoolCounselor.ts (بخشِ پیام‌ها).
 *
 * فازِ ۵ (بندِ ۲): `canAccessThread` پایینِ همین فایل، والدِ دارایِ پیوندِ
 * school_guardianships با studentMemberId را هم می‌پذیرد — چون این رشته از
 * اول مشترک/غیرِمحرمانه طراحی شده، اضافه‌کردنِ والد به همان رشته ساده‌ترین
 * راه است، نه ساختنِ یک سیستمِ پیام‌رسانیِ جدا برایِ والد.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolAdminMessagesTable, schoolMembersTable, schoolGuardianshipsTable, usersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, getSchoolMember } from "../lib/schoolAuth";
import { notifySchoolUsers } from "../lib/schoolNotify";

const router = Router();

function formatMessage(m: typeof schoolAdminMessagesTable.$inferSelect) {
  return {
    id: m.id,
    schoolId: m.schoolId,
    studentMemberId: m.studentMemberId,
    senderUserId: m.senderUserId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * دسترسیِ رشته‌ی یک studentMemberId: مدیرِ همان مدرسه، خودِ همان دانش‌آموز، یا
 * والدی که `school_guardianships` او را به همین studentMemberId پیوند داده
 * (فازِ ۵ بندِ ۲ — مرزِ حریمِ خصوصیِ والد، جدا از canAccessSchool چک می‌شود چون
 * پیوندِ والد↔دانش‌آموز در جدولِ دیگری است).
 */
async function canAccessThread(req: any, res: any, schoolId: string, studentMemberId: string) {
  const { ok: isAdmin, member } = await canAccessSchool(req.userId, schoolId, ["admin"]);
  if (isAdmin) return member;

  const student = await getSchoolMember(req.userId);
  if (student && student.schoolId === schoolId && student.id === studentMemberId && student.role === "student") {
    return student;
  }

  const [link] = await db.select().from(schoolGuardianshipsTable)
    .where(and(eq(schoolGuardianshipsTable.parentUserId, req.userId), eq(schoolGuardianshipsTable.studentMemberId, studentMemberId)))
    .limit(1);
  if (link) {
    // والد عضوِ همین مدرسه است؟ (فرزندش باید در همین مدرسه باشد)
    const [studentRow] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.id, studentMemberId)).limit(1);
    if (studentRow && studentRow.schoolId === schoolId) return studentRow;
  }

  res.status(403).json({ error: "Forbidden" });
  return null;
}

// GET /api/schools/:schoolId/admin-messages/:studentMemberId
router.get("/api/schools/:schoolId/admin-messages/:studentMemberId", requireAuth, async (req: any, res) => {
  try {
    const ok = await canAccessThread(req, res, req.params.schoolId, req.params.studentMemberId);
    if (!ok) return;
    const rows = await db.select().from(schoolAdminMessagesTable).where(and(
      eq(schoolAdminMessagesTable.schoolId, req.params.schoolId),
      eq(schoolAdminMessagesTable.studentMemberId, req.params.studentMemberId),
    ));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => a.createdAt.getTime() - b.createdAt.getTime());
    res.json(rows.map(formatMessage));
  } catch (err) {
    logger.error({ err }, "List admin messages error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/admin-messages/:studentMemberId
router.post("/api/schools/:schoolId/admin-messages/:studentMemberId", requireAuth, async (req: any, res) => {
  try {
    const { body } = req.body ?? {};
    if (!body?.trim()) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const ok = await canAccessThread(req, res, req.params.schoolId, req.params.studentMemberId);
    if (!ok) return;
    const [row] = await db.insert(schoolAdminMessagesTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      studentMemberId: req.params.studentMemberId,
      senderUserId: req.userId,
      body: body.trim(),
    }).returning();

    // فازِ ۷ (بخشِ C): این رشته مشترک است (همه‌یِ مدیرهایِ مدرسه + دانش‌آموز
    // + والدینش) — گیرنده‌یِ اعلان یعنی «همه‌یِ اعضایِ رشته به‌جز فرستنده».
    const admins = await db.select({ userId: schoolMembersTable.userId }).from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.schoolId, req.params.schoolId), eq(schoolMembersTable.role, "admin")));
    const [studentMember] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.id, req.params.studentMemberId)).limit(1);
    const guardians = await db.select().from(schoolGuardianshipsTable).where(eq(schoolGuardianshipsTable.studentMemberId, req.params.studentMemberId));
    const threadUserIds = [
      ...admins.map((a: typeof admins[number]) => a.userId),
      ...(studentMember ? [studentMember.userId] : []),
      ...guardians.map((g: typeof guardians[number]) => g.parentUserId),
    ];
    const recipients = [...new Set(threadUserIds)].filter((id) => id !== req.userId);
    if (recipients.length > 0) {
      await notifySchoolUsers({
        userIds: recipients,
        schoolId: req.params.schoolId,
        kind: "school_admin_message",
        severity: "info",
        title: "پیامِ تازه از ارتباط با مدیر",
        body: row.body,
      });
    }

    res.status(201).json(formatMessage(row));
  } catch (err) {
    logger.error({ err }, "Send admin message error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/admin-messages — فقط مدیر: صندوقِ ورودی، یک
// ردیف به‌ازایِ هر دانش‌آموزی که رشته دارد (آخرین پیام + اطلاعاتِ دانش‌آموز).
router.get("/api/schools/:schoolId/admin-messages", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["admin"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolAdminMessagesTable).where(eq(schoolAdminMessagesTable.schoolId, req.params.schoolId));
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
    logger.error({ err }, "List admin message threads error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
