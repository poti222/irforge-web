/**
 * botTypes.ts — آینه‌ی `mainbot/models.py`. هر تغییری آنجا، اینجا هم باید اعمال شود.
 * ─────────────────────────────────────────────────────────────────────────────
 * این فایل قرارداد داده‌ی بین سایت و بات است. هر تب شیت تننت (`panels`,
 * `forms`, `bot_settings`, ...) دقیقاً همین شکل‌ها را نگه می‌دارد:
 * سطر ۱ هدر ثابت `["key","value"]` و هر سطر بعدی `[key, JSON.stringify(value)]`.
 *
 * ⚠️ سه جایی که این فایل عمداً از `models.py` «بیشتر» است — و اگر حذفشان کنی
 *    دیتای واقعی کاربر نابود می‌شود (ثبت‌شده در ممیزی فاز ۰، بخش «ه»):
 *
 *   1. `PanelButton.row_start` و `PanelButton.style` در دیتاکلاس `Button`
 *      نیستند، ولی `handlers/panel_builder.py` (خطوط ۹۴۶ و ۹۷۰) آن‌ها را
 *      می‌نویسد. دکمه‌ها به‌صورت `list[dict]` خام داخل `Panel.buttons` ذخیره
 *      می‌شوند و هرگز از `Button.from_dict` رد نمی‌شوند، پس فیلتر
 *      `__dataclass_fields__` هیچ‌وقت آن‌ها را دور نمی‌ریزد.
 *      `row_start` منبع حقیقتِ چیدمان ردیف‌هاست، نه `row`
 *      (`_apply_row_starts`، `panel_builder.py:996`).
 *
 *   2. مدیای پنل دو جا زندگی می‌کند: `Panel.media_file_id` (تک‌رشته) و
 *      `Panel.settings.carousel_ids` (لیست، فقط برای نوع carousel) —
 *      `panel_builder.py:1161-1163`. هیچ فیلدی به‌نام `media_ids` روی دیسک
 *      وجود ندارد؛ آن فقط کلید FSM داخل بات است.
 *
 *   3. انواع پنل هشت‌تاست (`CORE_PANEL_TYPES` در `panel_builder.py:32`)، نه
 *      شش‌تایی که کامنت `models.py` می‌گوید — `form` و `sell` هم هستند.
 */

// ─── Panel ──────────────────────────────────────────────────────────────────

/** انواع پنل هسته — آینه‌ی `CORE_PANEL_TYPES` (`handlers/panel_builder.py:32`). */
export const CORE_PANEL_TYPES = [
  "text",
  "photo",
  "carousel",
  "video",
  "audio",
  "document",
  "form",
  "sell",
] as const;
export type CorePanelType = (typeof CORE_PANEL_TYPES)[number];

/** انواعی که چند مدیا می‌پذیرند. بقیه فقط یک `media_file_id` دارند. */
export const MULTI_MEDIA_PANEL_TYPES: readonly string[] = ["carousel"];

/** انواعی که اصلاً مدیا نمی‌گیرند — تغییر نوع به این‌ها یعنی حذف مدیا. */
export const TEXT_ONLY_PANEL_TYPES: readonly string[] = ["text", "form", "sell"];

/** اکشن‌های دکمه — آینه‌ی `CORE_BTN_ACTIONS` (`handlers/panel_builder.py:43`). */
export const CORE_BTN_ACTIONS = [
  "panel",
  "url",
  "mini_app",
  "form",
  "sell",
  "callback",
  "phone",
] as const;
export type CoreButtonAction = (typeof CORE_BTN_ACTIONS)[number];

/** استایل‌های دکمه که بات رندر می‌کند (رشته‌ی خالی = پیش‌فرض). */
export const BUTTON_STYLES = ["", "primary", "success", "danger"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export type PanelButton = {
  label: string;
  /** یکی از `CORE_BTN_ACTIONS` یا اکشنی که یک پلاگین فعال ثبت کرده. */
  action: string;
  value: string;
  row: number;
  col: number;
  /** آیا این دکمه سر یک ردیف جدید است — منبع حقیقتِ چیدمان. */
  row_start: boolean;
  style: ButtonStyle | string;
  /** آیکون custom-emoji اختیاری قبل از label (PHASE 28.2 بات، `handlers/user.py`).
   *  مثل `row_start`/`style` در دیتاکلاس نیست ولی روی دیسک هست — دور نریزش. */
  icon_custom_emoji_id?: string;
};

/**
 * «غیرفعال‌کردن» یک دکمه بدون حذفش. بات هر action ناشناخته را به
 * `callback_data = value or "noop"` تبدیل می‌کند (`handlers/user.py:853`) و
 * هیچ هندلری روی `noop` نیست، پس دکمه می‌ماند و کاری نمی‌کند — به‌جای اینکه به
 * یک پنل حذف‌شده لینک بدهد و پیام «پیدا نشد» بدهد.
 */
export function disabledButton(button: PanelButton): PanelButton {
  return { ...button, action: "callback", value: "noop" };
}

/** کلیدهای شناخته‌شده‌ی `Panel.settings` (همه اختیاری، همه از panel_builder.py). */
export type PanelSettings = {
  /** حذف خودکار پیام بعد از n ثانیه (۰/غایب = بدون حذف). */
  timer_seconds?: number;
  /** رمز ورود به پنل (خام ذخیره می‌شود — بات همین‌طور می‌خواند). */
  password?: string;
  /** حداکثر تعداد ورود؛ `capacity_used` شمارنده‌ی فقط‌خواندنی است. */
  capacity?: number;
  capacity_used?: number;
  /** آی‌دی گروه‌هایی که پیام کاربر به آن‌ها فوروارد می‌شود. */
  forward_groups?: string[];
  /** فقط برای نوع `carousel` — لیست کامل file_idها. */
  carousel_ids?: string[];
  [key: string]: unknown;
};

export type Panel = {
  id: string;
  title: string;
  type: string;
  content: string;
  media_file_id: string;
  buttons: PanelButton[];
  settings: PanelSettings;
  children: string[];
  parent_id: string | null;
  is_home: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// ─── Form ───────────────────────────────────────────────────────────────────

export const FORM_FIELD_TYPES = [
  "text",
  "number",
  "phone",
  "email",
  "photo",
  "location",
  "select",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  validation_regex: string;
  error_message: string;
  order: number;
};

export type Form = {
  id: string;
  title: string;
  fields: FormField[];
  destination_group: string;
  destination_admin_ids: string[];
  thank_you_message: string;
  is_active: boolean;
  notify_admin: boolean;
  allow_edit: boolean;
  created_at: string;
};

// ─── User / Admin ───────────────────────────────────────────────────────────

/** آینه‌ی `models.User` — اسمش اینجا BotUser است تا با کاربر سایت اشتباه نشود. */
export type BotUser = {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  language: string;
  profile_data: Record<string, unknown>;
  orders: Array<Record<string, unknown>>;
  is_admin: boolean;
  is_banned: boolean;
  ban_reason: string;
  current_panel: string | null;
  current_form: string | null;
  form_data: Record<string, unknown>;
  flood_timestamps: string[];
  joined_at: string;
  last_seen: string;
  referral_by: string | null;
  notes: string;
};

export type BotAdmin = {
  user_id: string;
  username: string;
  permissions: string[];
  added_at: string;
  added_by: string;
};

/** گروه‌های دسترسی هسته — آینه‌ی `_CORE_MIGRATION_MAP` در `utils/permissions.py`.
 *  گروه‌های پلاگین‌ها دینامیک اضافه می‌شوند و اینجا hardcode نمی‌شوند. */
export const CORE_PERMISSION_GROUPS = [
  "all",
  "settings",
  "users",
  "stats",
  "panels",
  "forms",
  "broadcast",
] as const;

/** نقش (تب `roles`). بات نقش را به‌صورت dict آزاد می‌خواند. */
export type BotRole = {
  id: string;
  name: string;
  permissions: string[];
  created_at: string;
};

// ─── Custom commands ────────────────────────────────────────────────────────

/** آینه‌ی docstring `handlers/custom_commands.py:8-16`. کلید سطر = `command`. */
export type CustomCommand = {
  /** بدون `/`. */
  command: string;
  /** `panel:<id>` | `form:<id>` | `url:<link>` | یک target ثبت‌شده‌ی پلاگین. */
  target: string;
  description: string;
  admin_only: boolean;
  is_active: boolean;
  created_at: string;
};

// ─── Bot settings ───────────────────────────────────────────────────────────

export type WorkingHours = {
  enabled: boolean;
  /** `HH:MM` ۲۴ساعته. */
  open_time: string;
  close_time: string;
  /** 0=دوشنبه … 6=یکشنبه — دقیقاً همان قرارداد `models.py:158`. */
  days: number[];
  closed_message: string;
};

export type AntiFlood = {
  enabled: boolean;
  max_messages: number;
  interval_seconds: number;
  ban_duration_seconds: number;
  warn_message: string;
};

export type BotSettings = {
  language: string;
  welcome_msg: string;
  welcome_enabled: boolean;
  error_msg: string;
  not_found_msg: string;
  panel_inactive_msg: string;
  banned_msg: string;
  maintenance_msg: string;
  watermark: string;
  watermark_enabled: boolean;
  maintenance: boolean;
  /**
   * کیبورد پایینِ چت. **در `models.py` بات وجود ندارد** — کلیدی است که سایت
   * اضافه کرده و بات آن را از دیکشنری خام می‌خواند
   * (`handlers/user.py::_reply_keyboard`)، نه از دیتاکلاس؛ پس نبودنش در
   * `BotSettings` پایتون هیچ مشکلی نمی‌سازد.
   *
   * `null` یعنی کیبوردی نمایش داده نشود.
   */
  reply_keyboard: ReplyKeyboard | null;
  force_join_channels: string[];
  force_join_message: string;
  working_hours: WorkingHours;
  anti_flood: AntiFlood;
  home_panel_id: string | null;
  support_username: string;
  support_message: string;
  currency: string;
  payment_info: string;
  order_confirm_msg: string;
  order_reject_msg: string;
  order_track_msg: string;
  updated_at: string;
};

/** پیام‌های متنی تنظیمات و placeholderهای اجباری‌شان (برای ولیدیشن و UI). */
export const SETTINGS_MESSAGE_FIELDS = [
  "welcome_msg",
  "error_msg",
  "not_found_msg",
  "panel_inactive_msg",
  "banned_msg",
  "maintenance_msg",
  "force_join_message",
  "support_message",
  "order_confirm_msg",
  "order_reject_msg",
  "order_track_msg",
] as const;
export type SettingsMessageField = (typeof SETTINGS_MESSAGE_FIELDS)[number];

/** placeholderهایی که بات موقع ارسال جایگزین می‌کند. */
export const MESSAGE_PLACEHOLDERS: Record<string, readonly string[]> = {
  support_message: ["{support}"],
  order_confirm_msg: ["{order_id}", "{amount}"],
  order_reject_msg: ["{order_id}", "{reason}"],
  order_track_msg: ["{order_id}", "{reason}"],
};

/** سقف طول پیام تلگرام. */
export const TELEGRAM_TEXT_LIMIT = 4000;

/**
 * کیبورد پایین (ReplyKeyboard) — همان شکلی که بات از شیت می‌خواند.
 *
 * دکمه‌ها متنِ خودشان را می‌فرستند؛ متنی که با `/` شروع شود را تلگرام کامند
 * می‌فهمد و هندلر کامندهای سفارشیِ موجود می‌گیردش — برای همین این قابلیت
 * هیچ منطق dispatch تازه‌ای در بات لازم نداشت.
 */
/**
 * یک خانه‌ی کیبورد پایین.
 *
 * رشته‌ی ساده = دکمه‌ی بی‌رنگ (شکل اصلی، هنوز کاملاً معتبر). آبجکت وقتی
 * می‌آید که رنگ ست شده باشد — `handlers/user.py::_reply_keyboard` هر دو را
 * می‌خواند.
 */
export type ReplyKeyboardCell = string | { text: string; style: string };

export type ReplyKeyboard = {
  rows: ReplyKeyboardCell[][];
  resize: boolean;
  one_time: boolean;
  placeholder: string;
};

/** زبان‌هایی که بات پشتیبانی می‌کند (`utils/i18n.py`). */
export const BOT_LANGUAGES = ["fa", "en", "tr", "ar", "ru"] as const;

// ─── پیش‌فرض‌ها (مو‌به‌مو از `models.py`) ─────────────────────────────────────

export function nowIso(): string {
  // بات `datetime.utcnow().isoformat()` می‌زند: بدون پسوند Z.
  return new Date().toISOString().replace("Z", "");
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function defaultWorkingHours(): WorkingHours {
  return {
    enabled: false,
    open_time: "09:00",
    close_time: "21:00",
    days: [0, 1, 2, 3, 4],
    closed_message: "ربات در حال حاضر فعال نیست. لطفاً بعداً تلاش کنید.",
  };
}

export function defaultAntiFlood(): AntiFlood {
  return {
    enabled: true,
    max_messages: 5,
    interval_seconds: 5,
    ban_duration_seconds: 60,
    warn_message: "⚠️ لطفاً کمی صبر کنید.",
  };
}

export function defaultBotSettings(): BotSettings {
  return {
    language: "fa",
    welcome_msg: "سلام! به ربات خوش آمدید. 👋",
    welcome_enabled: true,
    error_msg: "خطایی رخ داد. لطفاً دوباره تلاش کنید.",
    not_found_msg: "این بخش یافت نشد.",
    panel_inactive_msg: "این بخش فعلاً غیرفعال است. لطفاً بعداً مراجعه کنید.",
    banned_msg: "شما از استفاده از این ربات محروم شده‌اید.",
    maintenance_msg: "ربات در حال تعمیر است. به زودی برمی‌گردیم! 🔧",
    watermark: "",
    watermark_enabled: false,
    maintenance: false,
    reply_keyboard: null,
    force_join_channels: [],
    force_join_message: "برای استفاده از ربات ابتدا در کانال‌های زیر عضو شوید:",
    working_hours: defaultWorkingHours(),
    anti_flood: defaultAntiFlood(),
    home_panel_id: null,
    support_username: "",
    support_message: "برای پشتیبانی با {support} تماس بگیرید.",
    currency: "تومان",
    payment_info: "",
    order_confirm_msg: "✅ پرداخت شما تأیید شد!\n\n🆔 شماره سفارش: {order_id}\n💰 مبلغ: {amount}",
    order_reject_msg:
      "❌ پرداخت شما رد شد.\n\n🆔 شماره سفارش: {order_id}\n📝 دلیل: {reason}\n\nدر صورت نیاز با پشتیبانی تماس بگیرید.",
    order_track_msg:
      "⏳ سفارش شما در حال بررسی بیشتر است.\n\n🆔 شماره سفارش: {order_id}\n{reason}\nنتیجه به‌زودی اطلاع‌رسانی می‌شود.",
    updated_at: nowIso(),
  };
}

export function newPanel(partial: Partial<Panel> = {}): Panel {
  const ts = nowIso();
  return {
    id: partial.id ?? newUuid(),
    title: partial.title ?? "",
    type: partial.type ?? "text",
    content: partial.content ?? "",
    media_file_id: partial.media_file_id ?? "",
    buttons: partial.buttons ?? [],
    settings: partial.settings ?? {},
    children: partial.children ?? [],
    parent_id: partial.parent_id ?? null,
    is_home: partial.is_home ?? false,
    is_active: partial.is_active ?? true,
    created_at: partial.created_at ?? ts,
    updated_at: partial.updated_at ?? ts,
  };
}

export function newForm(partial: Partial<Form> = {}): Form {
  return {
    id: partial.id ?? newUuid(),
    title: partial.title ?? "",
    fields: partial.fields ?? [],
    destination_group: partial.destination_group ?? "",
    destination_admin_ids: partial.destination_admin_ids ?? [],
    thank_you_message: partial.thank_you_message ?? "فرم شما با موفقیت ثبت شد. ✅",
    is_active: partial.is_active ?? true,
    notify_admin: partial.notify_admin ?? true,
    allow_edit: partial.allow_edit ?? false,
    created_at: partial.created_at ?? nowIso(),
  };
}

export function newButton(partial: Partial<PanelButton> = {}): PanelButton {
  return {
    label: partial.label ?? "",
    action: partial.action ?? "panel",
    value: partial.value ?? "",
    row: partial.row ?? 0,
    col: partial.col ?? 0,
    row_start: partial.row_start ?? true,
    style: partial.style ?? "",
  };
}

// ─── نرمال‌سازی چیدمان دکمه‌ها (معادل `_migrate_row_starts` + `_apply_row_starts`) ──

/**
 * هر دکمه را صاحب `row_start` صریح می‌کند، بعد `row`/`col` را از روی همان
 * بازمی‌سازد. خروجی همیشه با چیزی که بات رندر می‌کند یکی است.
 * معادل دقیق `panel_builder.py:985-1006`.
 */
export function normalizeButtonLayout(buttons: PanelButton[]): PanelButton[] {
  const migrated = buttons.map((b, i) => ({
    ...b,
    row_start:
      b.row_start === undefined
        ? i === 0
          ? true
          : (b.row ?? 0) !== (buttons[i - 1]?.row ?? 0)
        : Boolean(b.row_start),
  }));
  let row = -1;
  let col = 0;
  return migrated.map((b, i) => {
    const starts = i === 0 ? true : Boolean(b.row_start);
    if (starts) {
      row += 1;
      col = 0;
    }
    const out = { ...b, row_start: starts, row, col };
    col += 1;
    return out;
  });
}

/** لیست تخت دکمه‌ها → ردیف‌های صریح (برای UI). */
export function buttonsToRows(buttons: PanelButton[]): PanelButton[][] {
  const rows: PanelButton[][] = [];
  for (const b of normalizeButtonLayout(buttons)) {
    if (b.row_start || rows.length === 0) rows.push([]);
    rows[rows.length - 1].push(b);
  }
  return rows;
}

/**
 * حداکثر دکمه در یک ردیفِ کیبورد اینلاین.
 *
 * تلگرام سقف سختی اعلام نکرده، ولی از حدود ۵ دکمه به بعد برچسب‌ها روی
 * موبایل بریده می‌شوند و ردیف عملاً ناخوانا می‌شود — چیزی که کاربر فقط بعد
 * از انتشار پنل می‌فهمد. آینه‌ی این ثابت در
 * `irforge/src/lib/panel-buttons.ts` است و هر دو باید با هم عوض شوند.
 */
export const MAX_BUTTONS_PER_ROW = 4;

/**
 * ردیفی که از سقف رد شده را پیدا می‌کند (شماره‌ی ردیف، ۱-پایه، برای پیام خطا).
 * روی خروجیِ نرمال‌شده کار می‌کند، چون `row` تنها بعد از نرمال‌سازی معتبر است.
 */
export function findOverfullRow(buttons: PanelButton[]): { row: number; count: number } | null {
  const counts = new Map<number, number>();
  for (const b of normalizeButtonLayout(buttons)) {
    counts.set(b.row, (counts.get(b.row) ?? 0) + 1);
  }
  for (const [row, count] of counts) {
    if (count > MAX_BUTTONS_PER_ROW) return { row: row + 1, count };
  }
  return null;
}

/** ردیف‌های UI → لیست تختِ نرمال‌شده (برای ذخیره). */
export function rowsToButtons(rows: PanelButton[][]): PanelButton[] {
  const flat: PanelButton[] = [];
  for (const row of rows) {
    row.forEach((b, i) => flat.push({ ...b, row_start: i === 0 }));
  }
  return normalizeButtonLayout(flat);
}
