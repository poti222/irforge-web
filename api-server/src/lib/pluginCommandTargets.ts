/**
 * lib/pluginCommandTargets.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * آینه‌ی هر `ext.register_custom_command_target(...)` که پلاگین‌ها در بات ثبت
 * می‌کنند (هر کدام `plugins/<id>/plugin.py`) — دقیقاً همان الگویی که
 * `lib/pluginButtonActions.ts` برای اکشن‌های دکمه و `lib/pluginPanelTypes.ts`
 * برای انواع پنل دارند: سایت پایتون را import نمی‌کند، پس این جدول این‌جا هم
 * تکرار می‌شود.
 *
 * تا امروز `routes/botCommands.ts` فقط چهار مقصدِ داخلیِ هسته را برمی‌گرداند
 * (`admin`/`broadcast`/`stats`/`backup`) — یعنی هیچ‌کدام از این هفده مقصدِ
 * پلاگینی از سایت اصلاً قابلِ انتخاب نبودند، با اینکه از *داخلِ بات*،
 * `handlers/custom_commands.py::_execute_target` همین‌ها را با
 * `extensions.dispatch_custom_command_target` صدا می‌زند و کاملاً کار
 * می‌کنند — دقیقاً همان شکافی که آن دو فایل برای نوع پنل/اکشن دکمه بستند.
 *
 * برچسب هر ردیف باید عیناً همان چیزی باشد که خودِ پلاگین به
 * `register_custom_command_target(label=...)` می‌دهد. کلید هر پلاگین با
 * کلیدِ اکشنِ دکمه/نوعِ پنلِ همان پلاگین همیشه یکی نیست (مثلاً `catalog`:
 * نوعِ پنل و مقصدِ کامند هر دو `catalog_store`اند ولی `forms_pro` مقصدش
 * `openforms` است، نه `forms_pro`؛ `invoice` مقصدش `receipts` است) — پس این
 * جدول از آن دو تا جدا نگه داشته می‌شود، نه merge.
 *
 * `gameserver_cs2` عمداً اینجا نیست: بر خلاف بقیه، این پلاگین هیچ
 * `register_custom_command_target` ثبت نمی‌کرد (فقط نوع پنل + اکشن دکمه) —
 * قبل از اضافه‌شدنش به این فهرست، یک `register_custom_command_target` بهش
 * اضافه شد (`plugins/gameserver_cs2/plugin.py`) تا اینجا هم مقصدِ مرده
 * نسازد.
 */

export type PluginCommandTarget = {
  pluginId: string;
  key: string;
  label: string;
};

/** باید دقیقاً با `register_custom_command_target(...)` در `plugins/<id>/plugin.py` یکی بماند. */
export const PLUGIN_COMMAND_TARGETS: PluginCommandTarget[] = [
  { pluginId: "wallet", key: "wallet", label: "🏦 حساب بانکی" },
  { pluginId: "loyalty", key: "loyalty", label: "⭐️ امتیاز من" },
  { pluginId: "giveaway", key: "giveaway", label: "🎁 قرعه‌کشی‌ها" },
  { pluginId: "booking", key: "booking", label: "📅 رزرو نوبت" },
  { pluginId: "ticket", key: "ticket", label: "🎫 تیکت‌های من" },
  { pluginId: "address", key: "address", label: "📍 آدرس و تماس" },
  { pluginId: "subscription", key: "subscription", label: "💳 اشتراک من" },
  { pluginId: "survey", key: "survey", label: "📊 نظرسنجی‌ها" },
  { pluginId: "catalog", key: "catalog_store", label: "🛍 فروشگاه" },
  { pluginId: "events", key: "events", label: "🎫 رویدادها" },
  { pluginId: "waitlist", key: "waitlist", label: "📋 لیست انتظار" },
  { pluginId: "files", key: "files", label: "📁 فایل‌ها" },
  { pluginId: "feedback", key: "feedback", label: "📣 بازخورد" },
  { pluginId: "guided_flow", key: "guided_flow", label: "🧭 گفت‌وگوهایِ راهنما" },
  { pluginId: "forms_pro", key: "openforms", label: "📋 فرم‌ها" },
  { pluginId: "invoice", key: "receipts", label: "🧾 رسیدهای من" },
  { pluginId: "affiliate", key: "affiliate", label: "🤝 همکاری در فروش" },
  { pluginId: "gameserver_cs2", key: "gameserver_cs2", label: "🎮 مدیریتِ سرورهایِ CS2" },
];
