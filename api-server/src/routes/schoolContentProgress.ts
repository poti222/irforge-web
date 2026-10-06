/**
 * routes/schoolContentProgress.ts — حالتِ مطالعه/فلش‌کارت: خواندنِ پیشرفتِ
 * خودِ کاربر رویِ آیتم‌هایِ یک درس + ثبتِ خودارزیابیِ هر آیتم (ببینید
 * schema/schoolContentProgress.ts برایِ توضیحِ کاملِ طراحی/زمان‌بندی).
 *
 * هر دو مسیر فقط رویِ «پیشرفتِ خودِ کاربر» کار می‌کنند (نه یک studentMemberId
 * دلخواه در بدنه/کوئری) — یعنی حتی چکِ گیتِ موضوعیِ معلم↔درس لازم نیست:
 * همین که عضوِ همین مدرسه باشد کافی‌ست، چون او فقط می‌تواند رکوردِ *خودش* را
 * بخواند/بنویسد، نه آیتمِ کسِ دیگری را تغییر دهد یا ببیند.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolContentProgressTable, schoolMembersTable, schoolContentItemsTable,
  SCHOOL_CONTENT_RATINGS, SCHOOL_MEMBER_ROLES,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool } from "../lib/schoolAuth";
import { getContentScope, itemVisibleTo, loadContentContext } from "../lib/schoolContentAccess";

const router = Router();

/**
 * دنباله‌ی ثابتِ بازه‌ها (روز) — طبقِ اسپک عمداً ساده (نه SM-2 واقعی): هر
 * «بلدم» یک پله جلو می‌رود؛ از پله‌ی آخر دیگر جلوتر نمی‌رود (سقف).
 */
const INTERVAL_STEPS_DAYS = [1, 2, 4, 7, 14, 30];

function formatProgress(p: typeof schoolContentProgressTable.$inferSelect) {
  return {
    id: p.id,
    contentItemId: p.contentItemId,
    lastRating: p.lastRating,
    reviewCount: p.reviewCount,
    intervalDays: p.intervalDays,
    nextReviewAt: p.nextReviewAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /api/schools/:schoolId/content-progress/my?lessonId= — پیشرفتِ خودِ کاربر رویِ آیتم‌هایِ یک درس
router.get("/schools/:schoolId/content-progress/my", requireAuth, async (req: any, res) => {
  try {
    const { ok, member } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok || !member) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const lessonId = typeof req.query.lessonId === "string" ? req.query.lessonId : undefined;
    if (!lessonId) {
      res.status(400).json({ error: "lessonId is required" });
      return;
    }
    // اول idِ آیتم‌هایِ همین درس، بعد پیشرفتِ خودِ کاربر رویِ همان idها —
    // این‌طوری یک دانش‌آموز هرگز پیشرفتِ یک آیتمِ درسِ دیگر را نمی‌بیند.
    const items = await db.select({ id: schoolContentItemsTable.id })
      .from(schoolContentItemsTable).where(eq(schoolContentItemsTable.lessonId, lessonId));
    const itemIds = items.map((i: { id: string }) => i.id);
    if (itemIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await db.select().from(schoolContentProgressTable)
      .where(and(eq(schoolContentProgressTable.studentMemberId, member.id), inArray(schoolContentProgressTable.contentItemId, itemIds)));
    res.json(rows.map(formatProgress));
  } catch (err) {
    logger.error({ err }, "Get my content progress error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/content-progress/rate — خودارزیابیِ یک آیتم (بلدم / نیاز به تمرین دارم)
router.post("/schools/:schoolId/content-progress/rate", requireAuth, async (req: any, res) => {
  try {
    const { ok, member } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_MEMBER_ROLES);
    if (!ok || !member) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { contentItemId, rating } = req.body ?? {};
    if (!contentItemId || typeof contentItemId !== "string") {
      res.status(400).json({ error: "contentItemId is required" });
      return;
    }
    if (!rating || !(SCHOOL_CONTENT_RATINGS as readonly string[]).includes(rating)) {
      res.status(400).json({ error: "Invalid rating" });
      return;
    }
    const [item] = await db.select().from(schoolContentItemsTable).where(eq(schoolContentItemsTable.id, contentItemId)).limit(1);
    if (!item || item.schoolId !== req.params.schoolId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // typeِ خاموش برایِ این کاربر وجود ندارد — پس رتبه‌دادن هم ۴۰۴ (همان قاعده‌یِ GET آیتم).
    const scope = await getContentScope(req.userId, req.params.schoolId);
    if (!itemVisibleTo(item, await loadContentContext(req.params.schoolId), scope)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [existing] = await db.select().from(schoolContentProgressTable)
      .where(and(eq(schoolContentProgressTable.studentMemberId, member.id), eq(schoolContentProgressTable.contentItemId, contentItemId)))
      .limit(1);

    const now = new Date();
    let reviewCount: number;
    let intervalDays: number;
    let nextReviewAt: Date;
    if (rating === "know") {
      reviewCount = (existing?.reviewCount ?? 0) + 1;
      intervalDays = INTERVAL_STEPS_DAYS[Math.min(reviewCount - 1, INTERVAL_STEPS_DAYS.length - 1)];
      nextReviewAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    } else {
      // «نیاز به تمرین دارم» — به پله‌ی اول برمی‌گردد و بلافاصله (جلسه‌ی بعدی) دوباره دیده می‌شود.
      reviewCount = 0;
      intervalDays = INTERVAL_STEPS_DAYS[0];
      nextReviewAt = now;
    }

    let saved;
    if (existing) {
      [saved] = await db.update(schoolContentProgressTable)
        .set({ lastRating: rating, reviewCount, intervalDays, nextReviewAt })
        .where(eq(schoolContentProgressTable.id, existing.id)).returning();
    } else {
      [saved] = await db.insert(schoolContentProgressTable).values({
        id: crypto.randomUUID(),
        contentItemId,
        studentMemberId: member.id,
        lastRating: rating,
        reviewCount,
        intervalDays,
        nextReviewAt,
      }).returning();
    }
    res.json(formatProgress(saved));
  } catch (err) {
    logger.error({ err }, "Rate school content progress error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
