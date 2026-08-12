# مدیریت بات از سایت — نگاشت کامل

هر کاری که ادمین یک بات از داخل تلگرام انجام می‌داد، حالا از سایت هم قابل انجام
است: بخش **بات‌ها** → صفحه‌ی workspace هر بات (آیکون چرخ‌دنده).

این سند مرجعِ «چه چیزی کجاست» است. تاریخچه‌ی فازبه‌فازِ کار در
`PROGRESS_BOTADMIN.md` ریشه‌ی همین مخزن است.

---

## ۱. اصل ماجرا: همان دیتا، نه یک کپی موازی

هر بات (tenant) دقیقاً **یک Google Spreadsheet** دارد که آی‌دی‌اش در
`bots.sheetId` نگه داشته می‌شود. هر entity یک تب جداست با ساختار ثابت:

```
سطر ۱ : ["key", "value"]
هر سطر بعدی : [key, JSON.stringify(value)]
```

سایت **همان spreadsheet** را می‌خواند و می‌نویسد که بات می‌خواند. هیچ جدول
موازی‌ای در Postgres سایت برای دیتای بات ساخته نشد.

مسیر همه‌ی نوشتن‌ها یکی است و قابل دور زدن نیست:

```
routes/bot*.ts  →  lib/botConfig.ts  →  lib/tenantSheets.ts  →  Google Sheets
                          ↓
                   lib/botCacheBust.ts  →  irforge_cache روی Postgres بات
```

`botConfig` سه چیز را تضمین می‌کند که روت‌ها نمی‌توانند فراموششان کنند:
مالکیت بات، نوشتن **کلیدبه‌کلید** (هرگز بازنویسی کل تب)، و باطل‌کردن کش بات
بعد از هر نوشتن.

---

## ۲. نگاشت قابلیت ↔ تب ↔ اندپوینت ↔ کامپوننت

| قابلیت | تب شیت | اندپوینت | کامپوننت |
|---|---|---|---|
| تنظیمات، پیام‌ها، واترمارک، تعمیر | `bot_settings` | `/api/bots/:id/settings` | `settings/TabGeneral`, `TabMessages` |
| عضویت اجباری | `bot_settings.force_join_channels` | `/settings/channels`, `/settings/channels/check` | `settings/TabForceJoin` |
| ساعت کاری | `bot_settings.working_hours` | `PUT /settings/working-hours` | `settings/TabWorkingHours` |
| آنتی‌فلاد | `bot_settings.anti_flood` | `PUT /settings/anti-flood` | `settings/TabAntiFlood` |
| پرداخت و پشتیبانی | `bot_settings` | `PATCH /settings` | `settings/TabPayment` |
| پنل‌ها | `panels` | `/panels`, `/panels/:id`, `/panels/health`, `/panels/repair` | `panels/PanelsSection`, `PanelEditor` |
| دکمه‌های پنل | `panels[*].buttons` | همان `PATCH /panels/:id` | `panels/ButtonBuilder` |
| مدیای پنل | `panels[*].media_file_id` + `settings.carousel_ids` | `/media`, `/media/:fileId`, `/media-status` | `panels/MediaList` |
| فرم‌ها | `forms` | `/forms`, `/forms/:id`, `/forms/:id/references` | `forms/FormsSection`, `FormEditor` |
| کامندهای سفارشی | `custom_commands` | `/commands`, `/commands/targets`, `/commands/migrate` | `CommandsEditor` |
| ادمین‌ها | `admins` | `/bot-admins` | `admins/AdminsSection` |
| نقش‌ها | `bot_settings.__roles__` | `/roles`, `/permission-groups` | همان بالا |
| کاربران بات | `users` | `/bot-users` | `users/UsersSection` |
| پیام همگانی | `irforge_queue` (Postgres بات) | `/broadcast` | `broadcast/BroadcastSection` |
| سفارش‌ها و رسیدها | `payments` | `/orders`, `/orders/:id/status`, `/orders-config` | `orders/OrdersSection` |
| پلاگین‌ها | `bot_settings.__plugin_states__` + `installed_plugins` | `/plugins` | `PluginsManager` |
| آبجکت‌های دینامیک | `object_schemas` + `obj_<slug>` | `/objects`, `/objects/:id/records` | `advanced/ObjectsSection` |
| روابط | `relation_definitions`, `relation_links` | `/relations`, `/relations/:id/links` | `advanced/RelationsSection` |
| ورک‌فلوها | `workflows`, `workflow_runs` | `/workflows`, `/workflow-catalog`, `/workflow-runs` | `advanced/WorkflowsSection` |
| زبان و رشته‌ها | `bot_settings.language`, `text_keys`, `text_values` | `/language`, `/language/strings` | `language/LanguageSection` |
| بک‌آپ و بازیابی | همه‌ی تب‌ها | `/backup`, `/restore` | `settings/TabBackup` |
| تیکت‌های بات | `tickets`, `ticket_messages` | `/support-tickets` | `tickets/TicketsSection` |
| سلامت بات | چند تب | `/health` | `BotHealthCard` |

---

## ۳. تأخیر ۶۰ ثانیه‌ای — چرا و چقدر

`SheetsManager` بات سه لایه کش دارد:

| لایه | چیست | از سایت قابل دسترسی؟ |
|---|---|---|
| L1 | دیکشنری درون‌پروسسی، `CACHE_TTL = 60` ثانیه | ❌ خیر |
| L2 | جدول `irforge_cache` روی Postgres بات، کلید `<spreadsheetId>:<tab>` | ✅ بله |
| L3 | خود Google Sheets | منبع حقیقت |

بعد از هر نوشتن، سایت ردیف L2 را پاک می‌کند
(`BOT_CACHE_DATABASE_URL`). L1 از بیرون قابل دسترسی نیست، پس **در بدترین حالت
هنوز تا ۶۰ ثانیه تأخیر ممکن است** — ولی برای replicaهایی که L1شان منقضی شده،
تغییر تقریباً فوری دیده می‌شود.

هر پاسخ تنظیمات یک فیلد `cacheBust: boolean` دارد و UI متن بنر را از روی همان
انتخاب می‌کند: «چند ثانیه» یا «تا حدود یک دقیقه». عدد حدس زده نمی‌شود.

اگر `BOT_CACHE_DATABASE_URL` ست نباشد همه‌چیز کار می‌کند، فقط تأخیر همیشه تا یک
دقیقه است. شکست cache-bust **هرگز** یک نوشتنِ موفق را به خطا تبدیل نمی‌کند.

---

## ۴. پرچم‌های cutover

`mainbot/utils/cutover_flags.py` + جدول `entity_cutover_flags` روی
`BUSINESS_DATABASE_URL`: اگر یک entity پرچم `use_db=true` داشته باشد، بات آن را
از Postgres می‌خواند نه از شیت — و نوشتن سایت روی شیت بی‌اثر می‌شود.

هر مسیر نوشتن اول `assertSheetsAuthoritative(entity)` را صدا می‌زند و در آن
حالت **۴۰۹ با کد `entity_on_postgres`** برمی‌گرداند، به‌جای اینکه وانمود کند
ذخیره شد. UI پیام مخصوص خودش را دارد.

مثل خود بات **fail-open** است: نبودِ `BUSINESS_DATABASE_URL`، نبودِ جدول، یا هر
خطای دیگری یعنی «روی Sheets بمان». کش ۶۰ ثانیه‌ای، هم‌اندازه‌ی بات.

---

## ۵. متغیرهای محیطی

| متغیر | اجباری؟ | کارش |
|---|---|---|
| `BOT_CACHE_DATABASE_URL` | اختیاری | Postgres **بات** — پاک‌کردن کش L2 و صف پیام همگانی |
| `BUSINESS_DATABASE_URL` | اختیاری | فقط برای خواندن `entity_cutover_flags` |

هیچ‌کدام به `DATABASE_URL` سایت fallback نمی‌کنند: این‌ها معمولاً دو دیتابیس
متفاوت‌اند و نوشتن روی اشتباهی بدتر از ننوشتن است.

---

## ۶. باگ‌های سمت بات که در سایت تکرار نشدند

| # | باگ بات | راه‌حل سایت |
|---|---|---|
| B1 | ترک صفحه وسط ویرایش، همه‌چیز را بی‌صدا دور می‌ریزد | `lib/unsaved-changes.ts` — دیالوگ برای سوییچ تب، تأیید برای سوییچ سکشن، `beforeunload` برای بستن تب |
| B2 | ویرایش مدیا کل کاروسل را با یک فایل جایگزین می‌کند | `MediaList` — افزودن/حذف/جابه‌جایی تکی؛ هیچ عملیاتی کل لیست را replace نمی‌کند |
| B3 | سه هندلر ویرایش پنل هیچ چک ادمینی ندارند | هر روت بدون استثنا از `resolveBotSheet` رد می‌شود |
| B4 | `edit_panel_id` در FSM می‌ماند و پنل اشتباهی ذخیره می‌شود | `panelId` فقط از URL (`?panel=`)؛ هیچ state سراسری‌ای وجود ندارد |
| B5 | نوع پنل اصلاً قابل ویرایش نیست | قابل تغییر است، با دیالوگی که دقیقاً می‌گوید چه چیزی از دست می‌رود |
| B6 | حذف پنل، فرزندان را یتیم می‌کند | `strategy` اجباری: `cascade` / `reparent` / `orphan` |
| B7 | دکمه‌های ارجاع‌دهنده به پنل حذف‌شده مرده می‌مانند | `buttonStrategy`: `disable` (به `callback/noop`) یا `remove` |
| B8 | دو منبع حقیقت برای خانه | هر دو اتمیک با هم آپدیت می‌شوند + `/panels/health` ناهماهنگی را می‌گیرد |
| B9 | `row`/`row_start` با migration ضمنی خراب می‌شود | مدل UI ردیف‌های صریح است؛ تبدیل در `lib/panel-buttons.ts` با تست round-trip |
| B10 | افزودن ادمین فقط با یوزرنیم و وابسته به `getChat` | آی‌دی عددی همیشه کار می‌کند؛ شکستِ یوزرنیم پیام روشن دارد |
| B11 | `write()` کل تب را clear می‌کند و کلید ناشناخته را می‌کشد | سایت فقط `upsertRow` تک‌کلیدی می‌زند؛ تست صریح دارد |
| B12 | مقصد فرم از منوی جدا ویرایش می‌شود | همه‌ی فیلدهای فرم در یک صفحه |
| B13 | کامندهای سایت و بات دو دنیای جدا | منبع حقیقت = تب `custom_commands` + مهاجرت idempotent |
| B14 | پلاگین‌های سایت و `__plugin_states__` یکی نیستند | هر دو کنار هم نمایش داده می‌شوند؛ سوییچ فقط `__plugin_states__` را می‌نویسد |

---

## ۷. چیزهایی که عمداً فقط در بات ماندند

- **`handlers/emergency.py`** — دستورات اضطراری. عمداً هیچ معادلی در سایت
  ندارند: اگر سایت پایین باشد یا حساب ادمین سایت در دسترس نباشد، این‌ها تنها
  راه باقی‌مانده‌اند. سایت‌محور کردنشان همان نقطه‌ی اتکای اضطراری را از بین می‌برد.
- **هندلرهای ادمین داخل خود بات** — هیچ‌کدام حذف یا غیرفعال نشدند. کاربر ممکن
  است هنوز از تلگرام کار کند؛ سایت یک راه **اضافه** است، نه جایگزین.
- **سکشن «کدهای تخفیف»** در workspace هنوز قفل است، و این تنها سکشن قفل‌مانده
  است. دلیلش صریح است: «تخفیف» اینجا دو معنی دارد — کدهای تخفیف پلتفرم
  (`routes/discounts.ts`، Postgres سایت) و پلاگین `discount` بات با تب
  `discounts` خودش. وصل‌کردن این سکشن به هرکدام بدون تصمیم صریح، دقیقاً همان
  اشتباه B13/B14 را تکرار می‌کرد، و هیچ فازی از این مهاجرت پوششش نمی‌دهد.

---

## ۸. صفحه‌ی سلامت بات

`GET /api/bots/:botId/health` شکست‌های **بی‌صدا** را پیدا می‌کند — چیزهایی که
بات درباره‌شان خطا نمی‌دهد، فقط کار نمی‌کند:

- ناهماهنگی‌های ساختار پنل (از `panelOps.panelHealth`)
- فرم بدون فیلد، یا فرم فعالِ بدون مقصد
- کامند با مقصد معلق (پنل یا فرمِ حذف‌شده)
- پلاگین فعال بدون تبِ لازمش
- تنظیمات ناقص: پیام خوش‌آمد خالی، عضویت اجباری بدون پیام، پنل فروش بدون
  اطلاعات پرداخت، حالت تعمیرِ روشن‌مانده

هر مورد یک دکمه‌ی «رفع» دارد که به سکشن مربوطه می‌برد؛ موارد `repairable` با یک
کلیک روی `/panels/repair` درست می‌شوند.
