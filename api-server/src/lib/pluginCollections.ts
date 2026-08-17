/**
 * lib/pluginCollections.ts — «کدام پلاگین چه داده‌ای دارد و سایت چطور ویرایشش کند».
 * ─────────────────────────────────────────────────────────────────────────────
 * هر پلاگین تازه‌ی بات یک یا چند تب key/value روی شیت تننت دارد. سکشن سایتِ آن
 * پلاگین باید همان‌ها را فهرست/بسازد/ویرایش/حذف کند.
 *
 * چرا اعلامی (declarative) و نه یک فایل روت به‌ازای هر تب: هفده تب داریم و
 * روت‌های CRUD همه‌شان ساختار یکسانی دارند (`routes/botForms.ts` را ببینید و
 * تصور کنید هفده بار کپی شود). یک اسکیمای اعلامی یعنی ولیدیشن، گیت پلاگین،
 * تولید شناسه و نرمال‌سازی **یک جا** درست می‌شوند، نه هفده جا با هفده باگ
 * متفاوت. UI هم همین اسکیما را از سرور می‌گیرد، پس یک سکشن جدید در بات نیازی
 * به نوشتن فرم دستی در فرانت ندارد.
 *
 * قواعدی که اینجا رعایت می‌شوند:
 *   - شکل هر رکورد مو‌به‌مو همان است که پلاگین پایتونی می‌نویسد
 *     (`plugins/<id>/domain.py`، آرگومان `fields` هر `RecordStore`). یک نام
 *     فیلد متفاوت یعنی بات آن را نمی‌بیند.
 *   - شناسه‌ها با همان قالب بات ساخته می‌شوند: `<prefix>_<hex12>`
 *     (`plugins/_common/store.py:new_id`).
 *   - فیلدهای محاسبه‌شده/شمارنده‌ها `readonly`اند: سایت نباید `booked_count`
 *     یا `sent_count` را دستی عوض کند، چون بات خودش نگه‌شان می‌دارد.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "datetime"
  | "readonly";

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  maxLength?: number;
  /** مقدار پیش‌فرض موقع ساخت، اگر کلاینت نفرستد. */
  default?: string | number | boolean;
  help?: string;
};

export type CollectionSpec = {
  /** بخش مسیر URL. */
  key: string;
  /** تب شیت تننت. */
  tab: string;
  /** پلاگینی که این مجموعه پشتش گیت می‌شود. */
  plugin: string;
  titleFa: string;
  descriptionFa?: string;
  /** پیشوند شناسه — همان که `domain.py` استفاده می‌کند. */
  idPrefix: string;
  fields: FieldSpec[];
  /** ستون‌های جدول در UI (زیرمجموعه‌ای از کلیدهای fields). */
  listColumns: string[];
  /** مرتب‌سازی نزولی روی این فیلد. */
  sortBy?: string;
  /** true = فقط خواندنی؛ ساخت/ویرایش/حذف از سایت مجاز نیست. */
  readonly?: boolean;
  /** true = ساخت از سایت مجاز نیست، ولی ویرایش/حذف آری. */
  noCreate?: boolean;
};

const BOOL_OPTS = [
  { value: "true", label: "بله" },
  { value: "false", label: "خیر" },
];

/** وضعیت‌های رزرو — `plugins/booking/domain.py`. */
const BOOKING_STATUS = [
  { value: "pending", label: "در انتظار تأیید" },
  { value: "confirmed", label: "تأییدشده" },
  { value: "canceled", label: "لغوشده" },
  { value: "done", label: "انجام‌شده" },
];

/** وضعیت‌های عضویت — `plugins/subscription/domain.py`. */
const SUB_STATUS = [
  { value: "trial", label: "دوره‌ی آزمایشی" },
  { value: "active", label: "فعال" },
  { value: "expired", label: "منقضی" },
  { value: "canceled", label: "لغوشده" },
];

/** وضعیت‌های قرعه‌کشی — `plugins/giveaway/domain.py`. */
const GIVEAWAY_STATUS = [
  { value: "draft", label: "پیش‌نویس" },
  { value: "running", label: "در جریان" },
  { value: "drawn", label: "قرعه‌کشی‌شده" },
  { value: "canceled", label: "لغوشده" },
];

export const COLLECTIONS: CollectionSpec[] = [
  // ── باشگاه مشتریان ─────────────────────────────────────────────────────
  {
    key: "loyalty-tiers",
    tab: "loyalty_club_tiers",
    plugin: "loyalty",
    titleFa: "سطح‌های باشگاه",
    descriptionFa: "سطح مشتری بر اساس امتیاز مجموع. کاربر با رد کردن آستانه، خودکار به سطح بالاتر می‌رود.",
    idPrefix: "tier",
    fields: [
      { key: "name", label: "نام سطح", type: "text", required: true, maxLength: 40 },
      { key: "min_points", label: "حداقل امتیاز مجموع", type: "number", required: true, min: 0 },
      { key: "discount_percent", label: "درصد تخفیف", type: "number", min: 0, max: 100, default: 0 },
      { key: "perk", label: "مزیت (متن آزاد)", type: "text", maxLength: 120 },
    ],
    listColumns: ["name", "min_points", "discount_percent", "perk"],
    sortBy: "min_points",
  },
  {
    key: "loyalty-accounts",
    tab: "loyalty_accounts",
    plugin: "loyalty",
    titleFa: "حساب‌های امتیاز",
    descriptionFa: "امتیاز هر کاربر. تعدیل امتیاز باید از داخل بات انجام شود تا در تاریخچه‌ی کاربر ثبت شود.",
    idPrefix: "",
    // تعدیل امتیاز از اینجا مجاز نیست: بات هر تغییر را در تب `loyalty_events`
    // هم ثبت می‌کند. نوشتن مستقیم اینجا، موجودی را بدون رکورد لِجِر عوض
    // می‌کرد و «چرا امتیازم کم شد؟» بی‌جواب می‌ماند.
    readonly: true,
    fields: [
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "username", label: "یوزرنیم", type: "readonly" },
      { key: "points", label: "امتیاز فعلی", type: "readonly" },
      { key: "lifetime_points", label: "امتیاز مجموع", type: "readonly" },
      { key: "tier", label: "سطح", type: "readonly" },
    ],
    listColumns: ["user_id", "username", "points", "lifetime_points", "tier"],
    sortBy: "lifetime_points",
  },

  // ── رزرو نوبت ──────────────────────────────────────────────────────────
  {
    key: "booking-services",
    tab: "booking_services",
    plugin: "booking",
    titleFa: "سرویس‌های قابل رزرو",
    descriptionFa: "چه چیزی رزرو می‌شود. بعد از ساخت سرویس، بازه‌های زمانی‌اش را از داخل بات بسازید.",
    idPrefix: "svc",
    fields: [
      { key: "title", label: "نام سرویس", type: "text", required: true, maxLength: 80 },
      { key: "description", label: "توضیح", type: "textarea", maxLength: 500 },
      { key: "duration_minutes", label: "مدت (دقیقه)", type: "number", required: true, min: 1, default: 30 },
      { key: "price", label: "هزینه (تومان)", type: "number", min: 0, default: 0 },
      {
        key: "requires_approval", label: "نیاز به تأیید ادمین", type: "boolean", default: true,
        help: "خاموش = رزرو کاربر مستقیم تأییدشده ثبت می‌شود.",
      },
      { key: "is_active", label: "فعال", type: "boolean", default: true },
    ],
    listColumns: ["title", "duration_minutes", "price", "requires_approval", "is_active"],
    sortBy: "title",
  },
  {
    key: "booking-slots",
    tab: "booking_slots",
    plugin: "booking",
    titleFa: "بازه‌های زمانی",
    descriptionFa: "ظرفیت هر بازه مستقل است. ساخت انبوه بازه از داخل بات راحت‌تر است.",
    idPrefix: "slot",
    fields: [
      { key: "service_id", label: "شناسه سرویس", type: "text", required: true },
      { key: "starts_at", label: "زمان شروع", type: "datetime", required: true },
      { key: "capacity", label: "ظرفیت", type: "number", required: true, min: 1, default: 1 },
      // بات خودش با هر رزرو/لغو این را جابه‌جا می‌کند.
      { key: "booked_count", label: "رزروشده", type: "readonly" },
      { key: "is_active", label: "فعال", type: "boolean", default: true },
    ],
    listColumns: ["starts_at", "service_id", "capacity", "booked_count", "is_active"],
    sortBy: "starts_at",
  },
  {
    key: "booking-reservations",
    tab: "booking_reservations",
    plugin: "booking",
    titleFa: "رزروها",
    descriptionFa: "تأیید یا رد رزرو. تغییر وضعیت به «لغوشده» از داخل بات، ظرفیت بازه را هم آزاد می‌کند.",
    idPrefix: "rsv",
    // ساخت رزرو از سایت مجاز نیست: `reserve()` در بات ظرفیت را چک و
    // `booked_count` را افزایش می‌دهد. یک ردیف دستی، آن شمارنده را عقب
    // می‌انداخت و بازه بیش از ظرفیتش رزرو می‌شد.
    noCreate: true,
    fields: [
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "username", label: "یوزرنیم", type: "readonly" },
      { key: "service_id", label: "شناسه سرویس", type: "readonly" },
      { key: "slot_id", label: "شناسه بازه", type: "readonly" },
      { key: "status", label: "وضعیت", type: "select", options: BOOKING_STATUS },
      { key: "note", label: "توضیح کاربر", type: "textarea", maxLength: 300 },
    ],
    listColumns: ["user_id", "service_id", "status", "note", "created_at"],
    sortBy: "created_at",
  },

  // ── اشتراک دوره‌ای ─────────────────────────────────────────────────────
  {
    key: "member-plans",
    tab: "member_plans",
    plugin: "subscription",
    titleFa: "پلن‌های اشتراک",
    descriptionFa: "اشتراکی که شما به کاربران بات خودتان می‌فروشید (بی‌ربط به پلن حساب خودتان در IrForge).",
    idPrefix: "plan",
    fields: [
      { key: "name", label: "نام پلن", type: "text", required: true, maxLength: 80 },
      { key: "description", label: "توضیح", type: "textarea", maxLength: 500 },
      { key: "price", label: "قیمت هر دوره (تومان)", type: "number", min: 0, default: 0 },
      { key: "period_days", label: "مدت دوره (روز)", type: "number", required: true, min: 1, default: 30 },
      {
        key: "trial_days", label: "دوره‌ی آزمایشی (روز)", type: "number", min: 0, default: 0,
        help: "فقط یک بار به هر کاربر داده می‌شود.",
      },
      { key: "perk", label: "مزیت (متن آزاد)", type: "text", maxLength: 120 },
      { key: "is_active", label: "فعال", type: "boolean", default: true },
    ],
    listColumns: ["name", "price", "period_days", "trial_days", "is_active"],
    sortBy: "price",
  },
  {
    key: "member-subscriptions",
    tab: "member_subscriptions",
    plugin: "subscription",
    titleFa: "اعضای اشتراک",
    descriptionFa: "«فعال بودن» از تاریخ پایان دوره خوانده می‌شود، نه از فیلد وضعیت — پس تمدید یعنی جابه‌جا کردن همان تاریخ.",
    idPrefix: "sub",
    noCreate: true,
    fields: [
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "username", label: "یوزرنیم", type: "readonly" },
      { key: "plan_id", label: "شناسه پلن", type: "readonly" },
      { key: "status", label: "وضعیت", type: "select", options: SUB_STATUS },
      { key: "current_period_end", label: "پایان دوره", type: "datetime" },
      { key: "auto_renew", label: "تمدید خودکار", type: "boolean" },
    ],
    listColumns: ["user_id", "plan_id", "status", "current_period_end", "auto_renew"],
    sortBy: "current_period_end",
  },

  // ── قرعه‌کشی ───────────────────────────────────────────────────────────
  {
    key: "giveaways",
    tab: "giveaways",
    plugin: "giveaway",
    titleFa: "کمپین‌های قرعه‌کشی",
    descriptionFa: "خودِ قرعه‌کشی (انتخاب برنده) از داخل بات انجام می‌شود تا نتیجه یک بار و برای همیشه ثبت شود.",
    idPrefix: "gw",
    fields: [
      { key: "title", label: "عنوان", type: "text", required: true, maxLength: 80 },
      { key: "prize", label: "جایزه", type: "text", required: true, maxLength: 120 },
      { key: "description", label: "توضیح", type: "textarea", maxLength: 500 },
      { key: "winner_count", label: "تعداد برنده", type: "number", required: true, min: 1, default: 1 },
      { key: "status", label: "وضعیت", type: "select", options: GIVEAWAY_STATUS, default: "running" },
      { key: "ends_at", label: "زمان پایان", type: "datetime", help: "خالی = بدون پایان خودکار." },
      {
        key: "require_channel", label: "شرط عضویت در کانال", type: "text", maxLength: 80,
        help: "با @ بنویسید. بات باید در آن کانال ادمین باشد.",
      },
      { key: "min_points", label: "حداقل امتیاز باشگاه", type: "number", min: 0, default: 0 },
      { key: "entry_count", label: "شرکت‌کننده", type: "readonly" },
    ],
    listColumns: ["title", "prize", "status", "winner_count", "entry_count", "ends_at"],
    sortBy: "created_at",
  },
  {
    key: "giveaway-entries",
    tab: "giveaway_entries",
    plugin: "giveaway",
    titleFa: "شرکت‌کنندگان",
    idPrefix: "gwe",
    readonly: true,
    fields: [
      { key: "giveaway_id", label: "شناسه کمپین", type: "readonly" },
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "username", label: "یوزرنیم", type: "readonly" },
    ],
    listColumns: ["giveaway_id", "user_id", "username", "created_at"],
    sortBy: "created_at",
  },

  // ── نظرسنجی ────────────────────────────────────────────────────────────
  {
    key: "surveys",
    tab: "surveys",
    plugin: "survey",
    titleFa: "نظرسنجی‌ها و کوییزها",
    descriptionFa: "سؤال‌ها از داخل بات اضافه می‌شوند. تا سؤال نداشته باشد منتشر نمی‌شود.",
    idPrefix: "sv",
    fields: [
      { key: "title", label: "عنوان", type: "text", required: true, maxLength: 100 },
      { key: "description", label: "توضیح", type: "textarea", maxLength: 500 },
      { key: "is_quiz", label: "کوییز است (نمره دارد)", type: "boolean", default: false },
      { key: "anonymous", label: "بی‌نام", type: "boolean", default: false },
      { key: "is_active", label: "منتشرشده", type: "boolean", default: false },
      { key: "response_count", label: "پاسخ‌ها", type: "readonly" },
    ],
    listColumns: ["title", "is_quiz", "is_active", "response_count"],
    sortBy: "created_at",
  },
  {
    key: "survey-responses",
    tab: "survey_responses",
    plugin: "survey",
    titleFa: "پاسخ‌های نظرسنجی",
    idPrefix: "svr",
    readonly: true,
    fields: [
      { key: "survey_id", label: "شناسه نظرسنجی", type: "readonly" },
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "score", label: "نمره", type: "readonly" },
      { key: "max_score", label: "از", type: "readonly" },
    ],
    listColumns: ["survey_id", "user_id", "score", "max_score", "created_at"],
    sortBy: "created_at",
  },

  // ── پیام زمان‌بندی‌شده ─────────────────────────────────────────────────
  {
    key: "drip-campaigns",
    tab: "drip_campaigns",
    plugin: "drip",
    titleFa: "کمپین‌های پیام زمان‌بندی‌شده",
    descriptionFa: "«وقتی این رویداد رخ داد، پس از این تأخیر این پیام را بفرست.»",
    idPrefix: "drp",
    fields: [
      { key: "title", label: "نام کمپین", type: "text", required: true, maxLength: 80 },
      {
        key: "trigger_event", label: "رویداد محرک", type: "text", required: true, maxLength: 80,
        help: "مثل event.booking.created — الگوی * هم قبول است (event.wallet.*).",
      },
      {
        key: "delay_minutes", label: "تأخیر (دقیقه)", type: "number", required: true, min: 0,
        max: 129600, default: 0,
      },
      { key: "message", label: "متن پیام", type: "textarea", required: true, maxLength: 3000 },
      { key: "once_per_user", label: "فقط یک بار برای هر کاربر", type: "boolean", default: true },
      { key: "is_active", label: "فعال", type: "boolean", default: true },
      { key: "sent_count", label: "ارسال‌شده", type: "readonly" },
    ],
    listColumns: ["title", "trigger_event", "delay_minutes", "is_active", "sent_count"],
    sortBy: "created_at",
  },
  {
    key: "drip-deliveries",
    tab: "drip_deliveries",
    plugin: "drip",
    titleFa: "صف ارسال",
    idPrefix: "drd",
    readonly: true,
    fields: [
      { key: "campaign_id", label: "شناسه کمپین", type: "readonly" },
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "due_at", label: "زمان سررسید", type: "readonly" },
      { key: "status", label: "وضعیت", type: "readonly" },
      { key: "error", label: "خطا", type: "readonly" },
    ],
    listColumns: ["user_id", "campaign_id", "due_at", "status", "error"],
    sortBy: "due_at",
  },

  // ── CRM ────────────────────────────────────────────────────────────────
  {
    key: "crm-tags",
    tab: "crm_tags",
    plugin: "crm",
    titleFa: "برچسب‌ها",
    descriptionFa: "ابزار سگمنت‌بندی کاربران. تخصیص برچسب به کاربر از داخل بات انجام می‌شود.",
    idPrefix: "tag",
    fields: [
      { key: "name", label: "نام برچسب", type: "text", required: true, maxLength: 40 },
      { key: "emoji", label: "ایموجی", type: "text", maxLength: 4, default: "🏷" },
      { key: "description", label: "توضیح", type: "textarea", maxLength: 200 },
    ],
    listColumns: ["emoji", "name", "description"],
    sortBy: "name",
  },
  {
    key: "crm-user-tags",
    tab: "crm_user_tags",
    plugin: "crm",
    titleFa: "تخصیص برچسب‌ها",
    descriptionFa: "کدام کاربر چه برچسبی دارد.",
    idPrefix: "",
    // کلید این تب ترکیبی است (`<user_id>:<tag_id>`) و بات همان را می‌سازد؛
    // ساخت از سایت با شناسه‌ی تصادفی، «برچسب تکراری» را ممکن می‌کرد.
    readonly: true,
    fields: [
      { key: "user_id", label: "شناسه کاربر", type: "readonly" },
      { key: "tag_id", label: "شناسه برچسب", type: "readonly" },
      { key: "assigned_by", label: "توسط", type: "readonly" },
    ],
    listColumns: ["user_id", "tag_id", "assigned_by", "created_at"],
    sortBy: "created_at",
  },
  {
    key: "crm-notes",
    tab: "crm_notes",
    plugin: "crm",
    titleFa: "یادداشت‌های ادمین",
    idPrefix: "note",
    fields: [
      { key: "user_id", label: "شناسه کاربر", type: "text", required: true },
      { key: "body", label: "متن یادداشت", type: "textarea", required: true, maxLength: 1000 },
      { key: "author_id", label: "نویسنده", type: "readonly" },
    ],
    listColumns: ["user_id", "body", "author_id", "created_at"],
    sortBy: "created_at",
  },
];

const BY_KEY = new Map(COLLECTIONS.map((c) => [c.key, c]));

export function getCollection(key: string): CollectionSpec | null {
  return BY_KEY.get(key) ?? null;
}

/** مجموعه‌های یک پلاگین. */
export function collectionsOfPlugin(pluginId: string): CollectionSpec[] {
  return COLLECTIONS.filter((c) => c.plugin === pluginId);
}

/**
 * شناسه‌ی تازه با همان قالب بات: `<prefix>_<hex12>`
 * (`plugins/_common/store.py:new_id`). بدون پیشوند، فقط hex12.
 */
export function newRecordId(prefix: string): string {
  let hex = "";
  while (hex.length < 12) hex += Math.floor(Math.random() * 16).toString(16);
  return prefix ? `${prefix}_${hex.slice(0, 12)}` : hex.slice(0, 12);
}
