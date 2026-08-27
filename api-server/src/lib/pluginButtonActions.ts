/**
 * lib/pluginButtonActions.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * آینه‌ی هشت `ext.register_button_action(...)` که پلاگین‌ها در بات ثبت می‌کنند
 * (هر کدام `plugins/<id>/plugin.py`): یک میان‌بر ثابت به فلوی خودِ همان پلاگین
 * (مثلاً «رزرو نوبت» → تقویم بوکینگ). بات این‌ها را از قبل در پیکرِ خودِ
 * تلگرامش نشان می‌داد؛ سایت هیچ‌وقت نمی‌دید و فقط `CORE_BTN_ACTIONS` را
 * می‌فرستاد — این فایل همان شکاف را می‌بندد، دقیقاً همان الگویی که
 * `lib/pluginPricing.ts` برای قیمت‌ها و `lib/marketplaceSync.ts` برای آیتم‌های
 * مارکت‌پلیس دارند: سایت پایتون را import نمی‌کند، پس این جدول این‌جا هم
 * تکرار می‌شود، با `fixedValue`ای که باید همان رشته‌ی سمت بات باشد.
 *
 * `fixedValue` دقیقاً همان چیزی است که هنگام ساختِ دکمه در `value` می‌نشیند —
 * بات به‌محضِ دیدنِ این اکشن، `value` را عیناً callback_data می‌کند
 * (`handlers/user.py`)، پس ادمین چیزی برای پرکردن ندارد، درست مثل «درخواست شماره».
 *
 * `catalog` این‌جا نیست: بر خلاف این هشت‌تا، «ثبت سفارش یک محصول» یک مقصدِ
 * ثابت ندارد — مقدارش شناسه‌ی محصولی است که ادمین هر بار انتخاب می‌کند، پس
 * جدا مدل شده (`CATALOG_ORDER_ACTION` پایین).
 */

export type PluginButtonAction = {
  pluginId: string;
  key: string;
  label: string;
  fixedValue: string;
};

/** باید دقیقاً با `register_button_action(...)` در `plugins/<id>/plugin.py` یکی بماند. */
export const PLUGIN_BUTTON_ACTIONS: PluginButtonAction[] = [
  { pluginId: "booking", key: "booking", label: "📅 رزرو نوبت", fixedValue: "bk:start" },
  { pluginId: "giveaway", key: "giveaway", label: "🎁 قرعه‌کشی", fixedValue: "gw:list" },
  { pluginId: "loyalty", key: "loyalty", label: "⭐️ امتیاز من", fixedValue: "ly:me" },
  { pluginId: "survey", key: "survey", label: "📊 نظرسنجی", fixedValue: "sv:list" },
  { pluginId: "ticket", key: "ticket", label: "🎫 تیکت پشتیبانی", fixedValue: "tk:u:list:0" },
  { pluginId: "address", key: "address", label: "📍 آدرس", fixedValue: "addr:start" },
  { pluginId: "discount", key: "discount", label: "🎟 کد تخفیف", fixedValue: "dc:check_prompt" },
  { pluginId: "subscription", key: "subscription", label: "💳 اشتراک", fixedValue: "sb:plans" },
];

/**
 * «ثبت سفارش یک محصول مشخص» — کاتالوگ فروشگاهی. تنها اکشنِ پلاگینی که
 * *مقدار* هم لازم دارد (کدام محصول)، پس در کاتالوگ جدا برمی‌گردد تا
 * `ButtonBuilder.tsx` بداند برایش یک انتخاب‌گرِ محصول نشان دهد، نه فقط یک
 * برچسبِ «نیاز به مقدار نیست».
 */
export const CATALOG_ORDER_ACTION = {
  pluginId: "catalog",
  key: "catalog_order",
  label: "🛒 ثبت سفارش یک محصول",
} as const;
