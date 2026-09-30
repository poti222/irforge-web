/**
 * routes/schoolQuestions.ts — بخش "/schools" فاز ۴ (بندِ ۲): بانکِ سؤالِ
 * معلم. CRUD ساده، فقط سازنده‌ی همان سؤال (یا مدیرِ مدرسه) می‌تواند
 * ویرایش/حذف کند — دقیقاً همان الگویِ مالکیتی که schoolAssignments.ts برایِ
 * تکلیف دارد.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, schoolQuestionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool } from "../lib/schoolAuth";

const router = Router();

function formatQuestion(q: typeof schoolQuestionsTable.$inferSelect) {
  return {
    id: q.id,
    schoolId: q.schoolId,
    teacherUserId: q.teacherUserId,
    questionText: q.questionText,
    choices: q.choices,
    correctAnswer: q.correctAnswer,
    createdAt: q.createdAt.toISOString(),
  };
}

// GET /api/schools/:schoolId/questions — فقط معلمِ سازنده (بانکِ سؤالِ شخصیِ هر معلم) یا مدیر.
router.get("/api/schools/:schoolId/questions", requireAuth, async (req: any, res) => {
  try {
    const { ok, member } = await canAccessSchool(req.userId, req.params.schoolId, ["teacher", "admin"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = member?.role === "admin"
      ? await db.select().from(schoolQuestionsTable).where(eq(schoolQuestionsTable.schoolId, req.params.schoolId))
      : await db.select().from(schoolQuestionsTable)
          .where(and(eq(schoolQuestionsTable.schoolId, req.params.schoolId), eq(schoolQuestionsTable.teacherUserId, req.userId)));
    rows.sort((a: typeof rows[number], b: typeof rows[number]) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map(formatQuestion));
  } catch (err) {
    logger.error({ err }, "List school questions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/questions — فقط معلم.
router.post("/api/schools/:schoolId/questions", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["teacher"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { questionText, choices, correctAnswer } = req.body ?? {};
    if (!questionText?.trim()) {
      res.status(400).json({ error: "questionText is required" });
      return;
    }
    const [row] = await db.insert(schoolQuestionsTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.schoolId,
      teacherUserId: req.userId,
      questionText: questionText.trim(),
      choices: Array.isArray(choices) ? choices : null,
      correctAnswer: correctAnswer ?? null,
    }).returning();
    res.status(201).json(formatQuestion(row));
  } catch (err) {
    logger.error({ err }, "Create school question error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:schoolId/questions/:id — فقط سازنده.
router.patch("/api/schools/:schoolId/questions/:id", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["teacher"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { questionText, choices, correctAnswer } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (questionText !== undefined) patch.questionText = questionText;
    if (choices !== undefined) patch.choices = choices;
    if (correctAnswer !== undefined) patch.correctAnswer = correctAnswer;
    const [row] = await db.update(schoolQuestionsTable).set(patch)
      .where(and(eq(schoolQuestionsTable.id, req.params.id), eq(schoolQuestionsTable.schoolId, req.params.schoolId), eq(schoolQuestionsTable.teacherUserId, req.userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatQuestion(row));
  } catch (err) {
    logger.error({ err }, "Update school question error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:schoolId/questions/:id — فقط سازنده.
router.delete("/api/schools/:schoolId/questions/:id", requireAuth, async (req: any, res) => {
  try {
    const { ok } = await canAccessSchool(req.userId, req.params.schoolId, ["teacher"]);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(schoolQuestionsTable)
      .where(and(eq(schoolQuestionsTable.id, req.params.id), eq(schoolQuestionsTable.schoolId, req.params.schoolId), eq(schoolQuestionsTable.teacherUserId, req.userId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete school question error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
