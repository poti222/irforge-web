/**
 * routes/schoolAuditLog.ts — بخش "/schools" فاز ۹ (بندِ ۳): endpointِ فقط‌خواندنیِ
 * لاگِ رخدادهایِ مدیریتی. فقط مدیرِ همان مدرسه (SCHOOL_ADMIN_ONLY، همان چکِ
 * requireSchoolAdmin در schools.ts).
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolAuditLogTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";

const router = Router();

// GET /api/schools/:schoolId/audit-log — جدیدترین اول.
router.get("/schools/:schoolId/audit-log", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolAuditLogTable).where(eq(schoolAuditLogTable.schoolId, req.params.schoolId));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    const actorIds = [...new Set(rows.map((r: typeof rows[number]) => r.actorUserId))];
    const actors = actorIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, actorIds)) : [];
    const actorMap = new Map(actors.map((u: typeof actors[number]) => [u.id, u]));
    res.json(rows.map((r: typeof rows[number]) => ({
      id: r.id,
      schoolId: r.schoolId,
      actorUserId: r.actorUserId,
      actorName: actorMap.get(r.actorUserId)?.name ?? null,
      action: r.action,
      targetDescription: r.targetDescription,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "List school audit log error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
