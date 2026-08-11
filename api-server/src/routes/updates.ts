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
 * بدنه‌ی هر آپدیت یک دنباله‌ی مرتب از بلوک‌هاست (`blocks`، ستون JSONB): متن و
 * عکس، با هر ترتیب و هر تعداد. عکس‌ها data-URL بیس‌۶۴اند — همان الگوی رسید
 * کیف پول. لیست‌ها هیچ‌وقت بدنه را حمل نمی‌کنند، فقط `blockCount`.
 *
 * ستون `body` و جدول `site_update_images` منسوخ‌اند و یک نسخه نگه داشته
 * می‌شوند تا برگشت به عقب ممکن باشد (به PROGRESS.md نگاه کن).
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  siteUpdatesTable,
  siteUpdateImagesTable,
  type UpdateBlock,
  userUpdateViewsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { logger } from "../lib/logger";
import { createNotificationsBulk } from "../lib/notify";

const router = Router();

/** خروجی مشترک لیست‌ها — هیچ‌وقت بدنه‌ی عکس‌ها را حمل نمی‌کند. */
type UpdateListItem = {
  id: string;
  version: string | null;
  title: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  /** لیست‌ها بدنه‌ی بلوک‌ها را حمل نمی‌کنند — فقط تعدادشان. */
  blockCount: number;
};



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
        blockCount: (u.blocks ?? []).length,
        publishedAt: u.publishedAt ? u.publishedAt.toISOString() : null,
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
        blocks: target.blocks ?? [],
        publishedAt: target.publishedAt ? target.publishedAt.toISOString() : null,
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
      blocks: row.blocks ?? [],
      published: row.published,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
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

const UPDATE_MAX_BLOCKS = 50;
const BLOCK_TEXT_MAX = 8000;
const BLOCK_ALT_MAX = 300;
const BLOCK_CAPTION_MAX = 300;

/**
 * اعتبارسنجی آرایه‌ی بلوک‌ها — **سمت سرور**، نه فقط در ادیتور.
 *
 * یک ستون JSONB که کلاینت هرچه بخواهد در آن می‌ریزد یک سطح حمله است، و این
 * محتوا داخل مودالِ داشبورد **همه‌ی** کاربرها رندر می‌شود. یک ادمین هم
 * زمینه‌ی رندر مورد اعتماد نیست: حسابش می‌تواند دزدیده شود.
 *
 * ── انحراف از بریف، عمدی ──
 * بریف گفته `url` به «مبدأ آپلود خودتان» محدود شود. چنین مبدأیی وجود ندارد:
 * عکس‌ها در این پروژه data-URL بیس‌۶۴ هستند (همان الگوی رسید کیف پول)، نه
 * فایل آپلودشده با آدرس. پس قاعده به چیزی سخت‌گیرانه‌تر ترجمه شد: فقط
 * `data:image/<type>;base64,` با سقف حجم، یا یک مسیر نسبی هم‌مبدأ (`/...`).
 * هر چیز دیگری — `http(s):`، `javascript:`، `//host` — رد می‌شود. data-URL
 * اصلاً درخواست شبکه‌ای تولید نمی‌کند، پس دقیقاً همان خطری که بریف نگرانش
 * بود (مرورگر هر کاربر یک endpoint انتخابیِ مهاجم را fetch کند) بسته است.
 */
function validateBlocks(value: unknown): UpdateBlock[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new ValidationError("blocks must be an array");
  if (value.length > UPDATE_MAX_BLOCKS) {
    throw new ValidationError(`At most ${UPDATE_MAX_BLOCKS} blocks are allowed`);
  }

  const seenIds = new Set<string>();
  return value.map((raw, i) => {
    const n = i + 1;
    if (!raw || typeof raw !== "object") throw new ValidationError(`Block ${n} is malformed`);
    const b = raw as Record<string, unknown>;

    const id = typeof b.id === "string" && b.id.trim() !== "" ? b.id.trim().slice(0, 64) : crypto.randomUUID();
    // Duplicate ids would make the editor's reorder/delete act on the wrong
    // block, so they are rejected rather than quietly de-duplicated.
    if (seenIds.has(id)) throw new ValidationError(`Block ${n} repeats an id`);
    seenIds.add(id);

    if (b.type === "text") {
      if (typeof b.content !== "string") throw new ValidationError(`Block ${n}: content must be a string`);
      const content = b.content.trim();
      if (content === "") throw new ValidationError(`Block ${n} is an empty text block`);
      if (content.length > BLOCK_TEXT_MAX) {
        throw new ValidationError(`Block ${n} is too long (max ${BLOCK_TEXT_MAX} characters)`);
      }
      return { type: "text", id, content };
    }

    if (b.type === "image") {
      if (typeof b.url !== "string" || b.url === "") {
        throw new ValidationError(`Block ${n}: an image is required`);
      }
      const url = validateImageUrl(b.url, n);
      // alt اجباری است، نه «اختیاری با مقدار پیش‌فرض». کاربرِ screen reader از
      // عکس بی‌برچسب هیچ چیزی نمی‌گیرد، و این آپدیت‌ها تنها کانالی هستند که به
      // همه‌ی کاربرها می‌رسند.
      if (typeof b.alt !== "string" || b.alt.trim() === "") {
        throw new ValidationError(`Block ${n}: alt text is required for images`);
      }
      const alt = b.alt.trim().slice(0, BLOCK_ALT_MAX);
      const captionRaw = typeof b.caption === "string" ? b.caption.trim() : "";
      const caption = captionRaw === "" ? undefined : captionRaw.slice(0, BLOCK_CAPTION_MAX);
      return caption ? { type: "image", id, url, alt, caption } : { type: "image", id, url, alt };
    }

    throw new ValidationError(`Block ${n} has an unknown type`);
  });
}

/** data:image/... با سقف حجم، یا یک مسیر نسبی هم‌مبدأ. هیچ چیز دیگر. */
function validateImageUrl(raw: string, n: number): string {
  if (raw.startsWith("data:image/")) {
    if (!raw.includes(";base64,")) {
      throw new ValidationError(`Block ${n}: image must be a base64 data URL`);
    }
    const b64 = raw.slice(raw.indexOf(";base64,") + 8);
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > UPDATE_MAX_IMAGE_BYTES) {
      throw new ValidationError(
        `Block ${n}: image is too large (${Math.round(bytes / 1024)}KB, max ${UPDATE_MAX_IMAGE_BYTES / 1024}KB)`,
      );
    }
    return raw;
  }
  // `//evil.example` is protocol-relative and would leave the origin, so a
  // single leading slash is required and a second one rejected.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.slice(0, 2048);
  throw new ValidationError(`Block ${n}: image must be an uploaded image, not an external link`);
}

/**
 * متن بلوک‌ها به‌هم‌چسبیده، برای ستون منسوخ `body`.
 *
 * `body` هنوز NOT NULL است و یک نسخه نگه داشته می‌شود تا برگشت به عقب ممکن
 * باشد؛ پرکردنش با متن واقعی یعنی اگر کدی به نسخه‌ی قبل برگردد، آپدیت را
 * خالی نمی‌بیند.
 */
function blocksToBody(blocks: UpdateBlock[]): string {
  return blocks
    .filter((b): b is Extract<UpdateBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.content)
    .join("\n\n");
}

/** شکل قدیمی (body + images) → بلوک‌ها، با همان ترتیبی که قبلاً رندر می‌شد. */
function legacyToBlocks(body: string | null, images: string[], title: string): UpdateBlock[] {
  const out: UpdateBlock[] = [];
  if (body && body.trim() !== "") out.push({ type: "text", id: crypto.randomUUID(), content: body.trim() });
  for (const url of images) out.push({ type: "image", id: crypto.randomUUID(), url, alt: title });
  return out;
}


// GET /api/admin/updates — پیش‌نویس‌ها و منتشرشده‌ها با هم.
router.get("/admin/updates", requireAdmin, async (_req: any, res) => {
  try {
    const rows = await db
      .select()
      .from(siteUpdatesTable)
      .orderBy(desc(siteUpdatesTable.createdAt));
    res.json(
      rows.map((u) => ({
        id: u.id,
        version: u.version,
        title: u.title,
        blockCount: (u.blocks ?? []).length,
        published: u.published,
        publishedAt: u.publishedAt ? u.publishedAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
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
    const version = validateText(req.body?.version, "Version", UPDATE_VERSION_MAX, false);
    // `blocks` is the body now. `body`/`images` are still accepted so an older
    // client mid-deploy doesn't 400, and are converted to blocks.
    const blocks =
      validateBlocks(req.body?.blocks) ??
      legacyToBlocks(
        validateText(req.body?.body, "Body", UPDATE_BODY_MAX, false),
        validateImages(req.body?.images) ?? [],
        title,
      );
    if (blocks.length === 0) throw new ValidationError("An update needs at least one block");

    const [row] = await db
      .insert(siteUpdatesTable)
      .values({
        id: crypto.randomUUID(),
        version,
        title,
        body: blocksToBody(blocks),
        blocks,
        published: false,
        createdBy: req.userId,
      })
      .returning();

    res.status(201).json({
      id: row.id,
      version: row.version,
      title: row.title,
      blocks: row.blocks,
      published: row.published,
      publishedAt: null,
      createdAt: row.createdAt.toISOString(),
      blockCount: blocks.length,
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
    if (req.body?.version !== undefined) {
      patch.version = validateText(req.body.version, "Version", UPDATE_VERSION_MAX, false);
    }
    const blocks = validateBlocks(req.body?.blocks);
    if (blocks) {
      if (blocks.length === 0) throw new ValidationError("An update needs at least one block");
      patch.blocks = blocks;
      patch.body = blocksToBody(blocks);
    }

    const [row] = await db
      .update(siteUpdatesTable)
      .set(patch)
      .where(eq(siteUpdatesTable.id, req.params.id))
      .returning();

    res.json({
      id: row.id,
      version: row.version,
      title: row.title,
      blocks: row.blocks,
      published: row.published,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      blockCount: (row.blocks ?? []).length,
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
    // جدول عکس‌ها منسوخ است ولی هنوز وجود دارد (برای برگشت‌پذیری مایگریشن)،
    // پس ردیف‌های قدیمی همچنان اینجا پاک می‌شوند تا یتیم نمانند.
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

export type { UpdateListItem };
export default router;
