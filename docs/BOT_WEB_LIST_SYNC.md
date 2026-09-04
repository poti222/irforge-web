# چک‌لیست: هر نوعِ تازه‌ی سمتِ بات را به سایت هم اضافه کن

**زمینه (IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۳):** سایت در چند جا لیستی از انواعِ
سمتِ بات را **آینه (mirror)** نگه می‌دارد، چون این ریپو (`irforge-web`) کدِ
پایتونِ بات را import نمی‌کند — هیچ فراخوانیِ زنده‌ای بینِ دو سرویس برای این
لیست‌ها وجود ندارد. نتیجه‌ی این معماری: وقتی بات یک نوعِ تازه (پنل، اکشنِ
دکمه، مکانیزمِ fulfillment) اضافه می‌کند و کسی این فایل‌ها را دستی به‌روز
نکند، آن نوع از سایت اصلاً قابلِ انتخاب نمی‌شود — بدون هیچ خطایی، فقط ساکت
جا می‌ماند. دقیقاً همین اتفاق برای `wallet`/`wallet_balance` (نوعِ پنل) و
`pool` (نوعِ fulfillment) افتاد.

`test/localeParity.test.mjs` و `test/pluginPanelTypes.test.mjs`/
`pluginButtonActions.test.mjs` این خانواده‌باگ را **تا حدی** می‌گیرند (کلیدِ
locale فراموش‌شده، یا خودِ جدول بدساخت) — ولی نمی‌توانند بفهمند که بات یک
`register_panel_type(...)` *تازه* اضافه کرده، چون کدِ پایتونِ بات را
اصلاً نمی‌بینند. یعنی چک کردنِ این لیست هنوز یک قدمِ دستی است.

## کِی این چک‌لیست را اجرا کن

هر بار که در ریپوی بات (`irforge-app`) یکی از این‌ها اضافه/حذف/تغییر کرد:

- `ext.register_panel_type(...)` (هرجایی در `plugins/*/plugin.py`)
- `ext.register_button_action(...)` (هرجایی در `plugins/*/plugin.py`)
- `fulfillment.register_fulfillment_type(...)` (`plugins/catalog/plugin.py`)

## چه چیزی را در `irforge-web` به‌روز کن

| منبعِ حقیقت (بات) | آینه‌ی سایت | نکته |
|---|---|---|
| `handlers/panel_builder.py::CORE_PANEL_TYPES` | `api-server/src/lib/botTypes.ts::CORE_PANEL_TYPES` | فقط ۸ نوعِ هسته؛ به‌ندرت تغییر می‌کند. |
| `ext.register_panel_type(...)` هر پلاگین | `api-server/src/lib/pluginPanelTypes.ts::PLUGIN_PANEL_TYPES` | یک ردیفِ `{pluginId, key, label}` اضافه کن — `label` باید عیناً همان چیزی باشد که بات به `register_panel_type(label=...)` داده. |
| `handlers/panel_builder.py::CORE_BTN_ACTIONS` | `api-server/src/lib/botTypes.ts::CORE_BTN_ACTIONS` | |
| `ext.register_button_action(...)` هر پلاگین | `api-server/src/lib/pluginButtonActions.ts::PLUGIN_BUTTON_ACTIONS` | `fixedValue` باید عیناً همان `fixed_value` سمتِ بات باشد — این مقدار مستقیم در `callback_data` می‌نشیند. |
| `fulfillment.register_fulfillment_type(...)` (کاتالوگ) | `irforge/src/components/bots/catalog/CatalogSection.tsx::FULFILLMENT_TYPES` | |
| کلیدِ locale برایِ هرکدام از بالا | `irforge/src/locales/{fa,en,tr,ar,ru}.json` | `botPanels.type_<key>` / `botPanels.action_<key>` / `botCatalog.fulfillment_<key>` — **هر پنج فایل**، نه فقط fa.json. |

## بعد از اضافه‌کردن

1. `pnpm --filter @workspace/api-server run test` — `pluginPanelTypes.test.mjs`/
   `pluginButtonActions.test.mjs` جدولِ جدید را برایِ کلیدِ تکراری/فیلدِ خالی
   چک می‌کنند.
2. `pnpm --filter @workspace/irforge run test` — `localeParity.test.mjs`
   مطمئن می‌شود کلیدِ locale در هر پنج زبان اضافه شده (نه فقط فارسی).
3. `pnpm build` — بیلدِ `irforge` خودش هم یک چکِ `TODO_TRANSLATE` دارد.
4. تستِ دستی: از سایت نوعِ تازه را در انتخاب‌گرِ مربوطه انتخاب کن، پنل/دکمه/
   محصول را بساز، و مطمئن شو از **داخلِ بات** درست رفتار می‌کند.
