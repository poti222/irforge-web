/**
 * routes/botSettings.ts — تب `bot_settings` شیت تننت، از سایت.
 * ─────────────────────────────────────────────────────────────────────────────
 * معادل کاملِ منوی «تنظیمات» ادمین در خود بات (`handlers/admin_panel.py`):
 * پیام‌ها، واترمارک، حالت تعمیر، عضویت اجباری، ساعت کاری، آنتی‌فلاد.
 *
 * همه‌چیز از `lib/botConfig.ts` می‌گذرد، پس سه تضمین خودکارند:
 *   - مالکیت بات (`resolveBotSheet` → ۴۰۴/۴۰۹)، بدون استثنا (باگ B3)
 *   - نوشتن کلیدبه‌کلید، هرگز بازنویسی کل تب (باگ B11)
 *   - باطل‌شدن کش L2 بات بعد از هر نوشتن
 *
 * ولیدیشن **سمت سرور** انجام می‌شود، نه فقط سمت کلاینت، و هر خطا یک پیام
 * فارسیِ مشخص برمی‌گرداند نه «Internal server error».
 */
import { Router } from "express";
import { db, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi } from "../lib/telegram.js";
import {
  resolveBotSheet,
  readSettings,
  patchSettings,
  listEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
  SETTINGS_TAB,
} from "../lib/botConfig.js";
import { cacheBustEnabled } from "../lib/botCacheBust.js";
import { resolveTelegramChat } from "../lib/telegramResolve.js";
import { logger } from "../lib/logger.js";
import {
  BOT_LANGUAGES,
  TELEGRAM_TEXT_LIMIT,
  SETTINGS_MESSAGE_FIELDS,
  defaultWorkingHours,
  defaultAntiFlood,
  type WorkingHours,
  type AntiFlood,
  type Panel,
} from "../lib/botTypes.js";

const router = Router();

// ─── whitelist ──────────────────────────────────────────────────────────────

/**
 * تنها فیلدهایی که PATCH می‌پذیرد. هر کلید دیگری در body **بی‌سروصدا نادیده**
 * گرفته می‌شود، نه ذخیره — وگرنه یک کلاینت می‌توانست `__plugin_states__` یا
 * هر کلید دلخواهی را در تب تنظیمات بات بنویسد.
 */
const PATCHABLE_FIELDS = [
  ...SETTINGS_MESSAGE_FIELDS,
  "language",
  "watermark",
  "watermark_enabled",
  "maintenance",
  "welcome_enabled",
  "home_panel_id",
  "support_username",
  "currency",
  "payment_info",
  "reply_keyboard",
] as const;

const BOOLEAN_FIELDS = new Set(["watermark_enabled", "maintenance", "welcome_enabled"]);
const MESSAGE_FIELDS = new Set<string>(SETTINGS_MESSAGE_FIELDS);

/**
 * سقف‌های کیبورد پایین. تلگرام عدد رسمی اعلام نکرده، ولی همان‌طور که برای
 * کیبورد اینلاین، از حدود ۴ دکمه در ردیف به بعد برچسب‌ها روی موبایل بریده
 * می‌شوند — و کیبوردی با ۲۰ ردیف نصف صفحه‌ی کاربر را می‌خورد.
 */
const REPLY_KB_MAX_ROWS = 10;
const REPLY_KB_MAX_PER_ROW = 4;

/**
 * رنگ‌هایی که Bot API برای دکمه می‌شناسد — همان سه‌تایی که
 * `aiogram.enums.ButtonStyle` دارد. رشته‌ی خالی یعنی «رنگ پیش‌فرض کلاینت».
 * عمداً با `BUTTON_STYLES` پنل‌ها یکی است تا دو جای UI یک زبان داشته باشند.
 */
const REPLY_KB_STYLES = ["primary", "success", "danger"] as const;

/**
 * اکشن‌های مجازِ یک دکمه‌ی کیبورد پایین — همان زیرمجموعه‌ی امنِ اکشن‌های
 * دکمه‌ی پنل (`ButtonBuilder.tsx`) که بات می‌تواند از روی **متنِ** یک پیام
 * (نه callback_data) resolve کند: `catalog_order` و اکشن‌های ثابتِ پلاگینی
 * عمداً اینجا نیستند، چون هندلرشان امروز فقط برای CallbackQuery نوشته شده.
 * `"text"` یعنی همان رفتار اصلی/عقب‌رو: دکمه فقط متن خودش را می‌فرستد.
 */
const REPLY_KB_ACTIONS = ["text", "panel", "sell", "form", "mini_app", "url", "phone"] as const;
const REPLY_KB_ACTIONS_NO_VALUE = new Set<string>(["text", "phone"]);
const REPLY_KB_ACTIONS_URL = new Set<string>(["mini_app", "url"]);

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * کیبورد پایین (ReplyKeyboard). شکل ذخیره‌شده همان چیزی است که
 * `handlers/user.py::_reply_keyboard` در بات می‌خواند.
 *
 * ردیف خالی و دکمه‌ی بی‌متن **دور ریخته می‌شوند** نه اینکه خطا بدهند: کاربری
 * که یک ردیف اضافه کرده و پرش نکرده، نباید ذخیره‌اش رد شود.
 */
function validateReplyKeyboard(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw bad("ساختار کیبورد پایین معتبر نیست.");

  const raw = value as Record<string, unknown>;
  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  if (rawRows.length > REPLY_KB_MAX_ROWS)
    throw bad(`کیبورد پایین حداکثر می‌تواند ${REPLY_KB_MAX_ROWS} ردیف داشته باشد.`, "too_many_rows");

  /**
   * هر خانه یا رشته‌ی ساده است یا `{text, style}`.
   *
   * دکمه‌ی بی‌رنگ همان رشته‌ی ساده ذخیره می‌شود، نه `{"text": "...",
   * "style": ""}` — تا کیبوردهای موجود بایت‌به‌بایت همان بمانند و شکل روی
   * شیت بی‌دلیل سنگین‌تر نشود.
   */
  type Cell = string | { text: string; style?: string; action?: string; value?: string };
  const rows: Cell[][] = [];
  for (const rawRow of rawRows) {
    if (!Array.isArray(rawRow)) continue;
    const cells = rawRow
      .map((cell): Cell | null => {
        const isObject = cell && typeof cell === "object" && !Array.isArray(cell);
        const source = (isObject ? cell : { text: cell, style: "" }) as {
          text?: unknown;
          style?: unknown;
          action?: unknown;
          value?: unknown;
        };
        const text = String(source.text ?? "").trim().slice(0, 64);
        if (!text) return null;
        const style = String(source.style ?? "").trim();
        if (style && !(REPLY_KB_STYLES as readonly string[]).includes(style))
          throw bad(`رنگ «${style}» برای دکمه‌ی کیبورد پایین معتبر نیست.`, "bad_button_style");

        // اکشن — همان سیستمِ اکشن/مقدارِ دکمه‌ی پنل (ButtonBuilder.tsx)، فقط
        // زیرمجموعه‌ای که از روی متنِ پیام هم resolve می‌شود. نبودنش یعنی
        // دکمه‌ی قدیمی/بی‌اکشن — رفتار اصلی (فقط ارسالِ متنِ خودش) دست‌نخورده.
        const rawAction = String(source.action ?? "").trim();
        if (!rawAction) return style ? { text, style } : text;
        if (!(REPLY_KB_ACTIONS as readonly string[]).includes(rawAction))
          throw bad(`اکشن «${rawAction}» برای دکمه‌ی کیبورد پایین معتبر نیست.`, "bad_button_action");

        let actionValue = String(source.value ?? "").trim().slice(0, 300);
        if (REPLY_KB_ACTIONS_NO_VALUE.has(rawAction)) {
          actionValue = "";
        } else if (!actionValue) {
          throw bad(`دکمه‌ی «${text}» به یک مقدار نیاز دارد.`, "missing_button_value");
        } else if (REPLY_KB_ACTIONS_URL.has(rawAction) && !/^https:\/\//i.test(actionValue)) {
          throw bad(`مقدار دکمه‌ی «${text}» باید یک لینکِ https باشد.`, "bad_button_value");
        }

        const out: { text: string; style?: string; action: string; value: string } = {
          text, action: rawAction, value: actionValue,
        };
        if (style) out.style = style;
        return out;
      })
      .filter((cell): cell is Cell => cell !== null);
    if (cells.length > REPLY_KB_MAX_PER_ROW)
      throw bad(
        `هر ردیف کیبورد پایین حداکثر ${REPLY_KB_MAX_PER_ROW} دکمه می‌تواند داشته باشد.`,
        "row_too_full",
      );
    if (cells.length > 0) rows.push(cells);
  }

  // کیبورد بدون هیچ دکمه‌ای یعنی «کیبورد نداشته باش» — همان `null`، تا بات
  // به‌جای یک کیبورد خالی، هیچ کیبوردی نفرستد.
  if (rows.length === 0) return null;

  return {
    rows,
    resize: raw.resize === undefined ? true : Boolean(raw.resize),
    one_time: Boolean(raw.one_time),
    placeholder: String(raw.placeholder ?? "").trim().slice(0, 64),
  };
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw bad(`مقدار «${field}» باید متن باشد.`);
  return value;
}

function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw bad(`مقدار «${field}» باید true یا false باشد.`);
  return value;
}

function asInt(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n))
    throw bad(`مقدار «${field}» باید یک عدد صحیح باشد.`);
  if (n < min) throw bad(`مقدار «${field}» نباید کمتر از ${min} باشد.`);
  if (n > max) throw bad(`مقدار «${field}» نباید بیشتر از ${max} باشد.`);
  return n;
}

/** `HH:MM` ۲۴ساعته. */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function asTime(value: unknown, field: string): string {
  const s = asString(value, field).trim();
  if (!TIME_RE.test(s)) throw bad(`«${field}» باید به شکل ساعت ۲۴ساعته باشد، مثلاً 09:00 یا 21:30.`);
  return s;
}

/**
 * کانال فورس‌جوین: یا با `@` شروع شود، یا یک آی‌دی عددی منفی باشد (سوپرگروه/کانال).
 * همان دو شکلی که `getChatMember` بات قبول می‌کند.
 */
function normalizeChannel(raw: unknown): string {
  // کاربر معمولاً لینک کانال را کپی می‌کند، نه یوزرنیم خام — پذیرفتنش ارزان
  // است و جلوی یک خطای بی‌دلیل را می‌گیرد.
  let s = asString(raw, "channel").trim().replace(/^https?:\/\/t\.me\//i, "@").replace(/^t\.me\//i, "@");
  if (!s) throw bad("نام کانال خالی است.");
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) s = `@${s}`;
  if (s.startsWith("@")) {
    const handle = s.slice(1);
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(handle))
      throw bad("یوزرنیم کانال معتبر نیست. باید با @ شروع شود و بین ۵ تا ۳۲ کاراکتر انگلیسی/عدد/زیرخط باشد.");
    return s;
  }
  if (/^-\d{6,}$/.test(s)) return s;
  throw bad("کانال باید با @ شروع شود (مثل @mychannel) یا یک آی‌دی عددی منفی باشد (مثل -1001234567890).");
}

function validateMessage(field: string, value: unknown): string {
  const s = asString(value, field);
  if (s.length > TELEGRAM_TEXT_LIMIT)
    throw bad(`طول «${field}» از ${TELEGRAM_TEXT_LIMIT} کاراکتر بیشتر است (سقف تلگرام).`);
  return s;
}

/** روزهای هفته: آرایه‌ای از ۰..۶، بدون تکرار. ۰=دوشنبه … ۶=یکشنبه (models.py). */
function validateDays(value: unknown): number[] {
  if (!Array.isArray(value)) throw bad("«روزهای هفته» باید یک آرایه باشد.");
  const days = value.map((d, i) => asInt(d, `days[${i}]`, 0, 6));
  if (new Set(days).size !== days.length) throw bad("روزهای هفته نباید تکراری باشند.");
  return days.sort((a, b) => a - b);
}

function validateWorkingHours(body: any): WorkingHours {
  if (!body || typeof body !== "object") throw bad("بدنه‌ی درخواست معتبر نیست.");
  const base = defaultWorkingHours();
  const open_time = asTime(body.open_time ?? base.open_time, "open_time");
  const close_time = asTime(body.close_time ?? base.close_time, "close_time");
  return {
    enabled: asBool(body.enabled ?? base.enabled, "enabled"),
    open_time,
    close_time,
    days: validateDays(body.days ?? base.days),
    closed_message: validateMessage("closed_message", body.closed_message ?? base.closed_message),
  };
}

function validateAntiFlood(body: any): AntiFlood {
  if (!body || typeof body !== "object") throw bad("بدنه‌ی درخواست معتبر نیست.");
  const base = defaultAntiFlood();
  return {
    enabled: asBool(body.enabled ?? base.enabled, "enabled"),
    max_messages: asInt(body.max_messages ?? base.max_messages, "max_messages", 1, 1000),
    interval_seconds: asInt(body.interval_seconds ?? base.interval_seconds, "interval_seconds", 1, 86_400),
    ban_duration_seconds: asInt(
      body.ban_duration_seconds ?? base.ban_duration_seconds,
      "ban_duration_seconds",
      0,
      31_536_000
    ),
    warn_message: validateMessage("warn_message", body.warn_message ?? base.warn_message),
  };
}

/** پاسخ استاندارد: تنظیمات + متادیتای تأخیر کش برای بنر UI. */
function settingsResponse(settings: unknown) {
  return { settings, cacheBust: cacheBustEnabled() };
}

// ─── GET /api/bots/:botId/settings ──────────────────────────────────────────

router.get("/bots/:botId/settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const settings = await readSettings(spreadsheetId);
    res.json(settingsResponse(settings));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read bot settings");
  }
});

// ─── PATCH /api/bots/:botId/settings ────────────────────────────────────────

router.patch("/bots/:botId/settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    for (const field of PATCHABLE_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];

      if (MESSAGE_FIELDS.has(field)) {
        patch[field] = validateMessage(field, value);
        continue;
      }
      if (BOOLEAN_FIELDS.has(field)) {
        patch[field] = asBool(value, field);
        continue;
      }
      if (field === "language") {
        const lang = asString(value, "language").trim();
        if (!(BOT_LANGUAGES as readonly string[]).includes(lang))
          throw bad(`زبان «${lang}» پشتیبانی نمی‌شود. یکی از این‌ها را انتخاب کنید: ${BOT_LANGUAGES.join(", ")}`);
        patch.language = lang;
        continue;
      }
      if (field === "home_panel_id") {
        if (value === null || value === "") {
          patch.home_panel_id = null;
          continue;
        }
        const panelId = asString(value, "home_panel_id").trim();
        const panels = await listEntity<Panel>(spreadsheetId, "panels");
        if (!panels.some((p) => p.key === panelId))
          throw bad("پنلی که به‌عنوان صفحه‌ی خانه انتخاب کردید وجود ندارد.", "panel_not_found");
        patch.home_panel_id = panelId;
        continue;
      }
      if (field === "watermark" || field === "payment_info") {
        patch[field] = validateMessage(field, value);
        continue;
      }
      if (field === "support_username") {
        const raw = asString(value, "support_username").trim().replace(/^@/, "");
        if (raw && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(raw))
          throw bad("یوزرنیم پشتیبانی معتبر نیست (۵ تا ۳۲ کاراکتر انگلیسی/عدد/زیرخط).");
        patch.support_username = raw;
        continue;
      }
      if (field === "currency") {
        const cur = asString(value, "currency").trim();
        if (cur.length > 20) throw bad("نام واحد پول نباید بیشتر از ۲۰ کاراکتر باشد.");
        patch.currency = cur;
        continue;
      }
      if (field === "reply_keyboard") {
        patch.reply_keyboard = validateReplyKeyboard(value);
        continue;
      }
    }

    if (Object.keys(patch).length === 0) {
      throw bad("هیچ فیلد قابل ذخیره‌ای در درخواست نبود.", "empty_patch");
    }

    const settings = await patchSettings(spreadsheetId, patch);
    res.json(settingsResponse(settings));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to patch bot settings");
  }
});

// ─── کانال‌های عضویت اجباری ─────────────────────────────────────────────────

router.get("/bots/:botId/settings/channels", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const settings = await readSettings(spreadsheetId);
    res.json({
      channels: settings.force_join_channels,
      force_join_message: settings.force_join_message,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read force-join channels");
  }
});

router.post("/bots/:botId/settings/channels", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const input = normalizeChannel(req.body?.channel);
    const settings = await readSettings(spreadsheetId);
    const current = settings.force_join_channels;
    if (current.length >= 20) throw bad("حداکثر ۲۰ کانال می‌توانید اضافه کنید.");

    /**
     * یوزرنیم به **آی‌دی عددی** تبدیل و همان ذخیره می‌شود.
     *
     * چرا مهم است: یوزرنیم کانال قابل تغییر است. بات عضویت را با
     * `get_chat_member(ch, uid)` چک می‌کند و اگر `ch` یک یوزرنیمِ منقضی باشد،
     * تلگرام «chat not found» می‌دهد — و بات آن را «کاربر عضو نیست» تفسیر
     * می‌کند (`handlers/user.py:194`). یعنی **همه‌ی کاربران برای همیشه پشت
     * درِ عضویت اجباری قفل می‌شوند** و هیچ خطایی هم جایی ثبت نمی‌شود.
     * آی‌دی عددی هیچ‌وقت عوض نمی‌شود.
     *
     * اگر تلگرام در دسترس نبود، همان ورودی کاربر ذخیره می‌شود — قبلاً هم
     * همین بود و کار می‌کرد؛ نباید افزودن کانال به‌خاطر یک خطای موقت شبکه
     * شکست بخورد.
     */
    let stored = input;
    let resolved: Awaited<ReturnType<typeof resolveTelegramChat>> | null = null;
    try {
      resolved = await resolveTelegramChat(req.params.botId, input);
      stored = resolved.chatId;
    } catch (err) {
      // ۴۰۹ یعنی تلگرام کانال را به بات نشان نداد — این را باید به کاربر گفت،
      // چون همان کانال بعداً هم کار نخواهد کرد.
      if (err instanceof BotConfigError && err.status === 409) throw err;
      logger.debug({ err, input }, "channel resolve failed; storing raw input");
    }

    // مقایسه هم روی مقدار ذخیره‌شده و هم روی ورودی خام: کانالی که قبلاً با
    // یوزرنیم ثبت شده نباید حالا با آی‌دی عددی دوباره اضافه شود.
    const known = new Set(current.map((c) => c.toLowerCase()));
    if (known.has(stored.toLowerCase()) || known.has(input.toLowerCase()))
      throw new BotConfigError(409, "این کانال از قبل در لیست هست.", "duplicate_channel");

    const updated = await patchSettings(spreadsheetId, {
      force_join_channels: [...current, stored],
    });
    res.status(201).json({
      channels: updated.force_join_channels,
      // UI بلافاصله می‌گوید چه کانالی اضافه شد و آیا بات آنجا ادمین هست —
      // بدون این، کاربر باید حدس بزند که `-1001234567890` کدام کانال بود.
      resolved: resolved
        ? {
            chatId: resolved.chatId,
            title: resolved.title,
            username: resolved.username,
            botIsAdmin: resolved.botIsAdmin,
          }
        : null,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to add force-join channel");
  }
});

router.delete("/bots/:botId/settings/channels/:idx", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const settings = await readSettings(spreadsheetId);
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= settings.force_join_channels.length)
      throw new BotConfigError(404, "این کانال در لیست پیدا نشد.", "channel_not_found");

    const next = settings.force_join_channels.filter((_, i) => i !== idx);
    const updated = await patchSettings(spreadsheetId, { force_join_channels: next });
    res.json({ channels: updated.force_join_channels });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to remove force-join channel");
  }
});

/**
 * POST /api/bots/:botId/settings/channels/check
 * بررسی می‌کند بات واقعاً در کانال ادمین هست یا نه. اگر نباشد، عضویت اجباری
 * در عمل کار نمی‌کند و کاربر هیچ‌وقت نمی‌فهمد چرا.
 *
 * هیچ‌وقت crash نمی‌کند: نبودن توکن یا خطای شبکه یک نتیجه‌ی «نامعلوم» با پیام
 * روشن است، نه ۵۰۰. توکن هم هرگز به کلاینت نمی‌رود.
 */
router.post("/bots/:botId/settings/channels/check", requireAuth, async (req: any, res) => {
  try {
    await resolveBotSheet(req.userId, req.params.botId);

    const [bot] = await db
      .select({ token: botsTable.token })
      .from(botsTable)
      .where(eq(botsTable.id, req.params.botId))
      .limit(1);

    const channel = normalizeChannel(req.body?.channel);

    let token: string;
    try {
      token = decryptToken(bot?.token ?? "");
    } catch {
      token = "";
    }
    if (!token) {
      res.json({ status: "unknown", message: "توکن این بات روی سرور در دسترس نیست، پس نمی‌توان دسترسی را بررسی کرد." });
      return;
    }

    const me = await tgApi<{ id: number }>(token, "getMe");
    if (!me.ok || !me.result) {
      res.json({ status: "unknown", message: `تلگرام به getMe جواب نداد: ${me.description ?? "خطای نامشخص"}` });
      return;
    }

    const member = await tgApi<{ status: string }>(token, "getChatMember", {
      chat_id: channel,
      user_id: me.result.id,
    });
    if (!member.ok) {
      res.json({
        status: "error",
        message: `بات به این کانال دسترسی ندارد یا کانال پیدا نشد: ${member.description ?? "خطای نامشخص"}`,
      });
      return;
    }

    const memberStatus = member.result?.status ?? "";
    const isAdmin = memberStatus === "administrator" || memberStatus === "creator";
    res.json({
      status: isAdmin ? "ok" : "error",
      message: isAdmin
        ? "بات در این کانال ادمین است و عضویت اجباری کار می‌کند."
        : "بات عضو هست ولی ادمین نیست؛ برای بررسی عضویت کاربران باید ادمین باشد.",
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to check channel access");
  }
});

// ─── ساعت کاری ──────────────────────────────────────────────────────────────

router.put("/bots/:botId/settings/working-hours", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const working_hours = validateWorkingHours(req.body);
    const updated = await patchSettings(spreadsheetId, { working_hours });
    res.json({ working_hours: updated.working_hours });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save working hours");
  }
});

// ─── آنتی‌فلاد ──────────────────────────────────────────────────────────────

router.put("/bots/:botId/settings/anti-flood", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SETTINGS_TAB);

    const anti_flood = validateAntiFlood(req.body);
    const updated = await patchSettings(spreadsheetId, { anti_flood });
    res.json({ anti_flood: updated.anti_flood });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save anti-flood settings");
  }
});

/** فقط برای تست — اعتبارسنج‌هایی که قرارداد بین سایت و بات را نگه می‌دارند. */
export const __testables = { validateReplyKeyboard };

export default router;
