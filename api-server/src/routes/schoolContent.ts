/**
 * routes/schoolContent.ts — لغت‌نامه/جزوه/کتاب/فرمول (بخش "/schools" فاز ۱).
 * خواندن برای هر عضوِ مدرسه آزاد است؛ نوشتن (ساخت/ویرایش/حذف) فقط برای
 * role های "admin"/"teacher" — دقیقاً طبقِ خواسته‌ی کاربر.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolContentItemsTable, schoolMembersTable, SCHOOL_CONTENT_TYPES } from "@workspace/db";
import { eq, or, isNull, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";

const router = Router();

function formatItem(i: typeof schoolContentItemsTable.$inferSelect) {
  return {
    id: i.id,
    schoolId: i.schoolId,
    type: i.type,
    title: i.title,
    body: i.body,
    language: i.language,
    createdByUserId: i.createdByUserId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

async function canWrite(userId: string, schoolId: string | null): Promise<boolean> {
  const [member] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  if (!member) return false;
  if (member.role !== "admin" && member.role !== "teacher") return false;
  // محتوایِ عمومی (schoolId=null) را هر مدیر/معلمی می‌تواند بسازد؛ محتوایِ
  // مختصِ یک مدرسه فقط توسطِ عضوِ همان مدرسه.
  if (schoolId && member.schoolId !== schoolId) return false;
  return true;
}

// GET /api/schools/content?schoolId=&type= — لیست، شاملِ محتوایِ عمومی + محتوایِ همان مدرسه
router.get("/api/schools/content", requireAuth, async (req: any, res) => {
  try {
    const schoolId = typeof req.query.schoolId === "string" ? req.query.schoolId : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (type && !(SCHOOL_CONTENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }
    const scopeFilter = schoolId
      ? or(isNull(schoolContentItemsTable.schoolId), eq(schoolContentItemsTable.schoolId, schoolId))
      : isNull(schoolContentItemsTable.schoolId);
    const whereClause = type ? and(scopeFilter, eq(schoolContentItemsTable.type, type)) : scopeFilter;
    const rows = await db.select().from(schoolContentItemsTable).where(whereClause);
    res.json(rows.map(formatItem));
  } catch (err) {
    logger.error({ err }, "List school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/content/:id
router.get("/api/schools/content/:id", requireAuth, async (req: any, res) => {
  try {
    const [row] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatItem(row));
  } catch (err) {
    logger.error({ err }, "Get school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/content — فقط admin/teacher
router.post("/api/schools/content", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, type, title, body, language } = req.body ?? {};
    if (!type || !(SCHOOL_CONTENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }
    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const allowed = await canWrite(req.userId, schoolId ?? null);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [item] = await db.insert(schoolContentItemsTable).values({
      id: crypto.randomUUID(),
      schoolId: schoolId ?? null,
      type,
      title: title.trim(),
      body: body ?? "",
      language: language ?? null,
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json(formatItem(item));
  } catch (err) {
    logger.error({ err }, "Create school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/content/:id — فقط admin/teacher
router.patch("/api/schools/content/:id", requireAuth, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const allowed = await canWrite(req.userId, existing.schoolId);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { title, body, language } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (language !== undefined) patch.language = language;
    const [updated] = await db.update(schoolContentItemsTable).set(patch).where(eq(schoolContentItemsTable.id, req.params.id)).returning();
    res.json(formatItem(updated));
  } catch (err) {
    logger.error({ err }, "Update school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/content/:id — فقط admin/teacher
router.delete("/api/schools/content/:id", requireAuth, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const allowed = await canWrite(req.userId, existing.schoolId);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school content error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
