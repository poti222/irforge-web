/**
 * lib/emojiPacks.ts — کتابخانه‌ی پک‌های ایموجیِ سفارشیِ پلتفرم.
 * ─────────────────────────────────────────────────────────────────────────────
 * فایل‌هایِ آماده (PNG 100×100 / WEBM) و `manifest.json` در `api-server/assets/emoji-packs/` هستند.
 * ادمین از /super دکمه‌ی «ساخت در تلگرام» را می‌زند؛ بات پلتفرم (`TELEGRAM_BOT_TOKEN`) با
 * `createNewStickerSet` (sticker_type=custom_emoji) پک را به نامِ ادمین می‌سازد و `custom_emoji_id`ها
 * ذخیره می‌شوند. کاربر پک را با یک کلیک به باتِ خودش اضافه می‌کند (routes/botCustomEmoji.ts).
 *
 * قوانینِ تلگرام: نامِ پک باید به `_by_<username بات>` ختم شود؛ مالکِ پک یک کاربرِ واقعی است و باید
 * قبلاً بات را Start کرده باشد؛ هر پک فقط یک فرمت (static یا video) — برای همین تیک‌های متحرک پکِ جدا هستند.
 */
import fs from "node:fs";
import path from "node:path";
import { db, emojiPacksTable, type EmojiPackSticker } from "@workspace/db";
import { eq } from "drizzle-orm";
import { telegramApiBase } from "./telegram.js";
import { logger } from "./logger.js";

export class EmojiPackError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface ManifestSticker { name: string; file: string; format: "static" | "video"; emoji: string }
interface ManifestPack { slug: string; titleFa: string; titleEn: string; tgBase: string; stickers: ManifestSticker[] }

function assetsDir(): string {
  const candidates = [
    process.env.EMOJI_PACKS_DIR,
    path.resolve(process.cwd(), "api-server/assets/emoji-packs"),
    path.resolve(process.cwd(), "assets/emoji-packs"),
    "/app/api-server/assets/emoji-packs",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(path.join(c, "manifest.json"))) return c;
  throw new EmojiPackError(500, "فایل‌های آماده‌ی پک‌های ایموجی روی سرور پیدا نشد (api-server/assets/emoji-packs)");
}

export function loadManifest(): ManifestPack[] {
  const dir = assetsDir();
  return (JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { packs: ManifestPack[] }).packs;
}

/** پک‌هایِ manifest را (اگر نیستند) به DB اضافه می‌کند؛ قیمت/فعال‌بودنِ دستکاری‌شده را دست نمی‌زند. */
export async function ensureSeeded(): Promise<void> {
  const packs = loadManifest();
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i]!;
    const stickers: EmojiPackSticker[] = p.stickers.map((s) => ({ name: s.name, emoji: s.emoji, id: null, animated: s.format === "video" }));
    await db
      .insert(emojiPacksTable)
      .values({ slug: p.slug, titleFa: p.titleFa, titleEn: p.titleEn, priceToman: 0, active: true, sortOrder: i, stickers })
      .onConflictDoNothing();
  }
}

// ─── Telegram ───────────────────────────────────────────────────────────────

function platformToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!t) throw new EmojiPackError(503, "TELEGRAM_BOT_TOKEN روی سرویس تنظیم نشده؛ بات پلتفرم در دسترس نیست");
  return t;
}

async function tg<T = any>(token: string, method: string, body?: FormData | Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`${telegramApiBase()}/bot${token}/${method}`, {
    method: "POST",
    headers: isForm || !body ? undefined : { "Content-Type": "application/json" },
    body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });
  try {
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch {
    return { ok: false, description: `پاسخِ نامعتبر از تلگرام (HTTP ${res.status})` };
  }
}

/** نامِ پک در تلگرام: `<base>_by_<username>` (فقط a-z0-9_، بدونِ __ پشتِ‌هم، حداکثر ۶۴). */
export function tgSetNameFor(base: string, botUsername: string): string {
  const name = `${base}_by_${botUsername}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  return name.slice(0, 64);
}

interface TgSticker { custom_emoji_id?: string; emoji?: string; is_video?: boolean; is_animated?: boolean }

async function readSet(token: string, name: string) {
  return tg<{ sticker_type?: string; stickers?: TgSticker[] }>(token, "getStickerSet", { name });
}

function applyIds(current: EmojiPackSticker[], tgStickers: TgSticker[]): EmojiPackSticker[] {
  if (tgStickers.length !== current.length) {
    throw new EmojiPackError(502, `تعدادِ ایموجی‌هایِ پکِ تلگرام (${tgStickers.length}) با تعدادِ ما (${current.length}) نمی‌خواند`);
  }
  return current.map((s, i) => ({ ...s, id: tgStickers[i]!.custom_emoji_id ?? null }));
}

/**
 * پک را با بات پلتفرم در تلگرام می‌سازد (یا اگر قبلاً ساخته شده فقط شناسه‌ها را همگام می‌کند).
 * @param ownerTelegramId شناسه‌ی عددیِ تلگرامِ مالکِ پک (باید بات پلتفرم را Start کرده باشد)
 */
export async function createPackInTelegram(slug: string, ownerTelegramId: string): Promise<{ setName: string; count: number; created: boolean }> {
  if (!/^\d{4,15}$/.test(ownerTelegramId)) throw new EmojiPackError(400, "شناسه‌ی تلگرامِ مالک نامعتبر است");
  const manifest = loadManifest().find((p) => p.slug === slug);
  if (!manifest) throw new EmojiPackError(404, "پک در manifest نیست");
  const [row] = await db.select().from(emojiPacksTable).where(eq(emojiPacksTable.slug, slug)).limit(1);
  if (!row) throw new EmojiPackError(404, "پک در دیتابیس نیست؛ یک بار صفحه را تازه کن");

  const token = platformToken();
  const me = await tg<{ username?: string }>(token, "getMe");
  if (!me.ok || !me.result?.username) throw new EmojiPackError(502, `getMe ناموفق: ${me.description ?? "نامشخص"}`);
  const setName = tgSetNameFor(manifest.tgBase, me.result.username);

  // اگر قبلاً ساخته شده، فقط همگام کن.
  const existing = await readSet(token, setName);
  if (existing.ok && existing.result) {
    if (existing.result.sticker_type !== "custom_emoji") throw new EmojiPackError(409, `پکی با نامِ ${setName} هست ولی ایموجیِ سفارشی نیست`);
    const stickers = applyIds(row.stickers, existing.result.stickers ?? []);
    await db.update(emojiPacksTable).set({ tgSetName: setName, stickers, updatedAt: new Date() }).where(eq(emojiPacksTable.slug, slug));
    return { setName, count: stickers.length, created: false };
  }

  const dir = assetsDir();
  const form = new FormData();
  form.set("user_id", ownerTelegramId);
  form.set("name", setName);
  form.set("title", manifest.titleEn ? `${manifest.titleEn} · IrForge` : manifest.titleFa);
  form.set("sticker_type", "custom_emoji");
  const inputs: Array<Record<string, unknown>> = [];
  manifest.stickers.forEach((s, i) => {
    const file = path.join(dir, manifest.slug, s.file);
    if (!fs.existsSync(file)) throw new EmojiPackError(500, `فایلِ ${s.file} در assets نیست`);
    form.set(`f${i}`, new Blob([fs.readFileSync(file)], { type: s.format === "video" ? "video/webm" : "image/png" }), s.file);
    inputs.push({ sticker: `attach://f${i}`, format: s.format, emoji_list: [s.emoji] });
  });
  form.set("stickers", JSON.stringify(inputs));

  const created = await tg(token, "createNewStickerSet", form);
  if (!created.ok) {
    let msg = created.description ?? "ساخت پک ناموفق بود";
    if (/user not found|PEER_ID_INVALID|chat not found/i.test(msg)) msg += " — مالکِ پک باید اول بات پلتفرم را در تلگرام Start کرده باشد";
    throw new EmojiPackError(502, msg);
  }
  const after = await readSet(token, setName);
  if (!after.ok || !after.result) throw new EmojiPackError(502, `پک ساخته شد ولی خواندنش ناموفق بود: ${after.description ?? "نامشخص"}`);
  const stickers = applyIds(row.stickers, after.result.stickers ?? []);
  await db.update(emojiPacksTable).set({ tgSetName: setName, stickers, updatedAt: new Date() }).where(eq(emojiPacksTable.slug, slug));
  logger.info({ slug, setName, count: stickers.length }, "emoji pack created in Telegram");
  return { setName, count: stickers.length, created: true };
}
