/**
 * routes/pluginReleaseNotes.ts — IRFORGE_PROMPT_V3 Phase 38.
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز هیچ‌جا نمی‌گفت «نسخه‌ی X این پلاگین یعنی چه چیزی عوض شده» — نه
 * روی بات (مانیفستِ `plugin.py` فیلدی برای این ندارد) و نه روی سایت. یک
 * مشتری که می‌دید نسخه‌ی پلاگینش عوض شده هیچ راهی برای فهمیدنِ «چرا مهم است»
 * نداشت.
 *
 * این یک changelog per-plugin است، جدا از `siteUpdatesTable` (که یک جریانِ
 * سراسریِ اعلامیه است، نه چیزی که به یک پلاگینِ خاص گره بخورد). فقط
 * سوپرادمین می‌نویسد؛ هر کاربرِ واردشده می‌خواند.
 *
 * انتشارِ یک یادداشتِ تازه به هر مالکِ باتی که آن پلاگین را نصب دارد اطلاع
 * می‌دهد — با `createNotification` که پیش از این هم برای «پلاگین نصب شد» و
 * مشابهش استفاده شده.
 */
import { Router } from "express";
import crypto from "crypto";
import { db, pluginReleaseNotesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "./auth.js";
import { logger } from "../lib/logger.js";
import { getPluginCatalog } from "../lib/pluginCatalog.js";
import { createNotification } from "../lib/notify.js";
import { ownerUserIdsForPlugin } from "../lib/pluginOwners.js";

const router = Router();

const TITLE_MAX = 200;
const BODY_MAX = 4000;
const VERSION_MAX = 32;

function formatNote(n: typeof pluginReleaseNotesTable.$inferSelect) {
  return {
    id: n.id,
    pluginId: n.pluginId,
    version: n.version,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  };
}

/** فهرستِ یادداشت‌های یک پلاگین، تازه‌ترین اول — هر کاربرِ واردشده می‌بیند. */
router.get("/plugins/:pluginId/release-notes", requireAuth, async (req: any, res) => {
  try {
    const notes = await db
      .select()
      .from(pluginReleaseNotesTable)
      .where(eq(pluginReleaseNotesTable.pluginId, req.params.pluginId))
      .orderBy(desc(pluginReleaseNotesTable.createdAt));
    res.json(notes.map(formatNote));
  } catch (err) {
    logger.error({ err }, "List plugin release notes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** همه‌ی یادداشت‌ها، برای پنل مدیریت — با اسمِ پلاگین از کاتالوگ. */
router.get("/admin/plugin-release-notes", requireSuperAdmin, async (req: any, res) => {
  try {
    const [notes, catalog] = await Promise.all([
      db.select().from(pluginReleaseNotesTable).orderBy(desc(pluginReleaseNotesTable.createdAt)),
      getPluginCatalog(),
    ]);
    const pluginName = new Map(catalog.plugins.map((p) => [p.id, p.name_fa || p.name]));
    res.json(notes.map((n) => ({ ...formatNote(n), pluginName: pluginName.get(n.pluginId) ?? n.pluginId })));
  } catch (err) {
    logger.error({ err }, "Admin list plugin release notes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/plugin-release-notes", requireSuperAdmin, async (req: any, res) => {
  try {
    const pluginId = String(req.body?.pluginId ?? "").trim();
    const version = String(req.body?.version ?? "").trim();
    const title = String(req.body?.title ?? "").trim();
    const body = String(req.body?.body ?? "").trim();
    if (!pluginId || !version || !title || !body) {
      res.status(400).json({ error: "pluginId، version، title و body همه الزامی‌اند" });
      return;
    }

    const catalog = await getPluginCatalog();
    if (!catalog.plugins.some((p) => p.id === pluginId)) {
      res.status(404).json({ error: "این پلاگین در کاتالوگ منتشرشده پیدا نشد." });
      return;
    }

    const [note] = await db.insert(pluginReleaseNotesTable).values({
      id: crypto.randomUUID(),
      pluginId,
      version: version.slice(0, VERSION_MAX),
      title: title.slice(0, TITLE_MAX),
      body: body.slice(0, BODY_MAX),
      createdBy: req.userId,
    }).returning();

    // اطلاع به هر مالکِ باتی که همین پلاگین را نصب دارد — یک نفر به‌ازای هر
    // کاربر، حتی اگر روی چند باتش نصب باشد.
    try {
      const userIds = await ownerUserIdsForPlugin(pluginId);
      const pluginTitle = catalog.plugins.find((p) => p.id === pluginId)?.name_fa
        ?? catalog.plugins.find((p) => p.id === pluginId)?.name
        ?? pluginId;
      for (const userId of userIds) {
        await createNotification({
          userId,
          type: "plugin_release_note",
          severity: "info",
          title: "به‌روزرسانیِ پلاگین",
          message: `پلاگین «${pluginTitle}» به نسخه‌ی ${note.version} رسید: ${title}`,
        });
      }
    } catch (err) {
      logger.warn({ err, pluginId }, "plugin release note: notify owners failed (ignored)");
    }

    res.status(201).json(formatNote(note));
  } catch (err) {
    logger.error({ err }, "Create plugin release note error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/plugin-release-notes/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const update: Record<string, any> = {};
    if (req.body?.version !== undefined) update.version = String(req.body.version).trim().slice(0, VERSION_MAX);
    if (req.body?.title !== undefined) update.title = String(req.body.title).trim().slice(0, TITLE_MAX);
    if (req.body?.body !== undefined) update.body = String(req.body.body).trim().slice(0, BODY_MAX);
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [note] = await db.update(pluginReleaseNotesTable).set(update)
      .where(eq(pluginReleaseNotesTable.id, req.params.id)).returning();
    if (!note) {
      res.status(404).json({ error: "Release note not found" });
      return;
    }
    res.json(formatNote(note));
  } catch (err) {
    logger.error({ err }, "Update plugin release note error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/plugin-release-notes/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [note] = await db
      .select({ id: pluginReleaseNotesTable.id })
      .from(pluginReleaseNotesTable)
      .where(eq(pluginReleaseNotesTable.id, req.params.id))
      .limit(1);
    if (!note) {
      res.status(404).json({ error: "Release note not found" });
      return;
    }
    await db.delete(pluginReleaseNotesTable).where(eq(pluginReleaseNotesTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete plugin release note error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
