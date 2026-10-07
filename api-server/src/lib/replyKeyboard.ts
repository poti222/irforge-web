/**
 * lib/replyKeyboard.ts — اعتبارسنجیِ «کیبورد پایین» (ReplyKeyboard).
 *
 * تا امروز فقط یک کیبوردِ سراسری برای کل بات بود (`bot_settings.reply_keyboard`،
 * `routes/botSettings.ts`). حالا هر **پنل** هم می‌تواند کیبوردِ پایینِ خودش را
 * داشته باشد (`panel.settings.reply_keyboard`، `routes/botPanels.ts`) — هر دو از
 * همین یک اعتبارسنج می‌گذرند تا قوانین (سقف ردیف/دکمه، رنگ‌ها، اکشن‌های مجاز)
 * دقیقاً یکی بمانند. خوانندهٔ آن در بات: `handlers/user.py::_build_reply_keyboard`.
 */
import { BotConfigError } from "./botConfig.js";

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/**
 * سقف‌های کیبورد پایین. تلگرام عدد رسمی اعلام نکرده، ولی همان‌طور که برای
 * کیبورد اینلاین، از حدود ۴ دکمه در ردیف به بعد برچسب‌ها روی موبایل بریده
 * می‌شوند — و کیبوردی با ۲۰ ردیف نصف صفحه‌ی کاربر را می‌خورد.
 */
export const REPLY_KB_MAX_ROWS = 10;
export const REPLY_KB_MAX_PER_ROW = 4;

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

/**
 * کیبورد پایین (ReplyKeyboard). شکل ذخیره‌شده همان چیزی است که
 * `handlers/user.py::_reply_keyboard` در بات می‌خواند.
 *
 * ردیف خالی و دکمه‌ی بی‌متن **دور ریخته می‌شوند** نه اینکه خطا بدهند: کاربری
 * که یک ردیف اضافه کرده و پرش نکرده، نباید ذخیره‌اش رد شود.
 */
export function validateReplyKeyboard(value: unknown): Record<string, unknown> | null {
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


/** حالت‌های کیبوردِ پایینِ یک پنل. نبودنِ کلید یعنی «دست نزن» (کیبوردِ فعلیِ کاربر می‌ماند). */
export const PANEL_RK_MODES = ["custom", "default", "hide"] as const;
export const PANEL_RK_MESSAGE_MAX = 100;

/**
 * کیبوردِ پایینِ مخصوصِ یک پنل — `panel.settings.reply_keyboard`.
 *
 *   {mode:"custom", rows, resize, one_time, placeholder, message?}   کیبوردِ اختصاصیِ این پنل
 *   {mode:"default", message?}                                       برگرداندنِ کیبوردِ اصلیِ بات
 *   {mode:"hide", message?}                                          حذفِ کیبوردِ پایین
 *
 * `null` (و «custom» بدون هیچ دکمه) یعنی «تنظیمی نیست» و کلید ذخیره نمی‌شود.
 * `message` متنِ پیامِ حامل است: تلگرام روی یک پیام فقط یک reply_markup می‌پذیرد و
 * پنل‌هایی که دکمه‌ی اینلاین دارند ناچارند کیبوردِ پایین را در یک پیامِ کوتاهِ جدا بفرستند.
 */
export function validatePanelReplyKeyboard(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw bad("ساختار کیبورد پایینِ پنل معتبر نیست.", "bad_reply_keyboard");
  const raw = value as Record<string, unknown>;
  const mode = String(raw.mode ?? "custom");
  if (!(PANEL_RK_MODES as readonly string[]).includes(mode))
    throw bad("حالتِ کیبورد پایینِ پنل معتبر نیست.", "bad_reply_keyboard_mode");
  const message = String(raw.message ?? "").trim().slice(0, PANEL_RK_MESSAGE_MAX);

  if (mode === "default" || mode === "hide") return message ? { mode, message } : { mode };

  const kb = validateReplyKeyboard(raw);
  if (!kb) return null;
  return { mode: "custom", ...kb, ...(message ? { message } : {}) };
}
