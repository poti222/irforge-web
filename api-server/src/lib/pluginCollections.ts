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
 * **هر متن نمایشی دوزبانه است** (`{ en, fa }`). نسخه‌ی اول این فایل فقط فارسی
 * داشت (`titleFa`, `label: "..."`)، یعنی کاربری که رابط را انگلیسی کرده بود کل
 * جدول‌ها و فرم‌های مدیریت پلاگین را فارسی می‌دید. عربی/ترکی/روسی به انگلیسی
 * می‌افتند: برچسبِ یک فیلد داده، جای ترجمه‌ی حدسی نیست و انگلیسیِ درست از
 * فارسیِ نامفهوم بهتر است.
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

/** متن نمایشی دوزبانه. UI با زبان جاری یکی را برمی‌دارد. */
export type Localized = { en: string; fa: string };

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
  label: Localized;
  type: FieldType;
  required?: boolean;
  options?: Array<{ value: string; label: Localized }>;
  min?: number;
  max?: number;
  maxLength?: number;
  /** مقدار پیش‌فرض موقع ساخت، اگر کلاینت نفرستد. */
  default?: string | number | boolean;
  help?: Localized;
};

export type CollectionSpec = {
  /** بخش مسیر URL. */
  key: string;
  /** تب شیت تننت. */
  tab: string;
  /** پلاگینی که این مجموعه پشتش گیت می‌شود. */
  plugin: string;
  title: Localized;
  description?: Localized;
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

/** میان‌بر، تا اعلان‌های زیر خوانا بمانند. */
const t = (en: string, fa: string): Localized => ({ en, fa });

/** وضعیت‌های رزرو — `plugins/booking/domain.py`. */
const BOOKING_STATUS = [
  { value: "pending", label: t("Awaiting approval", "در انتظار تأیید") },
  { value: "confirmed", label: t("Confirmed", "تأییدشده") },
  { value: "canceled", label: t("Canceled", "لغوشده") },
  { value: "done", label: t("Done", "انجام‌شده") },
];

/** وضعیت‌های عضویت — `plugins/subscription/domain.py`. */
const SUB_STATUS = [
  { value: "trial", label: t("Trial", "دوره‌ی آزمایشی") },
  { value: "active", label: t("Active", "فعال") },
  { value: "expired", label: t("Expired", "منقضی") },
  { value: "canceled", label: t("Canceled", "لغوشده") },
];

/** وضعیت‌های قرعه‌کشی — `plugins/giveaway/domain.py`. */
const GIVEAWAY_STATUS = [
  { value: "draft", label: t("Draft", "پیش‌نویس") },
  { value: "running", label: t("Running", "در جریان") },
  { value: "drawn", label: t("Drawn", "قرعه‌کشی‌شده") },
  { value: "canceled", label: t("Canceled", "لغوشده") },
];

/** فیلدهای مشترکی که در چند مجموعه تکرار می‌شوند. */
const USER_ID = { key: "user_id", label: t("User ID", "شناسه کاربر"), type: "readonly" } as const;
const USERNAME = { key: "username", label: t("Username", "یوزرنیم"), type: "readonly" } as const;

export const COLLECTIONS: CollectionSpec[] = [
  // ── باشگاه مشتریان ─────────────────────────────────────────────────────
  {
    key: "loyalty-tiers",
    tab: "loyalty_club_tiers",
    plugin: "loyalty",
    title: t("Club tiers", "سطح‌های باشگاه"),
    description: t(
      "Customer tiers based on lifetime points. Crossing a threshold promotes the user automatically.",
      "سطح مشتری بر اساس امتیاز مجموع. کاربر با رد کردن آستانه، خودکار به سطح بالاتر می‌رود.",
    ),
    idPrefix: "tier",
    fields: [
      { key: "name", label: t("Tier name", "نام سطح"), type: "text", required: true, maxLength: 40 },
      { key: "min_points", label: t("Minimum lifetime points", "حداقل امتیاز مجموع"), type: "number", required: true, min: 0 },
      { key: "discount_percent", label: t("Discount percent", "درصد تخفیف"), type: "number", min: 0, max: 100, default: 0 },
      { key: "perk", label: t("Perk (free text)", "مزیت (متن آزاد)"), type: "text", maxLength: 120 },
    ],
    listColumns: ["name", "min_points", "discount_percent", "perk"],
    sortBy: "min_points",
  },
  {
    key: "loyalty-accounts",
    tab: "loyalty_accounts",
    plugin: "loyalty",
    title: t("Points accounts", "حساب‌های امتیاز"),
    description: t(
      "Each user's points. Adjust them from inside the bot so the change is recorded in the user's history.",
      "امتیاز هر کاربر. تعدیل امتیاز باید از داخل بات انجام شود تا در تاریخچه‌ی کاربر ثبت شود.",
    ),
    idPrefix: "",
    // تعدیل امتیاز از اینجا مجاز نیست: بات هر تغییر را در تب `loyalty_events`
    // هم ثبت می‌کند. نوشتن مستقیم اینجا، موجودی را بدون رکورد لِجِر عوض
    // می‌کرد و «چرا امتیازم کم شد؟» بی‌جواب می‌ماند.
    readonly: true,
    fields: [
      USER_ID,
      USERNAME,
      { key: "points", label: t("Current points", "امتیاز فعلی"), type: "readonly" },
      { key: "lifetime_points", label: t("Lifetime points", "امتیاز مجموع"), type: "readonly" },
      { key: "tier", label: t("Tier", "سطح"), type: "readonly" },
    ],
    listColumns: ["user_id", "username", "points", "lifetime_points", "tier"],
    sortBy: "lifetime_points",
  },

  // ── رزرو نوبت ──────────────────────────────────────────────────────────
  {
    key: "booking-services",
    tab: "booking_services",
    plugin: "booking",
    title: t("Bookable services", "سرویس‌های قابل رزرو"),
    description: t(
      "What can be booked. After creating a service, generate its time slots from inside the bot.",
      "چه چیزی رزرو می‌شود. بعد از ساخت سرویس، بازه‌های زمانی‌اش را از داخل بات بسازید.",
    ),
    idPrefix: "svc",
    fields: [
      { key: "title", label: t("Service name", "نام سرویس"), type: "text", required: true, maxLength: 80 },
      { key: "description", label: t("Description", "توضیح"), type: "textarea", maxLength: 500 },
      { key: "duration_minutes", label: t("Duration (minutes)", "مدت (دقیقه)"), type: "number", required: true, min: 1, default: 30 },
      { key: "price", label: t("Price (Toman)", "هزینه (تومان)"), type: "number", min: 0, default: 0 },
      {
        key: "requires_approval", label: t("Needs admin approval", "نیاز به تأیید ادمین"), type: "boolean", default: true,
        help: t("Off means a user's booking is confirmed immediately.", "خاموش = رزرو کاربر مستقیم تأییدشده ثبت می‌شود."),
      },
      { key: "is_active", label: t("Active", "فعال"), type: "boolean", default: true },
    ],
    listColumns: ["title", "duration_minutes", "price", "requires_approval", "is_active"],
    sortBy: "title",
  },
  {
    key: "booking-slots",
    tab: "booking_slots",
    plugin: "booking",
    title: t("Time slots", "بازه‌های زمانی"),
    description: t(
      "Each slot has its own capacity. Generating slots in bulk is easier from inside the bot.",
      "ظرفیت هر بازه مستقل است. ساخت انبوه بازه از داخل بات راحت‌تر است.",
    ),
    idPrefix: "slot",
    fields: [
      { key: "service_id", label: t("Service ID", "شناسه سرویس"), type: "text", required: true },
      { key: "starts_at", label: t("Starts at", "زمان شروع"), type: "datetime", required: true },
      { key: "capacity", label: t("Capacity", "ظرفیت"), type: "number", required: true, min: 1, default: 1 },
      // بات خودش با هر رزرو/لغو این را جابه‌جا می‌کند.
      { key: "booked_count", label: t("Booked", "رزروشده"), type: "readonly" },
      { key: "is_active", label: t("Active", "فعال"), type: "boolean", default: true },
    ],
    listColumns: ["starts_at", "service_id", "capacity", "booked_count", "is_active"],
    sortBy: "starts_at",
  },
  {
    key: "booking-reservations",
    tab: "booking_reservations",
    plugin: "booking",
    title: t("Reservations", "رزروها"),
    description: t(
      "Approve or reject a reservation. Setting it to canceled also frees the slot's capacity.",
      "تأیید یا رد رزرو. تغییر وضعیت به «لغوشده» ظرفیت بازه را هم آزاد می‌کند.",
    ),
    idPrefix: "rsv",
    // ساخت رزرو از سایت مجاز نیست: `reserve()` در بات ظرفیت را چک و
    // `booked_count` را افزایش می‌دهد. یک ردیف دستی، آن شمارنده را عقب
    // می‌انداخت و بازه بیش از ظرفیتش رزرو می‌شد.
    noCreate: true,
    fields: [
      USER_ID,
      USERNAME,
      { key: "service_id", label: t("Service ID", "شناسه سرویس"), type: "readonly" },
      { key: "slot_id", label: t("Slot ID", "شناسه بازه"), type: "readonly" },
      { key: "status", label: t("Status", "وضعیت"), type: "select", options: BOOKING_STATUS },
      { key: "note", label: t("User's note", "توضیح کاربر"), type: "textarea", maxLength: 300 },
    ],
    listColumns: ["user_id", "service_id", "status", "note", "created_at"],
    sortBy: "created_at",
  },

  // ── اشتراک دوره‌ای ─────────────────────────────────────────────────────
  {
    key: "member-plans",
    tab: "member_plans",
    plugin: "subscription",
    title: t("Subscription plans", "پلن‌های اشتراک"),
    description: t(
      "The subscription you sell to your own bot's users — unrelated to your own IrForge plan.",
      "اشتراکی که شما به کاربران بات خودتان می‌فروشید (بی‌ربط به پلن حساب خودتان در IrForge).",
    ),
    idPrefix: "plan",
    fields: [
      { key: "name", label: t("Plan name", "نام پلن"), type: "text", required: true, maxLength: 80 },
      { key: "description", label: t("Description", "توضیح"), type: "textarea", maxLength: 500 },
      { key: "price", label: t("Price per period (Toman)", "قیمت هر دوره (تومان)"), type: "number", min: 0, default: 0 },
      { key: "period_days", label: t("Period length (days)", "مدت دوره (روز)"), type: "number", required: true, min: 1, default: 30 },
      {
        key: "trial_days", label: t("Trial period (days)", "دوره‌ی آزمایشی (روز)"), type: "number", min: 0, default: 0,
        help: t("Granted only once per user.", "فقط یک بار به هر کاربر داده می‌شود."),
      },
      { key: "perk", label: t("Perk (free text)", "مزیت (متن آزاد)"), type: "text", maxLength: 120 },
      { key: "is_active", label: t("Active", "فعال"), type: "boolean", default: true },
    ],
    listColumns: ["name", "price", "period_days", "trial_days", "is_active"],
    sortBy: "price",
  },
  {
    key: "member-subscriptions",
    tab: "member_subscriptions",
    plugin: "subscription",
    title: t("Subscription members", "اعضای اشتراک"),
    description: t(
      "Whether a membership is active is read from the period end date, not the status field — so extending means moving that date.",
      "«فعال بودن» از تاریخ پایان دوره خوانده می‌شود، نه از فیلد وضعیت — پس تمدید یعنی جابه‌جا کردن همان تاریخ.",
    ),
    idPrefix: "sub",
    noCreate: true,
    fields: [
      USER_ID,
      USERNAME,
      { key: "plan_id", label: t("Plan ID", "شناسه پلن"), type: "readonly" },
      { key: "status", label: t("Status", "وضعیت"), type: "select", options: SUB_STATUS },
      { key: "current_period_end", label: t("Period ends", "پایان دوره"), type: "datetime" },
      { key: "auto_renew", label: t("Auto-renew", "تمدید خودکار"), type: "boolean" },
    ],
    listColumns: ["user_id", "plan_id", "status", "current_period_end", "auto_renew"],
    sortBy: "current_period_end",
  },

  // ── قرعه‌کشی ───────────────────────────────────────────────────────────
  {
    key: "giveaways",
    tab: "giveaways",
    plugin: "giveaway",
    title: t("Giveaway campaigns", "کمپین‌های قرعه‌کشی"),
    description: t(
      "The draw itself runs from inside the bot, so the result is recorded once and for good.",
      "خودِ قرعه‌کشی (انتخاب برنده) از داخل بات انجام می‌شود تا نتیجه یک بار و برای همیشه ثبت شود.",
    ),
    idPrefix: "gw",
    fields: [
      { key: "title", label: t("Title", "عنوان"), type: "text", required: true, maxLength: 80 },
      { key: "prize", label: t("Prize", "جایزه"), type: "text", required: true, maxLength: 120 },
      { key: "description", label: t("Description", "توضیح"), type: "textarea", maxLength: 500 },
      { key: "winner_count", label: t("Number of winners", "تعداد برنده"), type: "number", required: true, min: 1, default: 1 },
      { key: "status", label: t("Status", "وضعیت"), type: "select", options: GIVEAWAY_STATUS, default: "running" },
      {
        key: "ends_at", label: t("Ends at", "زمان پایان"), type: "datetime",
        help: t("Empty means no automatic end.", "خالی = بدون پایان خودکار."),
      },
      {
        key: "require_channel", label: t("Required channel membership", "شرط عضویت در کانال"), type: "text", maxLength: 80,
        help: t("Write it with @. The bot must be an admin of that channel.", "با @ بنویسید. بات باید در آن کانال ادمین باشد."),
      },
      { key: "min_points", label: t("Minimum club points", "حداقل امتیاز باشگاه"), type: "number", min: 0, default: 0 },
      { key: "entry_count", label: t("Entries", "شرکت‌کننده"), type: "readonly" },
    ],
    listColumns: ["title", "prize", "status", "winner_count", "entry_count", "ends_at"],
    sortBy: "created_at",
  },
  {
    key: "giveaway-entries",
    tab: "giveaway_entries",
    plugin: "giveaway",
    title: t("Entrants", "شرکت‌کنندگان"),
    idPrefix: "gwe",
    readonly: true,
    fields: [
      { key: "giveaway_id", label: t("Campaign ID", "شناسه کمپین"), type: "readonly" },
      USER_ID,
      USERNAME,
    ],
    listColumns: ["giveaway_id", "user_id", "username", "created_at"],
    sortBy: "created_at",
  },

  // ── نظرسنجی ────────────────────────────────────────────────────────────
  {
    key: "surveys",
    tab: "surveys",
    plugin: "survey",
    title: t("Surveys and quizzes", "نظرسنجی‌ها و کوییزها"),
    description: t(
      "Questions are added from inside the bot. Nothing is published until it has at least one question.",
      "سؤال‌ها از داخل بات اضافه می‌شوند. تا سؤال نداشته باشد منتشر نمی‌شود.",
    ),
    idPrefix: "sv",
    fields: [
      { key: "title", label: t("Title", "عنوان"), type: "text", required: true, maxLength: 100 },
      { key: "description", label: t("Description", "توضیح"), type: "textarea", maxLength: 500 },
      { key: "is_quiz", label: t("Is a quiz (scored)", "کوییز است (نمره دارد)"), type: "boolean", default: false },
      { key: "anonymous", label: t("Anonymous", "بی‌نام"), type: "boolean", default: false },
      { key: "is_active", label: t("Published", "منتشرشده"), type: "boolean", default: false },
      { key: "response_count", label: t("Responses", "پاسخ‌ها"), type: "readonly" },
    ],
    listColumns: ["title", "is_quiz", "is_active", "response_count"],
    sortBy: "created_at",
  },
  {
    key: "survey-responses",
    tab: "survey_responses",
    plugin: "survey",
    title: t("Survey responses", "پاسخ‌های نظرسنجی"),
    idPrefix: "svr",
    readonly: true,
    fields: [
      { key: "survey_id", label: t("Survey ID", "شناسه نظرسنجی"), type: "readonly" },
      USER_ID,
      { key: "score", label: t("Score", "نمره"), type: "readonly" },
      { key: "max_score", label: t("Out of", "از"), type: "readonly" },
    ],
    listColumns: ["survey_id", "user_id", "score", "max_score", "created_at"],
    sortBy: "created_at",
  },

  // ── پیام زمان‌بندی‌شده ─────────────────────────────────────────────────
  {
    key: "drip-campaigns",
    tab: "drip_campaigns",
    plugin: "drip",
    title: t("Drip campaigns", "کمپین‌های پیام زمان‌بندی‌شده"),
    description: t(
      "\"When this event happens, send this message after this delay.\"",
      "«وقتی این رویداد رخ داد، پس از این تأخیر این پیام را بفرست.»",
    ),
    idPrefix: "drp",
    fields: [
      { key: "title", label: t("Campaign name", "نام کمپین"), type: "text", required: true, maxLength: 80 },
      {
        key: "trigger_event", label: t("Trigger event", "رویداد محرک"), type: "text", required: true, maxLength: 80,
        help: t(
          "Such as event.booking.created — a * pattern also works (event.wallet.*).",
          "مثل event.booking.created — الگوی * هم قبول است (event.wallet.*).",
        ),
      },
      {
        key: "delay_minutes", label: t("Delay (minutes)", "تأخیر (دقیقه)"), type: "number", required: true, min: 0,
        max: 129600, default: 0,
      },
      { key: "message", label: t("Message text", "متن پیام"), type: "textarea", required: true, maxLength: 3000 },
      { key: "once_per_user", label: t("Once per user only", "فقط یک بار برای هر کاربر"), type: "boolean", default: true },
      { key: "is_active", label: t("Active", "فعال"), type: "boolean", default: true },
      { key: "sent_count", label: t("Sent", "ارسال‌شده"), type: "readonly" },
    ],
    listColumns: ["title", "trigger_event", "delay_minutes", "is_active", "sent_count"],
    sortBy: "created_at",
  },
  {
    key: "drip-deliveries",
    tab: "drip_deliveries",
    plugin: "drip",
    title: t("Send queue", "صف ارسال"),
    idPrefix: "drd",
    readonly: true,
    fields: [
      { key: "campaign_id", label: t("Campaign ID", "شناسه کمپین"), type: "readonly" },
      USER_ID,
      { key: "due_at", label: t("Due at", "زمان سررسید"), type: "readonly" },
      { key: "status", label: t("Status", "وضعیت"), type: "readonly" },
      { key: "error", label: t("Error", "خطا"), type: "readonly" },
    ],
    listColumns: ["user_id", "campaign_id", "due_at", "status", "error"],
    sortBy: "due_at",
  },

  // ── CRM ────────────────────────────────────────────────────────────────
  {
    key: "crm-tags",
    tab: "crm_tags",
    plugin: "crm",
    title: t("Tags", "برچسب‌ها"),
    description: t(
      "A tool for segmenting users. Assigning a tag to a user is done from inside the bot.",
      "ابزار سگمنت‌بندی کاربران. تخصیص برچسب به کاربر از داخل بات انجام می‌شود.",
    ),
    idPrefix: "tag",
    fields: [
      { key: "name", label: t("Tag name", "نام برچسب"), type: "text", required: true, maxLength: 40 },
      { key: "emoji", label: t("Emoji", "ایموجی"), type: "text", maxLength: 4, default: "🏷" },
      { key: "description", label: t("Description", "توضیح"), type: "textarea", maxLength: 200 },
    ],
    listColumns: ["emoji", "name", "description"],
    sortBy: "name",
  },
  {
    key: "crm-user-tags",
    tab: "crm_user_tags",
    plugin: "crm",
    title: t("Tag assignments", "تخصیص برچسب‌ها"),
    description: t("Which user carries which tag.", "کدام کاربر چه برچسبی دارد."),
    idPrefix: "",
    // کلید این تب ترکیبی است (`<user_id>:<tag_id>`) و بات همان را می‌سازد؛
    // ساخت از سایت با شناسه‌ی تصادفی، «برچسب تکراری» را ممکن می‌کرد.
    readonly: true,
    fields: [
      USER_ID,
      { key: "tag_id", label: t("Tag ID", "شناسه برچسب"), type: "readonly" },
      { key: "assigned_by", label: t("Assigned by", "توسط"), type: "readonly" },
    ],
    listColumns: ["user_id", "tag_id", "assigned_by", "created_at"],
    sortBy: "created_at",
  },
  {
    key: "crm-notes",
    tab: "crm_notes",
    plugin: "crm",
    title: t("Admin notes", "یادداشت‌های ادمین"),
    idPrefix: "note",
    fields: [
      { key: "user_id", label: t("User ID", "شناسه کاربر"), type: "text", required: true },
      { key: "body", label: t("Note text", "متن یادداشت"), type: "textarea", required: true, maxLength: 1000 },
      { key: "author_id", label: t("Author", "نویسنده"), type: "readonly" },
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
