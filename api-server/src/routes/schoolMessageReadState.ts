/**
 * routes/schoolMessageReadState.ts — بخش "/schools" فاز ۹ (بندِ ۱): یک
 * endpoint، برایِ هر سه سیستمِ پیام (مدیر/معلم/مشاور): «این رشته را همین الان
 * خواندم». عمداً canAccessSchool چک نمی‌شود — این نوشتن فقط ردیفِ خودِ
 * کاربرِ فراخوان (userId از توکن) را لمس می‌کند، پس بدترین حالتِ سوءاستفاده
 * (ساختنِ یک threadKeyِ ساختگی) فقط نشانگرِ خودِ همان کاربر را بی‌اثر می‌کند،
 * نه دادهٔ کاربرِ دیگری را.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { requireAuth } from "./auth";
import { markThreadRead } from "../lib/schoolMessageReadState";

const router = Router();

// POST /api/schools/:schoolId/message-read-state
router.post("/schools/:schoolId/message-read-state", requireAuth, async (req: any, res) => {
  try {
    const { threadKey } = req.body ?? {};
    if (typeof threadKey !== "string" || !threadKey.trim()) {
      res.status(400).json({ error: "threadKey is required" });
      return;
    }
    await markThreadRead(req.userId, threadKey.trim());
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Mark thread read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
