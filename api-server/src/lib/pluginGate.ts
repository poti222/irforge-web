/**
 * lib/pluginGate.ts — «این قابلیت پشت کدام پلاگین است؟»
 * ─────────────────────────────────────────────────────────────────────────────
 * بعضی سکشن‌های workspace فقط وقتی معنی دارند که پلاگین مربوطه‌شان روی آن بات
 * فعال باشد — سفارش‌ها و پرداخت‌ها پشت پلاگین **کیف پول**اند. تا امروز هیچ
 * گیتی وجود نداشت: سکشن سفارش‌ها برای هر باتی نشان داده می‌شد، حتی باتی که
 * اصلاً فروش ندارد، و یک تب همیشه‌خالی به کاربر نشان می‌داد.
 *
 * منبع حقیقت همان چیزی است که خودِ بات می‌خواند: کلید `__plugin_states__`
 * داخل تب `bot_settings` (`utils/plugin_manager.py`). جدول
 * `installed_plugins` سایت — که «خریده شده» را نگه می‌دارد — عمداً اینجا
 * دخالت داده نمی‌شود: خریدن یعنی حق استفاده، فعال‌بودن یعنی بات واقعاً دارد
 * اجرایش می‌کند، و گیت باید از دومی پیروی کند.
 *
 * **گیت سمت سرور، نه فقط UI.** پنهان‌کردن یک تب هیچ چیزی را محافظت نمی‌کند؛
 * روت‌ها مستقیم قابل صدا زدن‌اند.
 */
import { getEntity, BotConfigError } from "./botConfig.js";
import { logger } from "./logger.js";

const SETTINGS_TAB = "bot_settings";
const PLUGIN_STATES_KEY = "__plugin_states__";

/**
 * پیش‌فرضِ هر پلاگین وقتی هیچ وضعیت صریحی ثبت نشده.
 *
 * آینه‌ی `default_enabled` مانیفست‌ها (همان لیستی که در `routes/botPlugins.ts`
 * نگهداری می‌شود). «ثبت‌نشده» با «خاموش» یکی نیست — بات هم همین‌طور رفتار
 * می‌کند — ولی امروز پیش‌فرض همه‌شان `false` است.
 */
const DEFAULT_ENABLED: Record<string, boolean> = {
  catalog: false,
  discount: false,
  referral: false,
  wallet: false,
  // هنوز در بات ساخته نشده. تا وقتی در `__plugin_states__` ظاهر نشود،
  // سکشن تیکت‌ها پنهان می‌ماند.
  ticket: false,
};

/** نام قابل نمایش، برای پیام خطا. */
const PLUGIN_LABEL: Record<string, string> = {
  catalog: "فروشگاه / کاتالوگ",
  discount: "کد تخفیف",
  referral: "سیستم رفرال",
  wallet: "کیف پول",
  ticket: "تیکت",
};

/**
 * آیا این پلاگین روی این بات فعال است؟
 *
 * **هرگز throw نمی‌کند.** اگر شیت خوانده نشد، پیش‌فرض مانیفست برمی‌گردد؛ یک
 * خطای موقتی گوگل‌شیت نباید به‌شکل «پلاگین شما خاموش است» به کاربر نشان داده
 * شود.
 */
export async function isPluginEnabled(spreadsheetId: string, pluginId: string): Promise<boolean> {
  const fallback = DEFAULT_ENABLED[pluginId] ?? false;
  try {
    const raw = await getEntity<Record<string, unknown>>(spreadsheetId, SETTINGS_TAB, PLUGIN_STATES_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    if (!(pluginId in raw)) return fallback;
    return Boolean(raw[pluginId]);
  } catch (err) {
    logger.debug({ err, spreadsheetId, pluginId }, "isPluginEnabled failed; using manifest default");
    return fallback;
  }
}

/**
 * اگر پلاگین فعال نیست، ۴۰۳ با پیامی که می‌گوید کجا روشنش کند.
 *
 * کد خطا (`plugin_disabled`) ثابت است تا فرانت بتواند به‌جای یک خطای قرمز،
 * یک حالت خالیِ توضیح‌دار نشان دهد.
 */
export async function requirePluginEnabled(spreadsheetId: string, pluginId: string): Promise<void> {
  if (await isPluginEnabled(spreadsheetId, pluginId)) return;
  throw new BotConfigError(
    403,
    `این بخش به پلاگین «${PLUGIN_LABEL[pluginId] ?? pluginId}» نیاز دارد که روی این بات فعال نیست. از سکشن «پلاگین‌ها» روشنش کنید.`,
    "plugin_disabled",
  );
}
