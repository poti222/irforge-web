/**
 * lib/pluginGate.ts — «این قابلیت پشت کدام پلاگین است؟»
 * ─────────────────────────────────────────────────────────────────────────────
 * بعضی سکشن‌های workspace فقط وقتی معنی دارند که پلاگین مربوطه‌شان روی آن بات
 * فعال باشد — سفارش‌ها و پرداخت‌ها پشت پلاگین **کیف پول**اند، تیکت‌ها پشت
 * پلاگین **تیکت**، نوبت‌ها پشت **رزرو نوبت** و همین‌طور بقیه. تا امروز هیچ
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
 *
 * پیش‌فرضِ «وضعیت ثبت‌نشده» و نام نمایشی هر پلاگین دیگر اینجا کپی نمی‌شوند —
 * از کاتالوگ منتشرشده‌ی خودِ بات می‌آیند (`lib/pluginCatalog.ts`). قبلاً دو
 * نقشه‌ی دستی (`DEFAULT_ENABLED` و `PLUGIN_LABEL`) اینجا بودند که با هر
 * پلاگین جدید باید دستی به‌روز می‌شدند و نمی‌شدند.
 */
import { getEntity, BotConfigError } from "./botConfig.js";
import { getPluginManifest } from "./pluginCatalog.js";
import { logger } from "./logger.js";

const SETTINGS_TAB = "bot_settings";
const PLUGIN_STATES_KEY = "__plugin_states__";

/**
 * آیا این پلاگین روی این بات فعال است؟
 *
 * **هرگز throw نمی‌کند.** اگر شیت خوانده نشد، پیش‌فرض مانیفست برمی‌گردد؛ یک
 * خطای موقتی گوگل‌شیت نباید به‌شکل «پلاگین شما خاموش است» به کاربر نشان داده
 * شود.
 *
 * ⚠️ «ثبت‌نشده» با «خاموش» یکی نیست: اگر یک plugin_id در `__plugin_states__`
 * نباشد، بات از `default_enabled` مانیفست استفاده می‌کند
 * (`utils/plugin_manager.py:is_enabled`)، نه از `false`. همین‌جا هم همان.
 */
export async function isPluginEnabled(spreadsheetId: string, pluginId: string): Promise<boolean> {
  let fallback = false;
  try {
    fallback = (await getPluginManifest(pluginId))?.default_enabled ?? false;
  } catch (err) {
    logger.debug({ err, pluginId }, "pluginGate: خواندن کاتالوگ شکست خورد؛ پیش‌فرض false");
  }

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

  let label = pluginId;
  try {
    const manifest = await getPluginManifest(pluginId);
    label = manifest?.name_fa || manifest?.name || pluginId;
  } catch {
    // نام نمایشی نداریم — با id پیام می‌دهیم، بهتر از throw کردن روی مسیر خطا.
  }

  throw new BotConfigError(
    403,
    `این بخش به پلاگین «${label}» نیاز دارد که روی این بات فعال نیست. از سکشن «پلاگین‌ها» روشنش کنید.`,
    "plugin_disabled",
  );
}
