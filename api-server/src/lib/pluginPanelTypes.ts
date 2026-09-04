/**
 * lib/pluginPanelTypes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * آینه‌ی هر `ext.register_panel_type(...)` که پلاگین‌ها در بات ثبت می‌کنند
 * (هر کدام `plugins/<id>/plugin.py`) — دقیقاً همان الگویی که
 * `lib/pluginButtonActions.ts` برای اکشن‌های دکمه دارد: سایت پایتون را
 * import نمی‌کند، پس این جدول این‌جا هم تکرار می‌شود.
 *
 * IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۱ — تا امروز `routes/botPanels.ts`
 * فقط `CORE_PANEL_TYPES` را برمی‌گرداند، یعنی هیچ نوع پنلِ پلاگینی (کیف پول،
 * تیکت، رزرو نوبت، ...) از سایت اصلاً قابلِ انتخاب نبود — با اینکه از
 * *داخلِ بات*، `handlers/panel_builder.py::PANEL_TYPES()` همین‌ها را با
 * `CORE_PANEL_TYPES` merge می‌کند و کاملاً کار می‌کنند.
 *
 * برچسب هر ردیف باید عیناً همان چیزی باشد که خودِ پلاگین به
 * `register_panel_type(label=...)` می‌دهد — دو ترجمه‌ی جدا برای یک مفهوم
 * ساخته نشود. توجه: برچسبِ یک پنل با برچسبِ اکشنِ دکمه‌ی همان پلاگین همیشه
 * یکی نیست (مثلاً `loyalty`: پنل «⭐️ باشگاه مشتریان»، دکمه «⭐️ امتیاز من») —
 * پس این جدول از `PLUGIN_BUTTON_ACTIONS` جدا نگه داشته می‌شود، نه merge.
 */

export type PluginPanelType = {
  pluginId: string;
  key: string;
  label: string;
};

/** باید دقیقاً با `register_panel_type(...)` در `plugins/<id>/plugin.py` یکی بماند. */
export const PLUGIN_PANEL_TYPES: PluginPanelType[] = [
  { pluginId: "ticket", key: "ticket", label: "🎫 تیکت پشتیبانی" },
  { pluginId: "subscription", key: "subscription", label: "💳 اشتراک" },
  { pluginId: "survey", key: "survey", label: "📊 نظرسنجی" },
  { pluginId: "address", key: "address", label: "📍 آدرس" },
  { pluginId: "wallet", key: "wallet", label: "💳 کیف پول" },
  { pluginId: "wallet", key: "wallet_balance", label: "💰 کیف پول من" },
  { pluginId: "loyalty", key: "loyalty", label: "⭐️ باشگاه مشتریان" },
  { pluginId: "giveaway", key: "giveaway", label: "🎁 قرعه‌کشی" },
  { pluginId: "booking", key: "booking", label: "📅 رزرو نوبت" },
  { pluginId: "catalog", key: "catalog_store", label: "🛍 فروشگاه" },
];
