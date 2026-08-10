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
import { requireAuth, requireAdmin } from "./auth";
import { logger } from "../lib/logger";
import { createNotificationsBulk } from "../lib/notify";

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

// ═══ ADMIN ═══════════════════════════════════════════════════════════════════
// همان سبک اعتبارسنجیِ ANNOUNCEMENT_TYPES در admin.ts: هر ورودی قبل از رسیدن
// به insert بررسی می‌شود و هر رد شدن یک ۴۰۰ با پیام قابل‌نمایش برمی‌گرداند
// (فرانت `err.data.error` را می‌خواند).
const UPDATE_TITLE_MAX = 200;
const UPDATE_BODY_MAX = 8000;
const UPDATE_VERSION_MAX = 32;
const UPDATE_MAX_IMAGES = 8;
const UPDATE_MAX_IMAGE_BYTES = 800 * 1024; // بعد از فشرده‌سازیِ سمت کلاینت

/** خطای اعتبارسنجی — پیامش مستقیم به کاربرِ پنل نشان داده می‌شود. */
class ValidationError extends Error {}

function validateText(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
): string | null {
  if (value == null || value === "") {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && trimmed === "") throw new ValidationError(`${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return trimmed === "" ? null : trimmed;
}

/**
 * عکس‌ها باید data-URL باشند و حجمِ دیکدشده‌شان از سقف رد نشود. حجم واقعی از
 * روی طول رشته‌ی base64 تخمین زده می‌شود (هر ۴ کاراکتر = ۳ بایت) تا مجبور
 * نشویم کل عکس را در حافظه دیکد کنیم.
 */
function validateImages(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new ValidationError("images must be an array");
  if (value.length > UPDATE_MAX_IMAGES) {
    throw new ValidationError(`At most ${UPDATE_MAX_IMAGES} images are allowed`);
  }
  return value.map((raw, i) => {
    if (typeof raw !== "string" || !raw.startsWith("data:image/") || !raw.includes(";base64,")) {
      throw new ValidationError(`Image ${i + 1} must be a base64 image data URL`);
    }
    const b64 = raw.slice(raw.indexOf(";base64,") + 8);
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > UPDATE_MAX_IMAGE_BYTES) {
      throw new ValidationError(
        `Image ${i + 1} is too large (${Math.round(bytes / 1024)}KB, max ${UPDATE_MAX_IMAGE_BYTES / 1024}KB)`,
      );
    }
    return raw;
  });
}

/** عکس‌های یک آپدیت را کامل جایگزین می‌کند (replace، نه merge). */
async function replaceImages(updateId: string, images: string[]): Promise<void> {
  await db.delete(siteUpdateImagesTable).where(eq(siteUpdateImagesTable.updateId, updateId));
  if (images.length === 0) return;
  await db.insert(siteUpdateImagesTable).values(
    images.map((dataUrl, i) => ({
      id: crypto.randomUUID(),
      updateId,
      dataUrl,
      sortOrder: i,
    })),
  );
}

// GET /api/admin/updates — پیش‌نویس‌ها و منتشرشده‌ها با هم.
router.get("/admin/updates", requireAdmin, async (_req: any, res) => {
  try {
    const rows = await db
      .select()
      .from(siteUpdatesTable)
      .orderBy(desc(siteUpdatesTable.createdAt));
    const counts = await imageCounts(rows.map((r) => r.id));
    res.json(
      rows.map((u) => ({
        id: u.id,
        version: u.version,
        title: u.title,
        body: u.body,
        published: u.published,
        publishedAt: u.publishedAt ? u.publishedAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        imageCount: counts.get(u.id) ?? 0,
      })),
    );
  } catch (err) {
    logger.error({ err }, "List admin updates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/updates — ساخت پیش‌نویس. انتشار اکشن جداگانه‌ای است.
router.post("/admin/updates", requireAdmin, async (req: any, res) => {
  try {
    const title = validateText(req.body?.title, "Title", UPDATE_TITLE_MAX, true)!;
    const body = validateText(req.body?.body, "Body", UPDATE_BODY_MAX, true)!;
    const version = validateText(req.body?.version, "Version", UPDATE_VERSION_MAX, false);
    const images = validateImages(req.body?.images) ?? [];

    const [row] = await db
      .insert(siteUpdatesTable)
      .values({
        id: crypto.randomUUID(),
        version,
        title,
        body,
        published: false,
        createdBy: req.userId,
      })
      .returning();

    await replaceImages(row.id, images);

    res.status(201).json({
      id: row.id,
      version: row.version,
      title: row.title,
      body: row.body,
      published: row.published,
      publishedAt: null,
      createdAt: row.createdAt.toISOString(),
      imageCount: images.length,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Create update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/updates/:id — ویرایش. اگر images بیاید، کامل جایگزین می‌شود.
router.patch("/admin/updates/:id", requireAdmin, async (req: any, res) => {
  try {
    const [existing] = await db
      .select()
      .from(siteUpdatesTable)
      .where(eq(siteUpdatesTable.id, req.params.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.title !== undefined) {
      patch.title = validateText(req.body.title, "Title", UPDATE_TITLE_MAX, true);
    }
    if (req.body?.body !== undefined) {
      patch.body = validateText(req.body.body, "Body", UPDATE_BODY_MAX, true);
    }
    if (req.body?.version !== undefined) {
      patch.version = validateText(req.body.version, "Version", UPDATE_VERSION_MAX, false);
    }
    const images = validateImages(req.body?.images);

    const [row] = await db
      .update(siteUpdatesTable)
      .set(patch)
      .where(eq(siteUpdatesTable.id, req.params.id))
      .returning();

    if (images) await replaceImages(row.id, images);
    const counts = await imageCounts([row.id]);

    res.json({
      id: row.id,
      version: row.version,
      title: row.title,
      body: row.body,
      published: row.published,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      imageCount: counts.get(row.id) ?? 0,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Update site update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/updates/:id/publish
// انتشار **یک‌بار** اتفاق می‌افتد: دوباره‌زدن روی یک آپدیت منتشرشده ۴۰۰ می‌گیرد،
// وگرنه fan-out دوباره اجرا می‌شد و (اگر dedupeKey هم نبود) هر کاربر اعلان
// تکراری می‌گرفت.
router.post("/admin/updates/:id/publish", requireAdmin, async (req: any, res) => {
  try {
    const [existing] = await db
      .select()
      .from(siteUpdatesTable)
      .where(eq(siteUpdatesTable.id, req.params.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (existing.published) {
      res.status(400).json({ error: "Already published" });
      return;
    }

    const now = new Date();
    const [update] = await db
      .update(siteUpdatesTable)
      .set({ published: true, publishedAt: now, updatedAt: now })
      .where(eq(siteUpdatesTable.id, req.params.id))
      .returning();

    // fan-out: همان الگوی POST /admin/announcements — یک insert دسته‌ای برای
    // همه‌ی کاربران، با dedupeKey مشترک تا retry اعلان تکراری نسازد.
    const recipients = await db.select({ id: usersTable.id }).from(usersTable);
    await createNotificationsBulk(
      recipients.map((u) => u.id),
      {
        type: "site_update",
        severity: "info",
        title: update.title,
        // متن کامل در صفحه‌ی خود آپدیت است؛ اعلان فقط خلاصه را حمل می‌کند.
        message: update.body.slice(0, 500),
        dedupeKey: "site_update:" + update.id,
        refId: update.id,
      },
    );

    res.json({
      id: update.id,
      version: update.version,
      title: update.title,
      body: update.body,
      published: update.published,
      publishedAt: update.publishedAt ? update.publishedAt.toISOString() : null,
      createdAt: update.createdAt.toISOString(),
      notified: recipients.length,
    });
  } catch (err) {
    logger.error({ err }, "Publish update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/updates/:id — آپدیت + عکس‌ها + ردیف‌های seen.
router.delete("/admin/updates/:id", requireAdmin, async (req: any, res) => {
  try {
    await db.delete(siteUpdateImagesTable).where(eq(siteUpdateImagesTable.updateId, req.params.id));
    await db.delete(userUpdateViewsTable).where(eq(userUpdateViewsTable.updateId, req.params.id));
    const deleted = await db
      .delete(siteUpdatesTable)
      .where(eq(siteUpdatesTable.id, req.params.id))
      .returning({ id: siteUpdatesTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { imageCounts, imagesFor };
export type { UpdateListItem };
export default router;
