/**
 * routes/schoolAnnouncements.ts — بخش "/schools" فاز ۲: «پیام همگانی»،
 * «اعلامیه‌ی تعطیلی» (kind="broadcast"/"closure"، فقط admin/deputy برای کلِ
 * مدرسه)، و اعلامیه‌ی یک معلم به کلاسِ خودش (kind="class").
 * خواندن برایِ هر عضوِ همان مدرسه (فیدِ اعلامیه‌ها).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolAnnouncementsTable, schoolMembersTable, schoolClassMembersTable, SCHOOL_ANNOUNCEMENT_KINDS } from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";

const router = Router();

function formatAnnouncement(a: typeof schoolAnnouncementsTable.$inferSelect) {
  return {
    id: a.id,
    schoolId: a.schoolId,
    classId: a.classId,
    authorUserId: a.authorUserId,
    kind: a.kind,
    title: a.title,
    body: a.body,
    createdAt: a.createdAt.toISOString(),
  };
}

async function getRequesterMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

// GET /api/schools/:schoolId/announcements — فیدِ کلِ مدرسه (broadcast/closure) + اگر classId داده شود، اعلامیه‌های همان کلاس هم.
router.get("/api/schools/:schoolId/announcements", requireAuth, async (req: any, res) => {
  try {
    const requester = await getRequesterMember(req.userId);
    if (!requester || requester.schoolId !== req.params.schoolId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
    const whereClause = classId
      ? and(eq(schoolAnnouncementsTable.schoolId, req.params.schoolId), or(isNull(schoolAnnouncementsTable.classId), eq(schoolAnnouncementsTable.classId, classId)))
      : and(eq(schoolAnnouncementsTable.schoolId, req.params.schoolId), isNull(schoolAnnouncementsTable.classId));
    const rows = await db.select().from(schoolAnnouncementsTable).where(whereClause);
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatAnnouncement));
  } catch (err) {
    logger.error({ err }, "List school announcements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/announcements — kind="broadcast"/"closure" فقط admin/deputy؛
// kind="class" فقط اگر فرستنده معلمِ همان کلاس باشد (school_class_members با roleInClass="teacher").
router.post("/api/schools/:schoolId/announcements", requireAuth, async (req: any, res) => {
  try {
    const requester = await getRequesterMember(req.userId);
    if (!requester || requester.schoolId !== req.params.schoolId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { kind, title, body, classId } = req.body ?? {};
    if (!kind || !(SCHOOL_ANNOUNCEMENT_KINDS as readonly string[]).includes(kind)) {
      res.status(400).json({ error: "Invalid kind" });
      return;
    }
    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (kind === "class") {
      if (!classId?.trim()) {
        res.status(400).json({ error: "classId is required for kind=class" });
        return;
      }
      const [membership] = await db.select().from(schoolClassMembersTable)
        .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.schoolMemberId, requester.id), eq(schoolClassMembersTable.roleInClass, "teacher")))
        .limit(1);
      const isAdmin = requester.role === "admin";
      if (!membership && !isAdmin) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else if (!["admin", "deputy"].includes(requester.role ?? "")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db.insert(schoolAnnouncementsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      classId: kind === "class" ? classId : null,
      authorUserId: req.userId,
      kind,
      title: title.trim(),
      body: body ?? "",
    }).returning();
    res.status(201).json(formatAnnouncement(row));
  } catch (err) {
    logger.error({ err }, "Create school announcement error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
