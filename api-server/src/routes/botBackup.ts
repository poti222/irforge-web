/**
 * routes/botBackup.ts — بک‌آپ و بازیابی کل شیت تننت.
 * ─────────────────────────────────────────────────────────────────────────────
 * شکل بک‌آپ عیناً همان چیزی است که `ap:backup` بات می‌سازد: یک ZIP که برای هر
 * تب یک `<tab>.json` دارد و محتوای هرکدام یک dict «کلید → مقدار» است.
 *
 * ZIP بدون هیچ کتابخانه‌ی خارجی ساخته و خوانده می‌شود (فقط `node:zlib`):
 * افزودن یک dependency به کل سرور برای یک اندپوینت، بهایی است که لازم نیست.
 * فقط متد `deflate` و `store` پشتیبانی می‌شوند — همان چیزی که هر ZIPِ ساخته‌شده
 * توسط این اندپوینت یا پایتون تولید می‌کند.
 */
import { Router } from "express";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { requireAuth } from "./auth.js";
import { listTabs } from "../lib/tenantSheets.js";
import {
  resolveBotSheet,
  listEntity,
  putEntities,
  bustTabs,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";

const router = Router();

const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);

/** سقف حجم فایل بازیابی — بدنه‌ی JSON سرور ۱۰MB است. */
const MAX_RESTORE_BYTES = 7 * 1024 * 1024;

// ─── ZIP نویس (فقط چیزی که لازم داریم) ──────────────────────────────────────

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

export async function buildZip(files: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const compressed = await deflateRaw(file.data);
    const sum = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // relative offset of the local header
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

/** خواندن ZIP از روی local headerها — بدون central directory، کافی است. */
export async function readZip(buf: Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  const out: Array<{ name: string; data: Buffer }> = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const flags = buf.readUInt16LE(i + 6);
    let compressedSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const dataStart = i + 30 + nameLen + extraLen;

    // بیت ۳ یعنی اندازه‌ها در data descriptor بعد از داده آمده‌اند. آن حالت
    // بدون central directory قابل اتکا نیست، پس صریح رد می‌شود.
    if (flags & 0x08)
      throw new BotConfigError(400, "این فایل ZIP با حالتی فشرده شده که پشتیبانی نمی‌شود.", "unsupported_zip");
    if (dataStart + compressedSize > buf.length)
      throw new BotConfigError(400, "فایل ZIP ناقص یا خراب است.", "bad_zip");

    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : Buffer.from(await inflateRaw(raw));
    out.push({ name, data });
    i = dataStart + compressedSize;
  }
  if (out.length === 0) throw new BotConfigError(400, "هیچ فایلی داخل این ZIP پیدا نشد.", "empty_zip");
  return out;
}

/**
 * نام فایل مجاز: فقط `<tab>.json` بدون مسیر. این هم zip-slip را می‌بندد و هم
 * هر چیزی که JSON نیست را بیرون می‌گذارد.
 */
export function tabNameFromEntry(name: string): string | null {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (!name.toLowerCase().endsWith(".json")) return null;
  const tab = name.slice(0, -5);
  return tab.length > 0 && tab.length <= 100 ? tab : null;
}

// ─── GET /api/bots/:botId/backup ────────────────────────────────────────────

router.get("/bots/:botId/backup", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId, botName } = await resolveBotSheet(req.userId, req.params.botId);
    const tabs = await listTabs(spreadsheetId);

    const files: Array<{ name: string; data: Buffer }> = [];
    for (const tab of tabs) {
      let payload: Record<string, unknown> = {};
      try {
        const rows = await listEntity(spreadsheetId, tab);
        for (const row of rows) payload[row.key] = row.value;
      } catch {
        // یک تب خوانده‌نشده نباید کل بک‌آپ را از بین ببرد — خالی ثبت می‌شود.
        payload = {};
      }
      files.push({ name: `${tab}.json`, data: Buffer.from(JSON.stringify(payload, null, 2), "utf8") });
    }

    const zip = await buildZip(files);
    const stamp = new Date().toISOString().slice(0, 10);
    // نام فایل ASCII نگه داشته می‌شود؛ نام بات ممکن است فارسی باشد و در هدر
    // Content-Disposition دردسر می‌سازد.
    const safeName = String(req.params.botId).replace(/[^a-zA-Z0-9_-]/g, "");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="irforge-backup-${safeName}-${stamp}.zip"`);
    res.setHeader("X-Bot-Name", encodeURIComponent(botName));
    res.end(zip);
  } catch (err) {
    sendBotConfigError(res, err, "Failed to build backup");
  }
});

// ─── POST /api/bots/:botId/restore ──────────────────────────────────────────

type RestorePlan = Array<{ tab: string; added: number; replaced: number; unchanged: number; total: number }>;

async function planRestore(
  spreadsheetId: string,
  entries: Array<{ tab: string; rows: Record<string, unknown> }>,
  mode: "merge" | "replace"
): Promise<RestorePlan> {
  const plan: RestorePlan = [];
  for (const entry of entries) {
    let current: Record<string, unknown> = {};
    try {
      for (const row of await listEntity(spreadsheetId, entry.tab)) current[row.key] = row.value;
    } catch {
      current = {};
    }
    let added = 0;
    let replaced = 0;
    let unchanged = 0;
    for (const [key, value] of Object.entries(entry.rows)) {
      if (!(key in current)) added += 1;
      else if (JSON.stringify(current[key]) !== JSON.stringify(value)) replaced += 1;
      else unchanged += 1;
    }
    plan.push({
      tab: entry.tab,
      added,
      replaced,
      unchanged,
      // در حالت merge کلیدهایی که فقط روی شیت‌اند دست نمی‌خورند؛ در حالت
      // replace هم پاک نمی‌شوند — فقط بازنویسی می‌شوند. حذف واقعی عمداً
      // انجام نمی‌شود، چون یک restore نباید داده‌ی خارج از بک‌آپ را نابود کند.
      total: Object.keys(entry.rows).length,
    });
  }
  return plan;
}

router.post("/bots/:botId/restore", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId, botName } = await resolveBotSheet(req.userId, req.params.botId);

    const dataUrl = String(req.body?.zip ?? "");
    const match = /^data:[^;]*;base64,(.+)$/s.exec(dataUrl);
    if (!match) throw new BotConfigError(400, "فایل بک‌آپ ارسال نشده یا معتبر نیست.");

    const buf = Buffer.from(match[1], "base64");
    if (buf.length === 0) throw new BotConfigError(400, "فایل بک‌آپ خالی است.");
    if (buf.length > MAX_RESTORE_BYTES)
      throw new BotConfigError(400, `حجم فایل بک‌آپ بیشتر از ${Math.round(MAX_RESTORE_BYTES / 1024 / 1024)} مگابایت است.`);

    const files = await readZip(buf);
    const entries: Array<{ tab: string; rows: Record<string, unknown> }> = [];
    const skipped: string[] = [];

    for (const file of files) {
      const tab = tabNameFromEntry(file.name);
      if (!tab) {
        skipped.push(file.name);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.data.toString("utf8"));
      } catch {
        skipped.push(file.name);
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        skipped.push(file.name);
        continue;
      }
      entries.push({ tab, rows: parsed as Record<string, unknown> });
    }

    if (entries.length === 0)
      throw new BotConfigError(400, "هیچ تب معتبری در این فایل پیدا نشد.", "no_valid_tabs");

    const mode = req.body?.mode === "replace" ? "replace" : "merge";
    const plan = await planRestore(spreadsheetId, entries, mode);

    // پیش‌نمایش اجباری: بدون تأیید صریح، هیچ چیزی نوشته نمی‌شود.
    if (req.body?.confirmName === undefined) {
      res.json({ preview: true, mode, plan, skipped, botName });
      return;
    }
    if (String(req.body.confirmName).trim() !== botName.trim())
      throw new BotConfigError(400, "نام باتی که تایپ کردید با نام واقعی نمی‌خواند.", "name_mismatch");

    await assertSheetsAuthoritative("bot_settings");

    let written = 0;
    for (const entry of entries) {
      const rows = Object.entries(entry.rows).map(([key, value]) => ({ key, value }));
      if (rows.length === 0) continue;
      await putEntities(spreadsheetId, entry.tab, rows);
      written += rows.length;
    }
    // هر تبی که لمس شد باید کشِ بات هم برایش باطل شود، وگرنه بات تا یک دقیقه
    // دیتای قبل از بازیابی را سرو می‌کند.
    await bustTabs(spreadsheetId, entries.map((e) => e.tab));

    res.json({ preview: false, mode, plan, skipped, written, tabs: entries.length });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to restore backup");
  }
});

export default router;
