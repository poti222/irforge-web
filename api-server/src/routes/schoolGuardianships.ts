/**
 * routes/schoolGuardianships.ts — بخش "/schools" فاز ۲: پیوندِ والد↔دانش‌آموز.
 * ساختنِ پیوند فقط مدیر (از صفحه‌ی مدیریتِ اعضا)؛ خواندنِ «فرزندانِ من» فقط
 * خودِ همان والد.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolMembersTable, schoolGuardianshipsTable, schoolsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

// POST /api/schools/:schoolId/guardianships — فقط مدیرِ همان مدرسه.
router.post("/api/schools/:schoolId/guardianships", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { parentUserId, studentMemberId } = req.body ?? {};
    if (!parentUserId?.trim() || !studentMemberId?.trim()) {
      res.status(400).json({ error: "parentUserId and studentMemberId are required" });
      return;
    }
    const [row] = await db.insert(schoolGuardianshipsTable).values({
      id: crypto.randomUUID(),
      parentUserId: parentUserId.trim(),
      studentMemberId: studentMemberId.trim(),
    }).returning();
    res.status(201).json({ id: row.id, parentUserId: row.parentUserId, studentMemberId: row.studentMemberId, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "Create guardianship error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/my-children — فرزندانِ والدِ جاری (پروفایلِ عضویتِ مدرسه‌ایِ هرکدام + نامِ مدرسه).
router.get("/api/schools/my-children", requireAuth, async (req: any, res) => {
  try {
    const links = await db.select().from(schoolGuardianshipsTable).where(eq(schoolGuardianshipsTable.parentUserId, req.userId));
    if (links.length === 0) {
      res.json([]);
      return;
    }
    const memberIds = links.map((l: typeof links[number]) => l.studentMemberId);
    const allMembers = await db.select().from(schoolMembersTable);
    const children = allMembers.filter((m: typeof allMembers[number]) => memberIds.includes(m.id));
    const schoolIds = [...new Set(children.map((c: typeof children[number]) => c.schoolId).filter(Boolean))] as string[];
    const schools = schoolIds.length ? (await db.select().from(schoolsTable)) : [];
    res.json(children.map((c: typeof children[number]) => ({
      id: c.id,
      grade: c.grade,
      city: c.city,
      school: schools.find((s: typeof schools[number]) => s.id === c.schoolId) ? { id: c.schoolId, name: schools.find((s: typeof schools[number]) => s.id === c.schoolId)!.name } : null,
    })));
  } catch (err) {
    logger.error({ err }, "List my children error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
