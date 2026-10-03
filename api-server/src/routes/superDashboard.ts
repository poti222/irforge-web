/**
 * routes/superDashboard.ts — بخش "/super" (بخشِ B): فهرستِ همه‌یِ مدارس برایِ
 * نمایِ global سوپرادمین.
 * ─────────────────────────────────────────────────────────────────────────────
 * بیشترِ تب‌هایِ `/super` کامپوننت‌های موجودِ `AllBotsTable`/`ProductsManager`/
 * pool-های بات و شیت را دوباره استفاده می‌کنند (همان APIهایِ موجودِ خودشان،
 * فقط `requireSuperGate` اضافه رویِ همین‌جا). این فایل فقط آن تکه‌ای را
 * اضافه می‌کند که قبلاً هیچ‌جایِ دیگری وجود نداشت: یک نمایِ سراسریِ
 * «همه‌یِ مدارس» (برخلافِ routes/schools.ts که همیشه رویِ *یک* مدرسه‌یِ
 * مشخص کار می‌کند).
 */
import { Router } from "express";
import { db, schoolsTable, schoolMembersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { logger } from "../lib/logger";
import { logSchoolAudit } from "../lib/schoolAuditLog";

const router = Router();

function formatSchool(s: typeof schoolsTable.$inferSelect, memberCount: number) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    city: s.city,
    licenseInfo: s.licenseInfo,
    isTestSchool: s.isTestSchool,
    memberCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// GET /api/super/schools — فهرستِ همه‌یِ مدارس (واقعی + آزمایشی)، با تعدادِ اعضا.
router.get("/super/schools", requireSuperAdmin, requireSuperGate, async (_req, res) => {
  try {
    const rows = await db.select().from(schoolsTable).orderBy(schoolsTable.createdAt);
    const counts = await db
      .select({ schoolId: schoolMembersTable.schoolId, count: sql<number>`count(*)` })
      .from(schoolMembersTable)
      .where(sql`${schoolMembersTable.schoolId} IS NOT NULL`)
      .groupBy(schoolMembersTable.schoolId);
    const countMap = new Map(counts.map((c: typeof counts[number]) => [c.schoolId, Number(c.count)]));
    res.json(rows.map((s: typeof rows[number]) => formatSchool(s, countMap.get(s.id) ?? 0)));
  } catch (err) {
    logger.error({ err }, "super list schools error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/super/schools/:id — ویرایشِ نام/شهر/مجوز از نمایِ سراسری.
router.patch("/super/schools/:id", requireSuperAdmin, requireSuperGate, async (req: any, res) => {
  try {
    const { name, city, licenseInfo } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (city !== undefined) patch.city = city;
    if (licenseInfo !== undefined) patch.licenseInfo = licenseInfo;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [updated] = await db.update(schoolsTable).set(patch).where(eq(schoolsTable.id, req.params.id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logSchoolAudit(updated.id, req.userId, "school.updated_by_super", `/super: ${Object.keys(patch).join(", ")}`);
    res.json(formatSchool(updated, 0));
  } catch (err) {
    logger.error({ err }, "super update school error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
