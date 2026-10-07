/**
 * lib/schoolBotPhoto.ts — عکسِ مدرسه ← عکسِ پروفایلِ باتِ تلگرام (setMyProfilePhoto، فقط JPG).
 * ─────────────────────────────────────────────────────────────────────────
 * منبع‌ها: (۱) JPEGِ تبدیل‌شده در مرورگرِ مدیر (`school_bots.photo_jpeg_image_id`، فقط اگر هنوز برایِ همان
 * photoUrlِ فعلیِ مدرسه ساخته شده)، (۲) آپلودِ داخلیِ سایت `/api/uploads/images/<uuid>`، (۳) URLِ http(s) با
 * محافظِ SSRF. JPEG مستقیم رد می‌شود، PNG سمتِ سرور تبدیل می‌شود (pngjs+jpeg-js، بدونِ وابستگیِ native).
 * WebP/GIF (سایت عکس‌ها را معمولاً WebP ذخیره می‌کند) سمتِ سرور decode نمی‌شود → status="needs_jpeg" و کارتِ مدیر
 * در مرورگر به JPEG تبدیل و به POST /schools/:id/bot/photo می‌فرستد.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { eq } from "drizzle-orm";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { db, uploadedImagesTable } from "@workspace/db";
import { tgSetProfilePhoto } from "./telegram";
import { logger } from "./logger";

export type PhotoSyncResult = {
  status: "none" | "set" | "needs_jpeg" | "failed" | "unsafe_url";
  message: string;
};

const MAX_BYTES = 8 * 1024 * 1024;
const UPLOAD_RE = /^\/api\/uploads\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function sniff(b: Buffer): "jpeg" | "png" | "webp" | "gif" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 6 && /^GIF8[79]a/.test(b.subarray(0, 6).toString("latin1"))) return "gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** PNG → JPEG (آلفا روی سفید). null اگر قابلِ‌تبدیل نبود. */
export function pngToJpeg(buf: Buffer): Buffer | null {
  try {
    const png = PNG.sync.read(buf);
    const { width, height, data } = png;
    if (width * height > 4096 * 4096) return null;
    const out = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const a = data[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(data[i * 4 + c] * a + 255 * (1 - a));
      out[i * 4 + 3] = 255;
    }
    return Buffer.from(jpeg.encode({ data: out, width, height }, 90).data);
  } catch {
    return null;
  }
}

/** آدرسِ داخلی/خصوصی؟ (SSRF) */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l === "::1" || l === "::" || l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd")) return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
  return m ? isPrivateIp(m[1]) : false;
}

async function assertPublicHost(u: URL): Promise<boolean> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return !isPrivateIp(host);
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** دانلودِ امنِ URLِ بیرونی: فقط http(s)، IPِ عمومی، حداکثر ۳ ریدایرکت (هر کدام دوباره چک)، ۸ ثانیه، ۸MB. */
export async function safeFetchImage(url: string): Promise<{ buf: Buffer } | { error: "unsafe" | "failed" }> {
  let cur: URL;
  try { cur = new URL(url); } catch { return { error: "failed" }; }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(cur.protocol) || !(await assertPublicHost(cur))) return { error: "unsafe" };
    try {
      const res = await fetch(cur, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        cur = new URL(res.headers.get("location")!, cur);
        continue;
      }
      if (!res.ok) return { error: "failed" };
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) return { error: "failed" };
      const chunks: Buffer[] = []; let total = 0;
      for await (const c of res.body as any) { total += c.length; if (total > MAX_BYTES) return { error: "failed" }; chunks.push(Buffer.from(c)); }
      return { buf: Buffer.concat(chunks) };
    } catch {
      return { error: "failed" };
    }
  }
  return { error: "failed" };
}

export async function readUploadedImage(id: string): Promise<Buffer | null> {
  const [row] = await db.select({ data: uploadedImagesTable.data }).from(uploadedImagesTable).where(eq(uploadedImagesTable.id, id)).limit(1);
  return row ? Buffer.from(row.data as any) : null;
}

/**
 * بایت‌هایِ JPEGِ آمادهٔ ارسال برایِ photoUrl، یا دلیلِ نشدن. `preferredJpegImageId` فقط وقتی استفاده می‌شود که
 * فراخوان تأیید کرده با photoUrlِ فعلی همخوان است.
 */
export async function schoolPhotoJpeg(photoUrl: string | null, preferredJpegImageId?: string | null): Promise<{ jpeg: Buffer } | { status: PhotoSyncResult["status"]; message: string }> {
  if (preferredJpegImageId) {
    const b = await readUploadedImage(preferredJpegImageId);
    if (b && sniff(b) === "jpeg") return { jpeg: b };
  }
  if (!photoUrl) return { status: "none", message: "برایِ مدرسه عکسی ثبت نشده است." };
  let raw: Buffer | null = null;
  const m = UPLOAD_RE.exec(photoUrl);
  if (m) raw = await readUploadedImage(m[1]);
  else if (/^https?:\/\//i.test(photoUrl)) {
    const r = await safeFetchImage(photoUrl);
    if ("error" in r) return r.error === "unsafe"
      ? { status: "unsafe_url", message: "آدرسِ عکسِ مدرسه امن/عمومی نیست و دانلود نشد." }
      : { status: "failed", message: "عکسِ مدرسه از آدرسِ ثبت‌شده دانلود نشد." };
    raw = r.buf;
  }
  if (!raw) return { status: "failed", message: "فایلِ عکسِ مدرسه پیدا نشد." };
  const kind = sniff(raw);
  if (kind === "jpeg") return { jpeg: raw };
  if (kind === "png") {
    const j = pngToJpeg(raw);
    return j ? { jpeg: j } : { status: "failed", message: "تبدیلِ عکس به JPEG ناموفق بود." };
  }
  if (kind === "webp" || kind === "gif") return { status: "needs_jpeg", message: "عکسِ مدرسه WebP/GIF است؛ تلگرام فقط JPG می‌پذیرد. از کارتِ مدیر «بروزرسانی بات» را بزنید تا مرورگر آن را تبدیل کند." };
  return { status: "failed", message: "قالبِ عکس شناخته نشد." };
}

export async function syncSchoolBotPhoto(token: string, photoUrl: string | null, preferredJpegImageId?: string | null): Promise<PhotoSyncResult> {
  const r = await schoolPhotoJpeg(photoUrl, preferredJpegImageId);
  if ("status" in r) return { status: r.status, message: r.message };
  try {
    const out = await tgSetProfilePhoto(token, r.jpeg, "image/jpeg", "static");
    if (out.ok) return { status: "set", message: "عکسِ پروفایلِ بات با عکسِ مدرسه ست شد." };
    logger.warn({ description: out.description }, "school bot setMyProfilePhoto not ok");
    return { status: "failed", message: out.description ?? "تلگرام عکس را نپذیرفت." };
  } catch (err) {
    logger.warn({ err }, "school bot setMyProfilePhoto threw");
    return { status: "failed", message: "ارتباط با تلگرام برقرار نشد." };
  }
}
