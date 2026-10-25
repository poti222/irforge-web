/**
 * routes/botCustomEmoji.ts — کاتالوگِ ایموجیِ سفارشی/متحرکِ تلگرام
 * ─────────────────────────────────────────────────────────────────────────────
 * ادمین اینجا ایموجی‌ها را مدیریت می‌کند (`bot_settings.custom_emojis`) و در هر متنی `:name:` می‌نویسد؛ بات قبل از
 * ارسال آن را به `<tg-emoji>` تبدیل می‌کند (`utils/emoji_session.py`).
 *
 *   GET  /bots/:botId/custom-emojis              → { emojis[] }
 *   PUT  /bots/:botId/custom-emojis              → کلِ لیست را جایگزین می‌کند (اعتبارسنجی سمتِ سرور)
 *   POST /bots/:botId/custom-emojis/import-pack  → { pack } یا { packs[] }؛ از t.me/addemoji/NAME یا خودِ نام
 *   POST /bots/:botId/custom-emojis/import-ids   → { ids[] } شناسه‌هایِ خام (getCustomEmojiStickers)
 *
 * محدودیتِ تلگرام: ایموجیِ سفارشی فقط برایِ باتی که یوزرنیمِ اضافه از Fragment خریده (یا پیامِ مستقیمِ بات‌ی که صاحبش
 * Premium دارد) نمایش داده می‌شود؛ وگرنه ایموجیِ معمولیِ `fallback` دیده می‌شود و پیام سالم می‌ماند.
 */
import { Router } from "express";
import { db, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi } from "../lib/telegram.js";
import { resolveBotSheet, readSettings, patchSettings, sendBotConfigError, BotConfigError } from "../lib/botConfig.js";
import type { CustomEmojiEntry } from "../lib/botTypes.js";
import { emojiPacksTable } from "@workspace/db";
import { ensureSeeded } from "../lib/emojiPacks.js";
import { chargeForPack } from "../lib/emojiPackPurchase.js";
import { createNotification, formatTomanFa } from "../lib/notify.js";
import { logger } from "../lib/logger.js";

const router = Router();
const MAX_EMOJIS = 2000;
const NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;
const ID_RE = /^\d{5,32}$/;

const bad = (message: string, code?: string) => new BotConfigError(400, message, code);

function cleanList(raw: unknown): CustomEmojiEntry[] {
  if (!Array.isArray(raw)) throw bad("«emojis» باید یک آرایه باشد.");
  const out: CustomEmojiEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = String(r.name ?? "").trim().toLowerCase();
    const id = String(r.id ?? "").trim();
    if (!NAME_RE.test(name)) throw bad(`نامِ «${name}» معتبر نیست؛ فقط حروفِ لاتین کوچک، عدد و _ (۲ تا ۳۲ کاراکتر، شروع با حرف).`);
    if (!ID_RE.test(id)) throw bad(`شناسه‌یِ ایموجیِ «${name}» معتبر نیست.`);
    if (seen.has(name)) throw bad(`نامِ «${name}» تکراری است.`);
    seen.add(name);
    out.push({
      name, id,
      fallback: String(r.fallback ?? "").trim().slice(0, 8) || "⭐",
      animated: r.animated !== false,
      enabled: r.enabled !== false,
      pack: String(r.pack ?? "").slice(0, 64),
    });
  }
  if (out.length > MAX_EMOJIS) throw bad(`حداکثر ${MAX_EMOJIS} ایموجی مجاز است.`);
  return out;
}

async function tokenFor(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    const t = decryptToken(bot?.token ?? "");
    if (t) return t;
  } catch { /* افتاد پایین */ }
  throw new BotConfigError(409, "توکنِ این بات روی سرور در دسترس نیست.", "no_token");
}

function packName(input: string): string {
  const s = input.trim().replace(/^https?:\/\/t\.me\/(addemoji|addstickers)\//i, "").replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,64}$/.test(s) ? s : "";
}

async function current(spreadsheetId: string): Promise<CustomEmojiEntry[]> {
  const s = (await readSettings(spreadsheetId)) as unknown as Record<string, unknown>;
  try { return cleanList(s.custom_emojis ?? []); } catch { return []; }
}

/** نامِ یکتا برایِ ایموجیِ واردشده: `<prefix>_<n>` که با موجودها برخورد نکند. */
function uniqueName(prefix: string, taken: Set<string>, start: number): [string, number] {
  let n = start;
  let name = `${prefix}_${n}`;
  while (taken.has(name)) name = `${prefix}_${++n}`;
  taken.add(name);
  return [name, n + 1];
}

router.get("/bots/:botId/custom-emojis", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    res.json({ emojis: await current(spreadsheetId) });
  } catch (err) { sendBotConfigError(res, err, "Failed to read custom emojis"); }
});

router.put("/bots/:botId/custom-emojis", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const emojis = cleanList(req.body?.emojis);
    await patchSettings(spreadsheetId, { custom_emojis: emojis } as Record<string, unknown>);
    res.json({ emojis });
  } catch (err) { sendBotConfigError(res, err, "Failed to save custom emojis"); }
});

router.post("/bots/:botId/custom-emojis/import-pack", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const inputs: string[] = (Array.isArray(req.body?.packs) ? req.body.packs : [req.body?.pack]).map((p: unknown) => String(p ?? ""));
    const names = [...new Set(inputs.map(packName).filter(Boolean))].slice(0, 20);
    if (!names.length) throw bad("نامِ پک یا لینکِ t.me/addemoji/… را وارد کنید.");
    const token = await tokenFor(req.params.botId);
    const list = await current(spreadsheetId);
    const taken = new Set(list.map((e) => e.name));
    const usedIds = new Set(list.map((e) => e.id));
    const report: Array<{ pack: string; added: number; error?: string }> = [];
    for (const pack of names) {
      const r = await tgApi<{ sticker_type?: string; stickers?: Array<{ custom_emoji_id?: string; emoji?: string; is_animated?: boolean; is_video?: boolean }> }>(token, "getStickerSet", { name: pack });
      if (!r.ok || !r.result) { report.push({ pack, added: 0, error: r.description ?? "پک پیدا نشد" }); continue; }
      if (r.result.sticker_type !== "custom_emoji") { report.push({ pack, added: 0, error: "این پک ایموجیِ سفارشی نیست (استیکر است)" }); continue; }
      const prefix = pack.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "e$1").slice(0, 24) || "emoji";
      let n = 1, added = 0;
      for (const st of r.result.stickers ?? []) {
        if (!st.custom_emoji_id || usedIds.has(st.custom_emoji_id) || list.length >= MAX_EMOJIS) continue;
        let name: string;
        [name, n] = uniqueName(prefix, taken, n);
        usedIds.add(st.custom_emoji_id);
        list.push({ name, id: st.custom_emoji_id, fallback: st.emoji || "⭐", animated: Boolean(st.is_animated || st.is_video), enabled: true, pack: pack.slice(0, 64) });
        added++;
      }
      report.push({ pack, added });
    }
    await patchSettings(spreadsheetId, { custom_emojis: list } as Record<string, unknown>);
    res.json({ emojis: list, report });
  } catch (err) { sendBotConfigError(res, err, "Failed to import emoji pack"); }
});

/**
 * اضافه‌کردنِ یک پکِ کتابخانه‌ی پلتفرم به همین بات.  { slug }
 * رایگان (`price_toman = 0`) یا قبلاً-خریده‌شده برایِ همین بات یا سوپرادمین: بلافاصله اضافه می‌شود.
 * پولی: قیمت از کیف‌پولِ کاربر کم و خرید برایِ همین بات ثبت می‌شود (lib/emojiPackPurchase.ts)؛ موجودیِ ناکافی ⇒ ۴۰۲.
 * بدونِ تماس با تلگرام: شناسه‌هایِ ایموجی هنگامِ «ساخت در تلگرام» ذخیره شده‌اند.
 */
router.post("/bots/:botId/custom-emojis/add-library-pack", requireAuth, async (req: any, res) => {
  try {
    const { botId, spreadsheetId, isSuperAdmin, botName } = await resolveBotSheet(req.userId, req.params.botId);
    await ensureSeeded();
    const slug = String(req.body?.slug ?? "");
    const [pack] = await db.select().from(emojiPacksTable).where(eq(emojiPacksTable.slug, slug)).limit(1);
    if (!pack || !pack.active || !pack.tgSetName || pack.stickers.some((s) => !s.id)) throw new BotConfigError(404, "این پک در دسترس نیست", "pack_unavailable");
    const charged = await chargeForPack({ userId: req.userId, botId, packSlug: pack.slug, priceToman: pack.priceToman, isSuperAdmin });
    const list = await current(spreadsheetId);
    const taken = new Set(list.map((e) => e.name));
    const usedIds = new Set(list.map((e) => e.id));
    let added = 0;
    for (const st of pack.stickers) {
      if (!st.id || usedIds.has(st.id) || list.length >= MAX_EMOJIS) continue;
      let name = st.name;
      if (taken.has(name)) [name] = uniqueName(st.name.slice(0, 26), taken, 2);
      else taken.add(name);
      usedIds.add(st.id);
      list.push({ name, id: st.id, fallback: st.emoji || "⭐", animated: st.animated, enabled: true, pack: pack.tgSetName.slice(0, 64) });
      added++;
    }
    try {
      if (added > 0) await patchSettings(spreadsheetId, { custom_emojis: list } as Record<string, unknown>);
    } catch (err) {
      if (charged > 0) {
        logger.error({ err, botId, slug }, "emoji pack purchased but adding to bot failed");
        throw new BotConfigError(500, "خرید ثبت شد ولی افزودنِ پک به بات ناموفق بود؛ دوباره «افزودن» را بزنید — پولی دوباره کم نمی‌شود.", "pack_add_failed_after_purchase");
      }
      throw err;
    }
    if (charged > 0) {
      try {
        await createNotification({
          userId: req.userId, botId, type: "emoji_pack_purchased", severity: "info",
          title: `پک «${pack.titleFa}» خریداری شد`,
          message: `${formatTomanFa(charged)} از کیف پول کم شد و پک روی بات «${botName ?? ""}» اضافه شد.`,
        });
      } catch (err) { logger.warn({ err }, "emoji pack purchase notification failed (ignored)"); }
    }
    res.json({ emojis: list, added, charged });
  } catch (err) { sendBotConfigError(res, err, "Failed to add emoji pack"); }
});

router.post("/bots/:botId/custom-emojis/import-ids", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map((x: unknown) => String(x).trim()).filter((x: string) => ID_RE.test(x)))].slice(0, 200) as string[];
    if (!ids.length) throw bad("حداقل یک شناسه‌یِ عددیِ معتبر لازم است.");
    const token = await tokenFor(req.params.botId);
    const r = await tgApi<Array<{ custom_emoji_id?: string; emoji?: string; is_animated?: boolean; is_video?: boolean; set_name?: string }>>(token, "getCustomEmojiStickers", { custom_emoji_ids: ids });
    if (!r.ok) throw new BotConfigError(409, `تلگرام قبول نکرد: ${r.description ?? "خطای نامشخص"} (این متد فقط برایِ باتی که یوزرنیمِ Fragment دارد کار می‌کند؛ از «افزودنِ پک» استفاده کنید)`, "telegram_rejected");
    const list = await current(spreadsheetId);
    const taken = new Set(list.map((e) => e.name));
    const usedIds = new Set(list.map((e) => e.id));
    let n = 1;
    for (const st of r.result ?? []) {
      if (!st.custom_emoji_id || usedIds.has(st.custom_emoji_id) || list.length >= MAX_EMOJIS) continue;
      let name: string;
      [name, n] = uniqueName("emoji", taken, n);
      usedIds.add(st.custom_emoji_id);
      list.push({ name, id: st.custom_emoji_id, fallback: st.emoji || "⭐", animated: Boolean(st.is_animated || st.is_video), enabled: true, pack: String(st.set_name ?? "").slice(0, 64) });
    }
    await patchSettings(spreadsheetId, { custom_emojis: list } as Record<string, unknown>);
    res.json({ emojis: list });
  } catch (err) { sendBotConfigError(res, err, "Failed to import emoji ids"); }
});

export default router;
