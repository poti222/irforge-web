/**
 * lib/coreCommandsCatalog.ts — کامندهایِ Core بات، آینه‌ی
 * `utils/bot_manager.py::_CORE_HANDLER_MODULES`.
 * ─────────────────────────────────────────────────────────────────────────────
 * لایوباگ ۲۰۲۶-۰۹-۲۸: «کامند ساپورت بدون نصب پلاگین ساپورت یا تیکت هست و
 * ساخته می‌شه ... تمامی کامند ها باید نمایش داده بشه». علتِ ریشه‌ای:
 * `/support` (و هر کامندِ Core دیگری) همیشه و بدونِ قیدوشرط لود می‌شود --
 * هیچ `is_enabled` گیتی ندارد، برخلافِ هر روترِ پلاگین -- ولی بخشِ «کامندها»ی
 * سایت (`routes/botCommands.ts`) فقط تبِ `custom_commands` را می‌خواند، پس
 * این کامندها نه دیده می‌شدند و نه قابلِ‌غیرفعال‌سازی بودند.
 *
 * برخلافِ کامندهایِ پلاگین‌ها (`plugin_catalog` -- منتشرشده از خودِ کدِ بات،
 * `services/plugin_catalog_publisher.py`، بدونِ کپیِ دستی)، این‌ها راهِ
 * سینک‌شدنِ خودکار ندارند: هیچ manifest‌ای برایِ ماژول‌هایِ Core وجود ندارد،
 * فقط `Command("...")`ی هاردکد داخلِ `handlers/*.py`. پس این فایل -- دقیقاً
 * مثلِ سه خواهرِ خودش (`pluginCommandTargets.ts`/`pluginButtonActions.ts`/
 * `pluginPanelTypes.ts`) -- یک کپیِ **دستیِ نگه‌داری‌شده** است؛ کامندِ Core
 * تازه‌ای که به بات اضافه می‌شود باید همین‌جا هم اضافه شود.
 *
 * `locked: true` یعنی حتی خودِ ادمین هم نمی‌تواند از سایت غیرفعالش کند --
 * دقیقاً همان لیستِ `_NEVER_DISABLE` داخلِ
 * `utils/command_gate_middleware.py` (بات مستقلاً و به‌صورتِ hard-coded هم
 * این را اجرا می‌کند؛ اینجا فقط UI را غیرفعال می‌کند تا ادمین اصلاً امتحان
 * نکند) -- کامندهایی که خاموش‌کردنِ اشتباهی‌شان یعنی از دسترس‌افتادنِ کاملِ
 * بات (`start`/`admin`/`cancel`) یا ابزارِ اضطراریِ خودِ پلتفرم
 * (`emergency_*`، `handlers/emergency.py`).
 *
 * `adminOnly` فقط برایِ مقدارِ اولیه‌ی ردیفِ مادی‌شده است (تا کامندی که فقط
 * ادمین می‌بیندش با پیش‌فرضِ درست ساخته شود) -- تغییرش بعداً از سایت خودِ
 * ردیف را عوض می‌کند، دقیقاً مثلِ هر کامندِ سفارشیِ دیگر.
 */

export type CoreCommandCatalogEntry = {
  command: string;
  description: string;
  adminOnly: boolean;
  locked?: boolean;
};

export const CORE_COMMANDS: CoreCommandCatalogEntry[] = [
  // handlers/user.py
  { command: "start", description: "شروع / آغاز کار با بات", adminOnly: false, locked: true },
  { command: "help", description: "راهنما", adminOnly: false },
  { command: "id", description: "نمایش آیدی عددی کاربر", adminOnly: false },
  { command: "profile", description: "پروفایل من", adminOnly: false },
  { command: "rs", description: "شروعِ دوباره / بازنشانیِ مسیرِ جاری", adminOnly: false },
  { command: "cancel", description: "لغو عملیات جاری", adminOnly: false, locked: true },

  // handlers/admin_auth.py
  { command: "admin", description: "ورود به پنل مدیریت", adminOnly: true, locked: true },

  // handlers/admin_panel.py
  { command: "stats", description: "آمار بات", adminOnly: true },
  { command: "backup", description: "بک‌آپ داده‌ها", adminOnly: true },

  // handlers/broadcast.py
  { command: "broadcast", description: "ارسال پیام همگانی", adminOnly: true },

  // handlers/form_builder.py
  { command: "forms", description: "مدیریت فرم‌ها", adminOnly: true },

  // handlers/payment.py
  { command: "pay", description: "شروعِ فرایندِ پرداخت", adminOnly: true },
  { command: "ACPT", description: "تأیید سفارش (ادمین، داخل گروه)", adminOnly: true },
  { command: "RJCT", description: "رد سفارش (ادمین، داخل گروه)", adminOnly: true },
  { command: "PSTPN", description: "تعویق سفارش (ادمین، داخل گروه)", adminOnly: true },

  // handlers/object_admin.py / workflow_admin.py / plugin_admin.py / relation_admin.py
  { command: "objects", description: "مدیریت اشیای پویا (Object Engine)", adminOnly: true },
  { command: "workflows", description: "مدیریت ورک‌فلوها", adminOnly: true },
  { command: "plugins", description: "مدیریت پلاگین‌ها", adminOnly: true },
  { command: "relations", description: "مدیریت رابطه‌ها", adminOnly: true },

  // handlers/support.py — همان کامندِ گزارش‌شده در این باگ
  { command: "support", description: "پشتیبانی / ثبت پیام برای تیم پشتیبانی", adminOnly: false },
  { command: "tickets", description: "صف تیکت‌های پشتیبانی (ادمین)", adminOnly: true },

  // handlers/language.py
  { command: "language", description: "تغییر زبان بات", adminOnly: false },

  // handlers/telegram_features.py
  { command: "ban", description: "مسدودکردن کاربر", adminOnly: true },
  { command: "mute", description: "بی‌صداکردنِ کاربر در گروه", adminOnly: true },
  { command: "promote", description: "ارتقای کاربر در گروه", adminOnly: true },
  { command: "chatid", description: "نمایش آیدیِ همین چت/گروه", adminOnly: false },
  { command: "userid", description: "نمایش آیدیِ عددیِ یک کاربر", adminOnly: false },

  // handlers/emergency.py — ابزار اضطراریِ خودِ پلتفرم، هرگز از سایت غیرفعال نشود
  { command: "emergency_auth", description: "احراز هویتِ اضطراری", adminOnly: true, locked: true },
  { command: "emergency_bot_pause", description: "توقفِ اضطراریِ بات", adminOnly: true, locked: true },
  { command: "emergency_panel_toggle", description: "خاموش/روشنِ اضطراریِ یک پنل", adminOnly: true, locked: true },
  { command: "emergency_wallet_freeze", description: "فریزِ اضطراریِ کیف‌پول", adminOnly: true, locked: true },
  { command: "emergency_grant_admin", description: "اعطایِ اضطراریِ دسترسیِ ادمین", adminOnly: true, locked: true },

  // handlers/growth.py
  { command: "orders", description: "سفارش‌های من", adminOnly: false },
  { command: "wishlist", description: "لیستِ علاقه‌مندی‌ها", adminOnly: false },
  { command: "loyalty", description: "امتیازِ وفاداری", adminOnly: false },
  { command: "referral", description: "دعوت از دوستان / رفرال", adminOnly: false },
  { command: "leaderboard", description: "جدولِ برترین‌ها", adminOnly: false },
  { command: "mytickets", description: "تیکت‌های من", adminOnly: false },
  { command: "notif_settings", description: "تنظیماتِ اعلان‌ها", adminOnly: false },

  // handlers/subscriptions.py
  { command: "link", description: "اتصالِ حساب/اشتراک", adminOnly: false },
  { command: "myplan", description: "پلنِ اشتراکِ من", adminOnly: false },
];

export const NEVER_DISABLE_COMMANDS = new Set(
  CORE_COMMANDS.filter((c) => c.locked).map((c) => c.command)
);
