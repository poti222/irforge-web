/**
 * routes/uploads.ts — آپلودِ تصویرِ self-hosted (در Postgres، جدولِ uploaded_images).
 * ─────────────────────────────────────────────────────────────────────────
 * POST /api/uploads/images   (احرازِ هویت + محدودیتِ per-user)
 *   بدنه: خامِ `image/*` (Content-Type = jpeg/png/webp/gif) — نه JSON/base64: parserِ سراسریِ JSON سقفِ ۲۵۶KB دارد
 *   و base64 هم ۳۳٪ باد می‌کند؛ express.raw فقط همین مسیر را تا ۲٫۵MB باز می‌کند، بدونِ دست‌زدن به سقفِ بقیه‌یِ API.
 *   نوعِ واقعی از «بایت‌هایِ جادویی» تشخیص داده می‌شود، نه از هدرِ کلاینت؛ SVG/هر چیزِ دیگر رد می‌شود
 *   (SVG می‌تواند اسکریپت داشته باشد).
 *   پاسخ: { url: "/api/uploads/images/<uuid>" }
 * GET /api/uploads/images/:id (عمومی: برایِ <img>)؛ uuid حدس‌ناپذیر است. immutable + ETag/304 + nosniff.
 *
 * اگر روزی باکتِ Railway/S3 آمد، فقط بدنه‌یِ این دو handler عوض می‌شود؛ قراردادِ URL و ستون‌هایِ مصرف‌کننده نه.
 */
import { Router } from "express";
import express from "express";
import crypto from "crypto";
import { db, uploadedImagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { perUserRateLimit } from "../middleware/rateLimit";
import { logger } from "../lib/logger";

const router = Router();

export const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** نوعِ واقعیِ تصویر از بایت‌هایِ ابتدایی؛ null = مجاز نیست. */
export function sniffImageMime(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

router.post(
  "/uploads/images",
  requireAuth,
  // ۳۰ آپلود در ۱۵ دقیقه برایِ هر کاربر — فرمِ معمولی چند عکس در دقیقه هم نمی‌فرستد.
  perUserRateLimit("image_upload", 30),
  (req: any, res, next) => {
    const ct = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!ct.startsWith("image/")) {
      res.status(415).json({ error: "Content-Type must be image/*", code: "unsupported_media_type" });
      return;
    }
    rawImage(req, res, (err?: any) => {
      if (err) {
        if (err.type === "entity.too.large" || err.status === 413) {
          res.status(413).json({ error: "تصویر بزرگ‌تر از ۲٫۵ مگابایت است.", code: "image_too_large" });
          return;
        }
        res.status(400).json({ error: "Invalid body", code: "invalid_body" });
        return;
      }
      next();
    });
  },
  async (req: any, res) => {
    try {
      const body: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : undefined;
      if (!body || body.length === 0) {
        res.status(400).json({ error: "Empty body", code: "empty_body" });
        return;
      }
      if (body.length > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: "تصویر بزرگ‌تر از ۲٫۵ مگابایت است.", code: "image_too_large" });
        return;
      }
      const mime = sniffImageMime(body);
      if (!mime) {
        res.status(415).json({ error: "فقط تصویرِ JPEG، PNG، WebP یا GIF مجاز است.", code: "unsupported_image_type" });
        return;
      }
      const id = crypto.randomUUID();
      await db.insert(uploadedImagesTable).values({ id, uploadedByUserId: req.userId, mime, byteSize: body.length, data: body });
      res.status(201).json({ url: `/api/uploads/images/${id}` });
    } catch (err) {
      logger.error({ err }, "Image upload error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/uploads/images/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) { res.status(404).end(); return; }
    const [row] = await db.select().from(uploadedImagesTable).where(eq(uploadedImagesTable.id, id)).limit(1);
    if (!row) { res.status(404).end(); return; }
    const etag = `"${id}"`; // محتوا هرگز تغییر نمی‌کند (هر آپلود uuidِ تازه)
    res.set({
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
      // تصویر را هر originی (مثلاً پیش‌نمایشِ بات/ایمیل) می‌تواند بگیرد؛ helmet پیش‌فرضش same-origin است.
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    if (req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
    res.send(row.data);
  } catch (err) {
    logger.error({ err }, "Image fetch error");
    res.status(500).end();
  }
});

export default router;
