/**
 * lib/buttonValidation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `validateButtons` — منتقل‌شده از `routes/botPanels.ts` (که هنوز همان تابع
 * را با `export { validateButtons } from "../lib/buttonValidation.js"` دوباره
 * صادر می‌کند، پس `routes/botForms.ts`ی موجود بدون تغییر کار می‌کند).
 *
 * دلیلِ انتقال: لایوباگ ۲۰۲۶-۰۹-۲۳ («آدرس‌ها هم باید بتوانند مثلِ پنل‌ها دکمه
 * داشته باشند») به این اعتبارسنجی از `lib/addressStore.ts` نیاز داشت —
 * یک فایلِ `lib/`، نه یک route. وارد کردنِ چیزی از `routes/` داخلِ `lib/`
 * جهتِ لایه‌بندیِ همیشگیِ این ریپو را برعکس می‌کرد (routeها به lib وابسته‌اند،
 * نه برعکس)، پس خودِ تابع به اینجا (یک فایلِ `lib/` دیگر) منتقل شد — دقیقاً
 * همان الگویی که `normalizeButtonLayout`/`newButton`/`BUTTON_STYLES` از قبل
 * دارند (همه در `botTypes.ts`، نه در یک route).
 */
import { BotConfigError } from "./botConfig.js";
import { BUTTON_STYLES, newButton, normalizeButtonLayout, type PanelButton } from "./botTypes.js";

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/**
 * حداکثر دکمه در یک ردیف — محدودیتِ عملیِ تلگرام، همان کاپی که همیشه اینجا
 * (قبلاً در خودِ `routes/botPanels.ts`) بوده. ⚠️ این عمداً از
 * `botTypes.ts::MAX_BUTTONS_PER_ROW` (که مقدارش ۴ است و `catalogStore.ts`/
 * `dripStore.ts` مستقلاً استفاده می‌کنند) جدا نگه داشته شد — این دو مقدار از
 * قبلِ این تغییر هم یکی نبودند؛ یکی‌کردنشان یک تصمیمِ جداگانه است، نه بخشی
 * از این جابه‌جاییِ صرف. اینجا فقط منتقل شد، مقدارش دست‌نخورده ماند.
 */
export const MAX_BUTTONS_PER_ROW = 8;

/** دکمه‌ها: هم پنل‌ها استفاده می‌کنند، هم `routes/botForms.ts` برای دکمه‌های
 * پیام تشکر، هم `lib/addressStore.ts` — دقیقاً همان شکل/همان اعتبارسنجی،
 * پس یک‌جا نگه‌داشته می‌شود تا اکشنِ جدیدی که اینجا اضافه می‌شود خودکار برای
 * همه‌شان معتبر باشد. */
export function validateButtons(value: unknown): PanelButton[] {
  if (!Array.isArray(value)) throw bad("فهرست دکمه‌ها باید آرایه باشد.");
  if (value.length > 100) throw bad("حداکثر ۱۰۰ دکمه برای یک پنل مجاز است.");

  const buttons = value.map((raw: any, i: number) => {
    if (!raw || typeof raw !== "object") throw bad(`دکمه‌ی شماره ${i + 1} معتبر نیست.`);
    const label = String(raw.label ?? "").trim();
    if (!label) throw bad(`متن دکمه‌ی شماره ${i + 1} خالی است.`);
    if (label.length > 64) throw bad(`متن دکمه‌ی «${label.slice(0, 20)}…» بیش از ۶۴ کاراکتر است.`);

    const action = String(raw.action ?? "").trim();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(action))
      throw bad(`اکشن دکمه‌ی «${label}» معتبر نیست.`);

    const rawValue = String(raw.value ?? "");
    if ((action === "url" || action === "mini_app") && rawValue && !/^https:\/\//i.test(rawValue))
      throw bad(`آدرس دکمه‌ی «${label}» باید با https:// شروع شود.`);

    const style = String(raw.style ?? "");
    if (style && !(BUTTON_STYLES as readonly string[]).includes(style))
      throw bad(`استایل دکمه‌ی «${label}» معتبر نیست.`);

    return newButton({
      label,
      action,
      value: rawValue,
      row: Number(raw.row ?? 0),
      col: Number(raw.col ?? 0),
      row_start: raw.row_start === undefined ? undefined : Boolean(raw.row_start),
      style,
      ...(raw.icon_custom_emoji_id ? { icon_custom_emoji_id: String(raw.icon_custom_emoji_id) } : {}),
    });
  });

  const normalized = normalizeButtonLayout(buttons);
  const perRow = new Map<number, number>();
  for (const b of normalized) perRow.set(b.row, (perRow.get(b.row) ?? 0) + 1);
  for (const [row, count] of perRow) {
    if (count > MAX_BUTTONS_PER_ROW)
      throw bad(`ردیف ${row + 1} بیش از ${MAX_BUTTONS_PER_ROW} دکمه دارد؛ تلگرام آن را درست نشان نمی‌دهد.`);
  }
  return normalized;
}
