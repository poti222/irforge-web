import { logger } from "../lib/logger";
import { Router } from "express";
import { db, themesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";

const router = Router();

function formatTheme(t: any) {
  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    primaryColor: t.primaryColor,
    backgroundColor: t.backgroundColor,
    foregroundColor: t.foregroundColor,
    accentColor: t.accentColor,
    borderRadius: t.borderRadius,
    fontFamily: t.fontFamily,
    userId: t.userId,
    isDefault: t.isDefault,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
  };
}

// GET /api/themes
router.get("/themes", requireAuth, async (req: any, res) => {
  try {
    const themes = await db.select().from(themesTable).where(eq(themesTable.userId, req.userId));
    res.json(themes.map(formatTheme));
  } catch (err) {
    logger.error({ err }, "List themes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/themes
router.post("/themes", requireAuth, async (req: any, res) => {
  try {
    const { name, mode, primaryColor, backgroundColor, foregroundColor, accentColor, borderRadius, fontFamily } = req.body;
    const [theme] = await db.insert(themesTable).values({
      id: crypto.randomUUID(),
      name,
      mode: mode ?? "dark",
      primaryColor,
      backgroundColor: backgroundColor ?? "",
      foregroundColor: foregroundColor ?? "",
      accentColor: accentColor ?? "",
      borderRadius: borderRadius ?? "0.5rem",
      fontFamily: fontFamily ?? "Inter",
      userId: req.userId,
      isDefault: false,
      isActive: false,
    }).returning();
    res.status(201).json(formatTheme(theme));
  } catch (err) {
    logger.error({ err }, "Create theme error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/themes/:themeId
router.patch("/themes/:themeId", requireAuth, async (req: any, res) => {
  try {
    const update: Record<string, any> = {};
    const fields = ["name", "mode", "primaryColor", "backgroundColor", "foregroundColor", "accentColor", "borderRadius", "fontFamily"];
    for (const f of fields) {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    }
    const [theme] = await db.update(themesTable).set(update)
      .where(and(eq(themesTable.id, req.params.themeId), eq(themesTable.userId, req.userId)))
      .returning();
    if (!theme) {
      res.status(404).json({ error: "Theme not found" });
      return;
    }
    res.json(formatTheme(theme));
  } catch (err) {
    logger.error({ err }, "Update theme error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/themes/:themeId
router.delete("/themes/:themeId", requireAuth, async (req: any, res) => {
  try {
    await db.delete(themesTable)
      .where(and(eq(themesTable.id, req.params.themeId), eq(themesTable.userId, req.userId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete theme error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/themes/apply
router.post("/themes/apply", requireAuth, async (req: any, res) => {
  try {
    const { themeId } = req.body;
    // Deactivate all user themes
    await db.update(themesTable).set({ isActive: false }).where(eq(themesTable.userId, req.userId));
    // Activate the selected theme
    const [theme] = await db.update(themesTable).set({ isActive: true })
      .where(and(eq(themesTable.id, themeId), eq(themesTable.userId, req.userId)))
      .returning();
    if (!theme) {
      res.status(404).json({ error: "Theme not found" });
      return;
    }
    res.json(formatTheme(theme));
  } catch (err) {
    logger.error({ err }, "Apply theme error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
