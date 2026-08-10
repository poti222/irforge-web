/**
 * routes/updates.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * «آپدیت‌های سایت» — تغییرات و امکانات جدیدی که ادمین منتشر می‌کند.
 *
 * جریان کار:
 *   ۱. ادمین یک آپدیت پیش‌نویس می‌سازد (عنوان + متن + تا ۸ عکس).
 *   ۲. با Publish، آپدیت منتشر می‌شود و برای **همه‌ی** کاربران یک اعلان با
 *      `type = "site_update"` و `refId = <update id>` ساخته می‌شود.
 *   ۳. اولین باری که کاربر بعد از انتشار وارد داشبورد می‌شود، مودال آن آپدیت
 *      را می‌بیند؛ با بستن مودال همه‌ی آپدیت‌های منتشرشده برایش seen می‌شوند.
 *   ۴. صفحه‌ی /updates تاریخچه‌ی دائمی را نگه می‌دارد.
 *
 * عکس‌ها به‌صورت data-URL بیس‌۶۴ در `site_update_images` ذخیره می‌شوند —
 * دقیقاً همان الگویی که رسید کیف پول استفاده می‌کند. لیست‌ها هیچ‌وقت بدنه‌ی
 * عکس‌ها را برنمی‌گردانند، فقط `imageCount`.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  siteUpdatesTable,
  siteUpdateImagesTable,
  userUpdateViewsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

/** خروجی مشترک لیست‌ها — هیچ‌وقت بدنه‌ی عکس‌ها را حمل نمی‌کند. */
type UpdateListItem = {
  id: string;
  version: string | null;
  title: string;
  body: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  imageCount: number;
};

/**
 * شمارش عکس‌های چند آپدیت با یک کوئری گروهی — تا برای n آپدیت n کوئری نزنیم.
 */
async function imageCounts(updateIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (updateIds.length === 0) return counts;
  const rows = await db
    .select({
      updateId: siteUpdateImagesTable.updateId,
      count: sql<number>`count(*)::int`,
    })
    .from(siteUpdateImagesTable)
    .where(inArray(siteUpdateImagesTable.updateId, updateIds))
    .groupBy(siteUpdateImagesTable.updateId);
  for (const r of rows) counts.set(r.updateId, Number(r.count));
  return counts;
}

/** عکس‌های یک آپدیت، به‌ترتیب sort_order. */
async function imagesFor(updateId: string): Promise<string[]> {
  const rows = await db
    .select({ dataUrl: siteUpdateImagesTable.dataUrl })
    .from(siteUpdateImagesTable)
    .where(eq(siteUpdateImagesTable.updateId, updateId))
    .orderBy(asc(siteUpdateImagesTable.sortOrder));
  return rows.map((r) => r.dataUrl);
}

// ─── GET /api/updates ────────────────────────────────────────────────────────
// فقط منتشرشده‌ها، جدیدترین اول. `seen` از روی user_update_views می‌آید.
router.get("/updates", requireAuth, async (req: any, res) => {
  try {
    const rows = await db
      .select()
      .from(siteUpdatesTable)
      .where(eq(siteUpdatesTable.published, true))
      .orderBy(desc(siteUpdatesTable.publishedAt))
      .limit(100);

    const ids = rows.map((r) => r.id);
    const counts = await imageCounts(ids);

    const seenRows = ids.length
      ? await db
          .select({ updateId: userUpdateViewsTable.updateId })
          .from(userUpdateViewsTable)
          .where(
            and(
              eq(userUpdateViewsTable.userId, req.userId),
              inArray(userUpdateViewsTable.updateId, ids),
            ),
          )
      : [];
    const seen = new Set(seenRows.map((r) => r.updateId));

    res.json(
      rows.map((u) => ({
        id: u.id,
        version: u.version,
        title: u.title,
        body: u.body,
        publishedAt: u.publishedAt ? u.publishedAt.toISOString() : null,
        imageCount: counts.get(u.id) ?? 0,
        seen: seen.has(u.id),
      })),
    );
  } catch (err) {
    logger.error({ err }, "List updates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/updates/unseen ─────────────────────────────────────────────────
// جدیدترین آپدیتِ منتشرشده‌ای که این کاربر ندیده. کاربری که تازه ثبت‌نام کرده
// نباید تاریخچه‌ی قبل از خودش را به‌صورت مودال ببیند، پس published_at باید
// بعد از users.created_at باشد.
// مهم: این روت باید **قبل از** «/updates/:id» ثبت شود، وگرنه express رشته‌ی
// "unseen" را به‌عنوان id می‌گیرد.
router.get("/updates/unseen", requireAuth, async (req: any, res) => {
  try {
    const [user] = await db
      .select({ createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    if (!user) {
      res.json({ update: null });
      return;
    }

    const seenRows = await db
      .select({ updateId: userUpdateViewsTable.updateId })
      .from(userUpdateViewsTable)
      .where(eq(userUpdateViewsTable.userId, req.userId));
    const seen = new Set(seenRows.map((r) => r.updateId));

    const candidates = await db
      .select()
      .from(siteUpdatesTable)
      .where(
        and(
          eq(siteUpdatesTable.published, true),
          gte(siteUpdatesTable.publishedAt, user.createdAt),
        ),
      )
      .orderBy(desc(siteUpdatesTable.publishedAt))
      .limit(50);

    const target = candidates.find((u) => !seen.has(u.id));
    if (!target) {
      // «چیزی برای نشان‌دادن نیست» یک حالت عادی است، نه ۴۰۴.
      res.json({ update: null });
      return;
    }

    res.json({
      update: {
        id: target.id,
        version: target.version,
        title: target.title,
        body: target.body,
        publishedAt: target.publishedAt ? target.publishedAt.toISOString() : null,
        images: await imagesFor(target.id),
      },
    });
  } catch (err) {
    logger.error({ err }, "Get unseen update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/updates/seen ──────────────────────────────────────────────────
// بادی: { updateId?: string }. بدون updateId یعنی «همه‌ی منتشرشده‌ها را دیدم» —
// که کاری می‌کند بستن یک مودال زنجیره‌ی مودال‌های پشت‌سرهم نسازد.
router.post("/updates/seen", requireAuth, async (req: any, res) => {
  try {
    const updateId = typeof req.body?.updateId === "string" ? req.body.updateId : null;

    let ids: string[];
    if (updateId) {
      ids = [updateId];
    } else {
      const rows = await db
        .select({ id: siteUpdatesTable.id })
        .from(siteUpdatesTable)
        .where(eq(siteUpdatesTable.published, true));
      ids = rows.map((r) => r.id);
    }

    if (ids.length > 0) {
      await db
        .insert(userUpdateViewsTable)
        .values(ids.map((id) => ({ userId: req.userId, updateId: id })))
        .onConflictDoNothing();
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Mark updates seen error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/updates/:id ────────────────────────────────────────────────────
// یک پیش‌نویس برای کاربر عادی باید مثل «وجود ندارد» رفتار کند (۴۰۴، نه ۴۰۳) —
// همان الگوی GET /notifications/:id، تا وجود پیش‌نویس لو نرود.
router.get("/updates/:id", requireAuth, async (req: any, res) => {
  try {
    const [row] = await db
      .select()
      .from(siteUpdatesTable)
      .where(eq(siteUpdatesTable.id, req.params.id))
      .limit(1);

    // requireAuth فقط req.userId را ست می‌کند و نقش را نمی‌خواند، پس نقش را
    // فقط وقتی لازم است (آپدیت منتشرنشده) خودمان یک‌بار می‌خوانیم.
    let isStaff = false;
    if (row && !row.published) {
      const [me] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId))
        .limit(1);
      isStaff = me?.role === "admin" || me?.role === "super_admin";
    }
    if (!row || (!row.published && !isStaff)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({
      id: row.id,
      version: row.version,
      title: row.title,
      body: row.body,
      published: row.published,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      images: await imagesFor(row.id),
    });
  } catch (err) {
    logger.error({ err }, "Get update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { imageCounts, imagesFor };
export type { UpdateListItem };
export default router;
