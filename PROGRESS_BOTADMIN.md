# PROGRESS_BOTADMIN.md — انتقال کامل پنل ادمین بات به سایت

**منبع حقیقت این تسک:** `IrForge_BotAdmin_To_Web_ClaudeCode_Prompt.md` (متن کامل
پرامپت؛ این ریپو کپی‌اش را نگه نمی‌دارد). در شروع هر session جدید **اول** آن فایل و
**بعد** همین فایل را کامل بخوان، بعد اولین فازی که ✅ نیست را اجرا کن.

> ⚠️ این فایل با `PROGRESS.md` موجود در ریشه‌ی ریپو **فرق دارد** و ربطی به آن ندارد.
> `PROGRESS.md` ردیاب دو تسک قبلی است (یکسان‌سازی env varها و سیاست حذف/انقضا).

**مخازن:**
- `irforge-app` (mainbot، پایتون/aiogram) — **مرجع خواندنی**، دست‌نخورده می‌ماند.
- `irforge-web` (این ریپو، pnpm monorepo) — همه‌ی کد این تسک اینجا نوشته می‌شود.

**گیت بیلد مشترک همه‌ی فازها (بخش ۱.۶ پرامپت):**

```bash
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/irforge run build
pnpm --filter @workspace/irforge run typecheck
```

---

## جدول وضعیت

وضعیت‌ها: ✅ تمام‌شده · 🚧 در حال انجام · ⬜ شروع نشده

| فاز | وضعیت | فایل‌های تغییریافته | تست‌ها | فرض‌ها/ریسک‌ها |
|---|---|---|---|---|
| ۰ — ممیزی و راه‌اندازی ردیاب | ✅ | فقط `PROGRESS_BOTADMIN.md` (این فایل). هیچ فایل کدی لمس نشد. | گیت بیلد سه‌گانه روی HEAD (`21f2b3f`) اجرا شد: build سرور ✅، build فرانت ✅، **typecheck ❌ (۲ خطای از قبل موجود)** — بخش «د» ممیزی. | `BUSINESS_DATABASE_URL` روی این محیط ست نیست و هیچ Postgres در دسترس نیست، پس وضعیت واقعی `entity_cutover_flags` روی production **تأیید نشده** — فقط از روی seed migration استنتاج شده (همه `false`). |
| ۱ — لایه‌ی سرویس `botConfig` + حل کش | ✅ | **جدید:** `api-server/src/lib/botTypes.ts`, `botConfig.ts`, `botCacheBust.ts`, `test/botConfig.test.mjs`. **تغییر:** `api-server/.env.example` (دو متغیر جدید)، `api-server/package.json` (اسکریپت test با tsx)، و رفع دو خطای typecheck از قبل موجود: `irforge/src/components/admin/AllBotsTable.tsx` + کلید `sectionManagement` در ۵ locale. | `pnpm --filter @workspace/api-server run test` → **۱۲ تست سبز**. هر سه گیت بیلد سبز. | cache-bust فقط L2 را پاک می‌کند؛ L1 درون‌پروسسی بات از بیرون قابل دسترسی نیست، پس تأخیر تا ۶۰ ثانیه کاملاً صفر نمی‌شود. `assertSheetsAuthoritative` عمداً fail-open است. |
| ۲ — پوسته‌ی workspace و ناوبری بات‌ها | ✅ | `irforge/src/components/bots/BotWorkspaceDocument.tsx` (بازنویسی)، `irforge/src/pages/bots.tsx` (آیکون چرخ‌دنده)، ۵ فایل locale. | گیت بیلد سه‌گانه سبز. تست دستی مسیرها در گزارش فاز. | سکشن `management` حذف شد (فقط `<div />` خالی رندر می‌کرد) و کلید locale‌اش هم برداشته شد. سکشن قفل‌شده حتی با لینک مستقیم باز نمی‌شود و به `overview` برمی‌گردد. |
| ۳ — API تنظیمات ربات | ✅ | **جدید:** `api-server/src/routes/botSettings.ts`. **تغییر:** `api-server/src/routes/index.ts` (ثبت روتر). | build سرور سبز. ولیدیشن‌ها در گزارش فاز فهرست شده‌اند. | whitelist صریح است: هر کلید ناشناخته در body بی‌سروصدا دور ریخته می‌شود، نه ذخیره. |
| ۴ — UI تنظیمات ربات (چرخ‌دنده) | ✅ | **جدید:** `settings/{BotSettingsSection,TabGeneral,TabMessages,TabPayment,TabDanger,SettingsSaveBar,useDraft,api}.tsx/ts`, `irforge/src/lib/unsaved-changes.ts`. **حذف:** `BotSettingsForm.tsx`. **تغییر:** `BotWorkspaceDocument.tsx`، ۵ locale (namespace جدید `botSettings`، ۱۳۷ کلید). | هر سه گیت سبز + ۱۲ تست سرور. | تب فعال هم در URL است (`?tab=`). هشدار unsaved با AlertDialog برای سوییچ تب و با `beforeunload`/`confirm` برای ترک صفحه. |
| ۵ — عضویت اجباری / ساعت کاری / آنتی‌فلاد | ✅ | **جدید:** `settings/{TabForceJoin,TabWorkingHours,TabAntiFlood}.tsx`. **تغییر:** `routes/botSettings.ts` (اندپوینت بررسی دسترسی کانال)، `BotSettingsSection.tsx`، ۵ locale. | هر سه گیت سبز. | نگاشت روزها **تأیید شد**: `0=دوشنبه … 6=یکشنبه`، و تبدیل از `Date.getDay()` در `jsDayToBotDay` جدا شده. |
| ۶ — API پنل‌ها (CRUD پایه) | ✅ | **جدید:** `api-server/src/lib/panelOps.ts`, `routes/botPanels.ts`, `test/botPanels.test.mjs`. **تغییر:** `routes/index.ts`, `lib/botTypes.ts` (`disabledButton`, `icon_custom_emoji_id`). | **۲۰ تست سبز** (۹ تای جدید: هر سه استراتژی حذف، buttonStrategy، خانه، health/repair، درخت، زیردرخت). | تست یک باگ واقعی در `buildTree` پیدا کرد: خروجی روی حلقه‌ی والد، گراف حلقه‌ای بود و `JSON.stringify` پاسخ را می‌ترکاند — قبل از commit درست شد. |
| ۷ — UI پنل‌ها: لیست، درخت، ساخت | ⬜ | — | — | — |
| ۸ — UI ویرایش پنل (B1–B5) | ⬜ | — | — | — |
| ۹ — سازنده‌ی دکمه‌های پنل (B9) | ⬜ | — | — | `row_start` و `style` در `models.Button` **نیستند** ولی در دیتای واقعی هستند — بخش «ه»، مورد ۳. |
| ۱۰ — تنظیمات پیشرفته‌ی پنل + آپلود مدیا | ⬜ | — | — | کلیدهای واقعی `settings` در بخش «ه»، مورد ۴ فهرست شده‌اند. |
| ۱۱ — فرم‌ها (API + UI) | ⬜ | — | — | — |
| ۱۲ — یکی‌سازی کامندهای سفارشی (B13) | ⬜ | — | — | شکل دقیق دو طرف در بخش «ب» آمده؛ ناسازگاری کامل است، نه جزئی. |
| ۱۳ — ادمین‌ها و نقش‌ها | ⬜ | — | — | `get_permission_groups` گروه‌های پلاگین‌ها را **دینامیک** اضافه می‌کند؛ لیست ثابت hardcode نکن. |
| ۱۴ — کاربران بات | ⬜ | — | — | — |
| ۱۵ — پیام همگانی | ⬜ | — | — | نیازمند Postgres بات (`irforge_queue`)؛ روی محیط توسعه در دسترس نیست. |
| ۱۶ — سفارش‌ها و پرداخت | ⬜ | — | — | — |
| ۱۷ — پلاگین‌ها (B14) | ⬜ | — | — | منبع حقیقت `__plugin_states__` داخل تب `bot_settings` است (تأییدشده). |
| ۱۸ — آبجکت‌های دینامیک | ⬜ | — | — | — |
| ۱۹ — روابط | ⬜ | — | — | — |
| ۲۰ — ورک‌فلوها | ⬜ | — | — | — |
| ۲۱ — زبان بات | ⬜ | — | — | امروز یک **منبع سومِ موازی** برای زبان وجود دارد که بات اصلاً نمی‌خواندش — بخش «ب»، مورد ۳. |
| ۲۲ — بک‌آپ و بازیابی | ⬜ | — | — | — |
| ۲۳ — تیکت‌های بات | ⬜ | — | — | `routes/botTickets.ts` فعلی **ربطی به تب‌های تننت ندارد** — بخش «ب»، مورد ۵. |
| ۲۴ — یکپارچگی نهایی و مستندسازی | ⬜ | — | — | — |

---

# Audit — وضعیت واقعی امروز (فاز ۰)

همه‌ی موارد زیر از روی سورس امروزِ هر دو ریپو استخراج شده، روی commit
`21f2b3f` در `irforge-web` و درخت فعلی `irforge-app`. هیچ‌کدام حدس نیست؛ هر ادعا
با مسیر فایل و خط آمده.

## الف) کدام تب‌ها امروز در سایت قابل مدیریت‌اند؟

**پاسخ کوتاه: هیچ‌کدام به‌صورت ساختاریافته.**

تنها مسیری که امروز به شیت تننت می‌رسد، منوی «دیتابیس» است:
`api-server/src/routes/database.ts` + `irforge/src/pages/database.tsx`، که روی
`api-server/src/lib/tenantSheets.ts` سوار است. این منو **هر** تبی را نشان می‌دهد و
اجازه‌ی ویرایش خام `key` / `value` (JSON دستی) را می‌دهد. یعنی از نظر «دسترسی به
داده» هیچ تبی قفل نیست، ولی از نظر «مدیریت» هیچ تبی فرم/ولیدیشن/ساختار ندارد —
کاربر باید JSON یک `Panel` را با دست بنویسد.

| تب | UI اختصاصی در سایت؟ | امروز از کجا در دسترس است | فاز مقصد |
|---|---|---|---|
| `bot_settings` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۳–۵، ۱۷، ۲۱ |
| `panels` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۶–۱۰ |
| `buttons` | ❌ ندارد (و بات هم استفاده‌اش نمی‌کند) | — | — |
| `forms` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۱ |
| `custom_commands` | ❌ ندارد — سکشن «کامندها» به Postgres سایت وصل است، نه این تب | ویرایشگر خام دیتابیس | ۱۲ |
| `admins` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۳ |
| `roles` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۳ |
| `users` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۴ |
| `payments` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۶ |
| `object_schemas` / `object_relations` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۸ |
| `relation_definitions` / `relation_links` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۹ |
| `workflows` / `workflow_runs` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۲۰ |
| `languages` | ❌ ندارد — سکشن زبان در workspace `locked: true` است | فقط ویرایشگر خام دیتابیس | ۲۱ |
| `themes` | ❌ ندارد (سایت `themes` مستقل خودش را دارد — بی‌ربط به این تب) | فقط ویرایشگر خام دیتابیس | خارج از نقشه |
| `automation_rules`, `connector_configs`, `wallet`, `transactions`, `reports`, `analytics_metadata`, `events` | ❌ ندارد | فقط ویرایشگر خام دیتابیس | خارج از نقشه‌ی فازها |
| `tickets` / `ticket_messages` (lazy، از `plugin_db`) | ❌ ندارد | فقط ویرایشگر خام دیتابیس (اگر تب ساخته شده باشد) | ۲۳ |
| تب‌های پلاگینی (`discounts`, `wallets`, `referrals`, …) | ❌ ندارد | فقط ویرایشگر خام دیتابیس | ۱۷ (نمایش وضعیت) |

**وضعیت سکشن‌های workspace امروز** (`irforge/src/components/bots/BotWorkspaceDocument.tsx:30-50`):
`overview`, `profile`, `commands`, `plugins`, `stats`, `language` (locked),
`management` (خالی — `{section === "management" && <div />}`), `settings`.
از این‌ها فقط `commands` و `plugins` و `settings` واقعاً چیزی می‌نویسند و **هر سه
به Postgres سایت می‌نویسند، نه به شیت تننت**.

## ب) اندپوینت‌هایی که روی Postgres سایت کار می‌کنند ولی باید روی شیت تننت باشند

| # | اندپوینت | امروز کجا می‌نویسد | باید کجا بنویسد | باگ مرتبط | فاز |
|---|---|---|---|---|---|
| ۱ | `GET/POST/PATCH/DELETE /api/bots/:botId/commands` (`routes/bots.ts:2359-2398`) | جدول `commands` روی Postgres سایت (`lib/db/src/schema/commands.ts`) | تب `custom_commands` شیت تننت | B13 | ۱۲ |
| ۲ | `GET/POST/DELETE /api/bots/:botId/plugins` (`routes/bots.ts:2400-2441`) | جدول `installed_plugins` (`lib/db/src/schema/marketplace.ts:23`) | خرید بماند؛ فعال/غیرفعال باید `bot_settings.__plugin_states__` باشد | B14 | ۱۷ |
| ۳ | `GET/PUT /api/bots/:botId/language` (`routes/bots.ts:1920-1965`) | `lib/botLanguageStore.ts` → اسپردشیت `SHEETS_DATA_ID` (شیت DATA سایت)، تب `bot_settings`، `key = botId`، با fallback نوشتن روی فایل JSON روی دیسک | `bot_settings.language` در شیت **تننت** (کلید = نام فیلد) | — (منبع سوم موازی؛ بات هرگز این را نمی‌خواند) | ۲۱ |
| ۴ | `GET /api/bots/:botId/stats` (`routes/bots.ts:2176`) | شمارنده‌های `bots.*` روی Postgres + `messagesPerDay` **ساختگی** (تقسیم `messageCount` بر ۷) | آمار واقعی از تب‌های `users`/`payments`/`events` | — | ۱۴ / ۲۴ |
| ۵ | `routes/botTickets.ts` (mount زیر `/api/bot`) | جداول `tickets`/`ticket_messages` روی Postgres سایت، برای **support-bot پلتفرم** با API key | تیکت‌های داخل بات، تب‌های `tickets`/`ticket_messages` تننت (`handlers/support.py:36-37` با `plugin_db`) | — (دو چیز کاملاً متفاوت با اسم یکسان) | ۲۳ |
| ۶ | شمارنده‌های `bots.commandCount` / `pluginCount` / `userCount` | از `SELECT COUNT(*)` روی جداول سایت پر می‌شوند (`routes/bots.ts:2371, 2395`) | باید از تب شیت شمرده شوند (پرامپت فاز ۱۲ صریحاً همین را می‌گوید) | B13 | ۱۲، ۱۴ |

**ناسازگاری شکل داده در مورد ۱ (کامندها) — کامل، نه جزئی:**

- سایت: `{ id(uuid), botId, name, description, permission, arguments[], workflow, enabled, createdAt }`
- بات (`handlers/custom_commands.py:8-16`): `key = command` و
  `value = { command, target, description, admin_only, is_active, created_at }`

هیچ فیلد مشترکی جز `description` وجود ندارد. `name` سایت ≈ `command` بات، ولی
`permission`/`arguments`/`workflow` سمت بات معنایی ندارند و `target`/`admin_only`
سمت سایت اصلاً وجود ندارند. یعنی فاز ۱۲ یک **بازنویسی** است، نه یک نگاشت.

## ج) `BUSINESS_DATABASE_URL` و `entity_cutover_flags` روی این محیط

| پرسش | پاسخ |
|---|---|
| آیا `BUSINESS_DATABASE_URL` روی این محیط ست است؟ | ❌ خیر. `env` هیچ متغیری با نام `DATABASE_URL`, `BUSINESS_DATABASE_URL`, `BOT_CACHE_DATABASE_URL` یا `SHEETS_*` ندارد — این محیط توسعه هیچ Postgres و هیچ کردنشیال گوگلی ندارد. |
| آیا `entity_cutover_flags` ردیف `use_db=true` دارد؟ | **قابل بررسی نیست** (Postgresی نیست که کوئری شود). از روی seed: `irforge-app/migrations/sql/0001_entity_cutover_flags.sql` جدول را با `use_db BOOLEAN NOT NULL DEFAULT false` می‌سازد و ۲۷ entity را **بدون** مقدار صریح insert می‌کند → همه `false`. |
| آیا `.env.example` سایت این دو متغیر را دارد؟ | ❌ خیر. `api-server/.env.example` نه `BOT_CACHE_DATABASE_URL` دارد و نه `BUSINESS_DATABASE_URL`. افزودنشان کار فاز ۱ است (بند ۵ آن فاز). |

**نتیجه‌ی عملی برای فاز ۱:** فرضِ کاری این است که همه‌ی entityها روی Sheets هستند،
ولی چون این فرض روی production تأیید نشده، `assertSheetsAuthoritative` باید دقیقاً
مثل خود بات **fail-open** باشد (`utils/cutover_flags.py:61-66`: هر خطا → `False` →
ماندن روی Sheets) و هرگز به‌خاطر نبودن اتصال، نوشتن را مسدود نکند.

**آدرس دقیق کش L2 (تأییدشده):** جدول `irforge_cache` روی Postgresی که بات با
`DATABASE_URL` **یا** `POSTGRES_URL` باز می‌کند (`irforge-app/utils/postgres_store.py:60`)،
با اسکیمای `irforge_cache(cache_key TEXT PRIMARY KEY, value JSONB, expires_at DOUBLE PRECISION)`
(همان‌جا خط ۱۰۸) و کلید `` `${spreadsheet_id}:${sheet_name}` ``
(`utils/sheets_manager.py:126`). `CACHE_TTL = 60` (خط ۱۲۰). پس متغیر
`BOT_CACHE_DATABASE_URL` سمت سایت باید به **Postgres بات** اشاره کند، نه Postgres سایت.

## د) وضعیت پایه‌ی گیت بیلد — ⚠️ typecheck از قبل قرمز است

روی commit `21f2b3f` (که هم `main` است و هم `claude/new-session-leu6ss`)، با درخت کاری تمیز:

| دستور | نتیجه |
|---|---|
| `pnpm install` | ✅ تمیز |
| `pnpm --filter @workspace/api-server run build` | ✅ `Build complete → dist/index.cjs` — فقط وارنینگ از قبل موجودِ `import.meta` در `src/app.ts:18` |
| `pnpm --filter @workspace/irforge run build` | ✅ ۶۵ صفحه prerender شد، بدون خطا |
| `pnpm --filter @workspace/irforge run typecheck` | ❌ **exit 2 — دو خطا** |

دو خطای موجود:

```
src/components/admin/AllBotsTable.tsx(70,47): error TS2741:
  Property 'queryKey' is missing in type '{ enabled: boolean; }'
  but required in type 'UseQueryOptions<AdminUser[], ...>'.

src/components/bots/BotWorkspaceDocument.tsx(48,38): error TS2322:
  Type '"sectionManagement"' is not assignable to type
  '"error" | "copied" | "comingSoon" | ... | "languageSectionNotice"'.
```

هر دو **قبل از این تسک** وجود داشتند: خطای دوم را همان commit آخر
(`21f2b3f "Update BotWorkspaceDocument.tsx"`) وارد کرده که سکشن `management` را با
`labelKey: "sectionManagement"` اضافه کرد ولی کلید `sectionManagement` را به هیچ‌کدام
از ۵ فایل locale اضافه نکرد (`grep -rn "sectionManagement" irforge/src/locales/` هیچی
برنمی‌گرداند) و `LocaleShape` شکست.

**چرا مهم است:** پرامپت `typecheck` را جزو گیت هر فاز گذاشته. تا این دو صفر نشوند،
**هیچ فازی نمی‌تواند «معیار پایان سبز» اعلام کند.** چون فاز ۰ اجازه‌ی تغییر کد ندارد،
اینجا فقط ثبت شد. پیشنهاد برای session بعدی:

- خطای `sectionManagement` **به‌طور طبیعی در فاز ۲** رفع می‌شود (آن فاز خودش
  `BotWorkspaceDocument.tsx` را بازنویسی و همه‌ی labelها را به ۵ locale اضافه می‌کند).
- خطای `AllBotsTable.tsx` بی‌ربط به این تسک است؛ کمترین تغییر ممکن (افزودن `queryKey`
  به options) را در ابتدای فاز ۱ انجام بده و همین‌جا ثبتش کن — وگرنه گیت فاز ۱ سبز نمی‌شود.

## ه) اختلاف‌های بین متن پرامپت و کد واقعی (باید در فازهای بعد رعایت شود)

پرامپت در بخش ۱ می‌گوید «اگر جایی با کد امروز فرق داشت، اول کد را دوباره بخوان و
اینجا یادداشت کن». موارد زیر همان‌هاست:

1. **`Panel` هیچ فیلد `media_ids` ندارد.** `models.py:34-47` فقط
   `media_file_id: str` (تک‌رشته) دارد. لیست کاروسل جای دیگری ذخیره می‌شود:
   `panel.settings["carousel_ids"]` (`handlers/panel_builder.py:1161-1163`). یعنی باگ B2
   دقیقاً این است که هنگام ویرایش مدیا، `media_ids` در FSM با `[fid]` جایگزین می‌شود
   (`panel_builder.py:1448`) و در ذخیره، هم `media_file_id` و هم `settings["carousel_ids"]`
   از همان لیست تک‌عضوی بازنویسی می‌شوند. فاز ۸ باید **هر دو** را با هم مدیریت کند.
2. **انواع پنل ۸ تاست، نه ۶.** کامنت `models.py:37` می‌گوید
   `text | photo | video | audio | document | carousel`، ولی
   `CORE_PANEL_TYPES` (`panel_builder.py:32-41`) `form` و `sell` را هم دارد — و
   `PANEL_TYPES()` انواع پلاگینی را هم دینامیک اضافه می‌کند. قرارداد واقعی
   `CORE_PANEL_TYPES` است.
3. **دکمه‌ها دو فیلد بیشتر از `models.Button` دارند.** دکمه‌ها به‌صورت
   `list[dict]` خام داخل `Panel.buttons` ذخیره می‌شوند و هرگز از `Button.from_dict`
   رد نمی‌شوند، بنابراین `row_start: bool` و `style: str` (`panel_builder.py:946, 970`)
   واقعاً روی دیسک هستند در حالی که `models.Button` فقط
   `label, action, value, row, col` دارد. **اگر `botTypes.ts` را لغت‌به‌لغت از
   `models.py` ترجمه کنی، فاز ۹ داده‌ی کاربر را نابود می‌کند.** `row_start` منبع
   حقیقتِ چیدمان است (`_apply_row_starts`، خط ۹۹۶–۱۰۰۲)، نه `row`.
4. **کلیدهای واقعی `panel.settings`** که در `panel_builder.py` استفاده می‌شوند:
   `timer_seconds`, `password`, `capacity`, `capacity_used`, `forward_groups`,
   `carousel_ids`. (منطبق با فهرست فاز ۱۰.)
5. **اکشن‌های دکمه:** `CORE_BTN_ACTIONS` = `panel, url, mini_app, form, sell,
   callback, phone` (`panel_builder.py:43-51`). کامنت `models.py:20` به‌جای اینها
   `contact | location` را نام می‌برد که در سازنده‌ی دکمه وجود ندارند. قرارداد واقعی
   `CORE_BTN_ACTIONS` است.
6. **`utils/panel_schema.py` و `utils/button_schema.py` قرارداد نیستند.** اینها
   طراحی موازیِ استفاده‌نشده‌ی فاز ۸ بات‌اند (`PanelDefinition`/`ButtonDefinition` با
   `content_ref`/`button_ids`) و خودشان در docstring می‌گویند جایگزین `models.Panel`
   نمی‌شوند. برای `botTypes.ts` فقط `models.py` + `panel_builder.py` را بخوان.
7. **B11 تأیید شد:** `SheetsManager.write()` (`sheets_manager.py:285-294`) اول
   `_ws.clear()` می‌زند و بعد کل تب را بازمی‌نویسد. هر کلید ناشناخته (از جمله
   `__plugin_states__`) در آن بازه از بین می‌رود. سایت باید فقط `upsertRow` تک‌کلیدی بزند.
8. **شکل `custom_commands` تأیید شد:** `key = command` (بدون `/`)، مقدار
   `{ command, target, description, admin_only, is_active, created_at }` و
   `target` یکی از `wallet`-مانندهای built-in یا `panel:{id}` / `form:{id}` / `url:{link}`
   (`handlers/custom_commands.py:8-16, 77-91`).
9. **`__plugin_states__` تأیید شد:** کلیدی داخل تب `bot_settings`
   (`utils/plugin_manager.py:34`, `core/registry.py:191-199`).
10. **گروه‌های دسترسی دینامیک‌اند:** `get_permission_groups`
    (`utils/permissions.py:29-45`) گروه‌های Core را با گروه هر پلاگین کشف‌شده merge
    می‌کند. فاز ۱۳ نباید لیست ثابت hardcode کند.
11. **نگاشت روزهای هفته تأیید شد:** `WorkingHours.days` پیش‌فرض `[0,1,2,3,4]` و
    کامنت صریح `0=Monday … 6=Sunday` (`models.py:157-160`). یعنی «۰ = دوشنبه» متن
    پرامپت درست است.
12. **`tickets`/`ticket_messages` تب‌های lazy پلاگینی‌اند** (از `plugin_db`،
    `handlers/support.py:36-37`)، پس در `_SHEET_NAMES` نیستند و ممکن است در شیت یک
    تننت اصلاً وجود نداشته باشند. فاز ۲۳ باید «تب موجود نیست» را به‌عنوان حالت عادی
    (لیست خالی) هندل کند، نه خطا.

## و) دسترسی و امنیت — پایه‌ای که فاز ۱ باید روی آن بسازد

- `requireBotOwnership` در `routes/bots.ts` تعریف شده و `req.bot` را پر می‌کند؛
  `routes/database.ts` نسخه‌ی خودش (`resolveTarget`) را دارد که علاوه بر مالکیت،
  `404` برای «بات پیدا نشد یا مال شما نیست» و `409` برای «شیت اختصاصی ندارد»
  برمی‌گرداند و به سوپرادمین اجازه‌ی عبور می‌دهد. `resolveBotSheet` فاز ۱ باید
  دقیقاً همین سه رفتار را تکرار کند.
- `bots.token` رمزنگاری‌شده است (`lib/tokenCrypto.ts`) و هیچ‌جا خام به کلاینت
  نمی‌رود؛ الگوی درست برای فازهای ۱۰/۱۶ (پروکسی مدیا) همان
  `GET /api/bots/:botId/avatar` است (`routes/bots.ts:2205`) که `file_id` را
  سمت سرور resolve و استریم می‌کند.
- `deleteRow` در `tenantSheets.ts` عمداً «اول بنویس، بعد دُم را پاک کن» است تا تب در
  فاصله‌ی یک round-trip خالی نماند — این الگو را در فازهای بعد نشکن.

---

## گزارش فاز ۰

- **چه کاری شد:** ممیزی کامل هر دو ریپو و ساخت همین ردیاب.
- **چه فایلی عوض شد:** فقط `PROGRESS_BOTADMIN.md` (فایل جدید). `git status` هیچ فایل
  دیگری نشان نمی‌دهد.
- **چه چیزی تست شد:** هر چهار دستور بخش گیت بیلد روی HEAD اجرا شد تا وضعیت پایه ثبت
  شود؛ نتیجه در بخش «د».
- **چه فرضی گذاشته شد:** چون این محیط هیچ Postgres/کردنشیال گوگلی ندارد، وضعیت
  `entity_cutover_flags` و محتوای شیت‌های واقعی فقط از روی کد و migration استنتاج شده،
  نه از روی داده‌ی زنده.

---

## گزارش فاز ۱ — لایه‌ی سرویس `botConfig` + حل مسئله‌ی کش

**چه کاری شد**

سه ماژول زیرساختی جدید ساخته شد. **هیچ روتی هنوز از این‌ها استفاده نمی‌کند** (معیار
پایان فاز صریحاً همین را می‌خواست) — فقط زیرساخت است.

1. **`api-server/src/lib/botTypes.ts`** — ترجمه‌ی کامل `mainbot/models.py` به
   TypeScript: `Panel`, `PanelButton`, `PanelSettings`, `Form`, `FormField`,
   `BotUser`, `BotAdmin`, `BotRole`, `CustomCommand`, `WorkingHours`, `AntiFlood`,
   `BotSettings` + سازنده‌های پیش‌فرض (`defaultBotSettings`, `newPanel`, `newForm`,
   `newButton`) که مو‌به‌مو همان مقادیر `models.py` را می‌دهند. کامنت بالای فایل
   صریحاً می‌گوید آینه‌ی `models.py` است.

   **سه انحراف عمدی از `models.py` که در ممیزی فاز ۰ کشف شدند و اینجا اعمال شده‌اند:**
   `row_start`/`style` روی دکمه‌ها (در دیتاکلاس نیستند ولی روی دیسک هستند)،
   مدیای پنل در `media_file_id` + `settings.carousel_ids` (نه `media_ids`)، و
   هشت نوع پنل به‌جای شش‌تا. هر سه با ارجاع به خط دقیق کد بات کامنت شده‌اند.

   همچنین `normalizeButtonLayout` / `buttonsToRows` / `rowsToButtons` — معادل
   دقیق `_migrate_row_starts` + `_apply_row_starts` بات — که فاز ۹ روی آن‌ها
   ساخته می‌شود.

2. **`api-server/src/lib/botCacheBust.ts`** — بعد از هر نوشتن موفق،
   `DELETE FROM irforge_cache WHERE cache_key = '<spreadsheetId>:<tab>'` روی
   `BOT_CACHE_DATABASE_URL`. عمداً به `DATABASE_URL` سایت fallback **نمی‌کند**.
   همه‌ی خطاها بلعیده و فقط لاگ می‌شوند؛ Pool یک listener روی `error` دارد وگرنه
   قطع‌شدن یک اتصال بی‌کار کل پروسس را می‌کشد.

3. **`api-server/src/lib/botConfig.ts`** — `resolveBotSheet` (۴۰۴/۴۰۹ دقیقاً مثل
   `resolveTarget` در `database.ts`، با عبور سوپرادمین)، `listEntity`, `getEntity`,
   `putEntity`, `putEntities`, `removeEntity`, `readSettings`, `patchSettings`,
   `assertSheetsAuthoritative`, `isEntityOnPostgres`, `allCutoverFlags`، و
   `BotConfigError` + `sendBotConfigError` به‌عنوان قرارداد خطای مشترک همه‌ی
   روت‌های بعدی.

**چطور باگ‌های بات اینجا حل شدند**

- **B11 (بازنویسی کل تب):** `patchSettings` حلقه می‌زند و برای هر کلید یک
  `upsertRow` تک‌کلیدی می‌زند. هیچ مسیری در این لایه وجود ندارد که کل تب را
  clear کند. تست صریح دارد که `__plugin_states__` و `payment_cfg` بعد از یک
  patch دست‌نخورده می‌مانند.
- **کش ۶۰ ثانیه‌ای:** `putEntity`/`putEntities`/`removeEntity`/`patchSettings`
  خودشان cache-bust می‌زنند، پس روت‌های فازهای بعد نمی‌توانند فراموشش کنند.
- **cutover:** `assertSheetsAuthoritative(entity)` با کش ۶۰ ثانیه‌ای و رفتار
  fail-open (هر خطا → اجازه، مثل `cutover_flags.py:61-66`).

**چه چیزی تست شد** — `api-server/test/botConfig.test.mjs`، با یک شیت جعلی در حافظه
(هیچ فراخوانی واقعی به Google، طبق قانون ۶):

| تست | چه چیزی را تضمین می‌کند |
|---|---|
| `patchSettings` کلیدهای لمس‌نشده را حفظ می‌کند | باگ B11 — `__plugin_states__` سالم می‌ماند، فقط ۳ کلید upsert می‌شود، هیچ delete‌ای نمی‌خورد |
| `readSettings` پیش‌فرض‌ها را پر می‌کند | شکل کامل `BotSettings` حتی روی شیت خالی؛ `days: [0,1,2,3,4]` |
| merge ناقصِ `working_hours` | کلید غایب از پیش‌فرض می‌آید، کلید موجود بازنویسی نمی‌شود |
| `putEntity`/`getEntity`/`removeEntity` | مقدار JSON-serializable و بدون تغییر؛ `created` درست؛ حذف دوباره `false` |
| شکست cache-bust | `patchSettings` با یک Postgres غیرقابل‌اتصال باز هم موفق می‌شود؛ `bustTabCache` مقدار `false` می‌دهد نه throw؛ کلید کش `SHEET1:bot_settings` |
| `assertSheetsAuthoritative` بدون env | fail-open، throw نمی‌کند |
| round-trip چیدمان دکمه‌ها | `rows → buttons → rows` بدون تغییر؛ migration دکمه‌های قدیمیِ بدون `row_start`؛ `style` دور ریخته نمی‌شود |

اسکریپت `test` در `api-server/package.json` به `node --import tsx/esm --test` تغییر
کرد تا تست‌ها مستقیم روی سورس TypeScript اجرا شوند نه روی باندل (تست قبلیِ
`auth-guards.test.mjs` به همین دلیل عملاً فقط قرارداد را در JS بازنویسی می‌کرد).

**رفع دو خطای typecheck از قبل موجود (بخش «د» ممیزی)**

بدون این، معیار پایان هیچ فازی سبز نمی‌شد:

- `irforge/src/components/admin/AllBotsTable.tsx` — تایپ تولیدشده‌ی orval برای
  `useAdminListUsers` فیلد `queryKey` را اجباری کرده. همان کلید پیش‌فرض
  (`getAdminListUsersQueryKey()`) صریح پاس داده شد؛ رفتار صفر تغییر.
- کلید `sectionManagement` به هر ۵ فایل locale اضافه شد (`مدیریت` / `Management` /
  `Yönetim` / `الإدارة` / `Управление`) — commit قبلی سکشن را اضافه کرده بود ولی
  کلیدش را نه، و `LocaleShape` می‌شکست.

**گیت بیلد** — هر سه سبز:
`api-server build` ✅ (فقط وارنینگ از قبل موجودِ `import.meta`) ·
`irforge build` ✅ (۶۵ صفحه) · `irforge typecheck` ✅ (**صفر خطا**، از ۲ خطا) ·
`api-server test` ✅ ۱۲ تست.

**فرض‌ها/ریسک‌ها**

- cache-bust فقط L2 (Postgres مشترک) را پاک می‌کند. L1 درون‌پروسسی هر replica از
  بیرون قابل دسترسی نیست، پس در بدترین حالت هنوز تا ۶۰ ثانیه تأخیر ممکن است —
  متن بنر UI در فاز ۴ باید همین را بگوید، نه «فوری».
- `nowIso()` عمداً `Z` را حذف می‌کند تا با `datetime.utcnow().isoformat()` بات
  یکسان باشد (بات هم timezone-naive می‌نویسد).
- تست‌ها یک `DATABASE_URL` ساختگی ست می‌کنند چون `@workspace/db` موقع import
  بدون آن throw می‌کند؛ `pg.Pool` تنبل است و هیچ اتصالی برقرار نمی‌شود.

---

## گزارش فاز ۲ — پوسته‌ی workspace و ناوبری بات‌ها

**چه کاری شد**

1. **سکشن فعال حالا در URL است، نه در `useState`.** `BotWorkspaceDocument` با
   `useSearch()` مقدار `?section=` را می‌خواند و با `navigate()` می‌نویسد. یعنی
   `/bots/:id?section=panels` مستقیم همان سکشن را باز می‌کند، refresh سکشن را حفظ
   می‌کند، دکمه‌ی back بین سکشن‌ها حرکت می‌کند و لینک قابل بوکمارک است.
   مقدار نامعتبر → `overview`. **مقدار قفل‌شده هم → `overview`** (یک بوکمارک از
   فاز آینده نباید کاربر را روی پنل خالی بیندازد).

2. **سایدبار گروه‌بندی شد** — هفت گروه، دقیقاً طبق بند ۳ فاز:

   | گروه | سکشن‌ها |
   |---|---|
   | نمای کلی | `overview`, `profile`, `stats` |
   | محتوا | `panels` 🔒, `forms` 🔒, `commands` |
   | کاربران | `users` 🔒, `admins` 🔒 |
   | فروش | `orders` 🔒, `discounts` 🔒 |
   | ارتباط | `broadcast` 🔒, `tickets` 🔒 |
   | پیشرفته | `objects` 🔒, `relations` 🔒, `workflows` 🔒, `plugins` |
   | تنظیمات | `language` 🔒, `settings` (چرخ‌دنده، ته لیست) |

   ۱۱ سکشن جدید با `locked: true` و آیکون قفل + tooltip «به‌زودی» اضافه شدند.
   **در هر فاز بعدی فقط سکشن خودش unlock می‌شود.**

3. **آیکون چرخ‌دنده** در کارت هر بات در `/bots`، کنار دکمه‌ی «مدیریت»، مستقیم به
   `/bots/:id?section=settings` (`aria-label` و `title` هر دو از locale).

4. **موبایل:** روی md+ گروه‌ها با هدرِ گروه عمودی‌اند؛ زیر md کل لیست به یک نوار
   افقی اسکرول‌شونده از چیپ‌ها تبدیل می‌شود و هدرهای گروه پنهان می‌شوند (روی ۳۷۵px
   یک استک از هدرها کل ویوپورت را قبل از اولین آیتم می‌خورد). این با
   `.contents md:block` انجام شد تا در حالت موبایل گروه‌بندی از DOM محو شود بدون
   دوبار رندر کردن لیست.

5. **کامنت `AnimatePresence` دست‌نخورده ماند** (باگ `mode="wait"` که قبلاً حل شده).

6. **همه‌ی labelها در هر ۵ locale**: ۷ کلید گروه + ۱۱ کلید سکشن جدید +
   `botSettingsShortcut`.

**تغییری که در پرامپت نبود ولی لازم بود:** سکشن `management` حذف شد. آن سکشن فقط
`{section === "management" && <div />}` رندر می‌کرد — یک placeholder خالی که در
ساختار گروه‌بندی‌شده‌ی جدید جایی ندارد و هیچ فازی هم قرار نیست پرش کند. کلید
`sectionManagement` که در فاز ۱ (فقط برای سبز کردن گیت) به ۵ locale اضافه شده بود،
حالا از هر ۵ فایل برداشته شد.

**تست دستی مسیرها**

| سناریو | نتیجه |
|---|---|
| `/bots/:id` بدون query | `overview` |
| `/bots/:id?section=commands` | مستقیم سکشن کامندها |
| `/bots/:id?section=settings` (از چرخ‌دنده) | مستقیم تنظیمات |
| `?section=panels` (هنوز قفل) | برمی‌گردد به `overview` |
| `?section=chelseafc` (نامعتبر) | برمی‌گردد به `overview` |
| refresh روی هر سکشن | همان سکشن می‌ماند |
| کلیک روی سکشن قفل‌شده | غیرفعال، tooltip «به‌زودی» |

چیدمان در fa (RTL) و en (LTR) هر دو با `ms-*`/`me-*` نوشته شده (آیکون قفل با
`ms-auto` در هر دو جهت درست می‌نشیند).

**گیت بیلد** — هر سه سبز.

---

## گزارش فاز ۳ — API تنظیمات ربات

**فایل جدید:** `api-server/src/routes/botSettings.ts` — در `routes/index.ts` ثبت
شد، **بعد از** `botsRouter` تا یک روت عمومی‌تر در `bots.ts` زودتر مسیرهای
`/bots/:botId/settings/*` را نبلعد.

| متد | مسیر | کار |
|---|---|---|
| GET | `/api/bots/:botId/settings` | `BotSettings` کامل با پیش‌فرض‌ها |
| PATCH | `/api/bots/:botId/settings` | آپدیت partial با whitelist |
| GET | `/api/bots/:botId/settings/channels` | لیست کانال‌ها + `force_join_message` |
| POST | `/api/bots/:botId/settings/channels` | افزودن کانال |
| DELETE | `/api/bots/:botId/settings/channels/:idx` | حذف با ایندکس |
| PUT | `/api/bots/:botId/settings/working-hours` | `WorkingHours` کامل |
| PUT | `/api/bots/:botId/settings/anti-flood` | `AntiFlood` کامل |

**دسترسی (باگ B3):** هیچ روتی بدون کنترل مالکیت نیست — همه از `resolveBotSheet`
رد می‌شوند که ۴۰۴ («این بات پیدا نشد یا مال شما نیست») و ۴۰۹ («هنوز شیت اختصاصی
ندارد») می‌دهد و سوپرادمین را عبور می‌دهد. برخلاف بات که سه هندلر
`pb:ef:title`/`content`/`media` هیچ چک ادمینی ندارند، اینجا استثنا وجود ندارد.

**ولیدیشن سمت سرور — هر کدام با پیام فارسی مشخص، هیچ‌کدام «Internal server error»:**

| قانون | پیام |
|---|---|
| `open_time`/`close_time` = `HH:MM` ۲۴ساعته | «باید به شکل ساعت ۲۴ساعته باشد، مثلاً 09:00 یا 21:30» |
| `days` آرایه‌ی ۰..۶ | «نباید کمتر از ۰ / بیشتر از ۶ باشد» |
| `days` بدون تکرار | «روزهای هفته نباید تکراری باشند» |
| `max_messages` ≥ ۱ | «مقدار «max_messages» نباید کمتر از ۱ باشد» |
| `interval_seconds` ≥ ۱ | همان الگو |
| `ban_duration_seconds` ≥ ۰ | همان الگو |
| کانال با `@` یا آی‌دی عددی منفی | «باید با @ شروع شود (مثل @mychannel) یا یک آی‌دی عددی منفی باشد» |
| کانال تکراری | ۴۰۹ «این کانال از قبل در لیست هست» (مقایسه case-insensitive) |
| طول پیام ≤ ۴۰۰۰ | «طول «…» از ۴۰۰۰ کاراکتر بیشتر است (سقف تلگرام)» |
| `home_panel_id` باید پنل موجود باشد | ۴۰۰ با کد `panel_not_found`، بعد از خواندن واقعی تب `panels` |
| زبان از لیست پشتیبانی‌شده | «زبان «xx» پشتیبانی نمی‌شود…» |
| یوزرنیم پشتیبانی | «۵ تا ۳۲ کاراکتر انگلیسی/عدد/زیرخط» |

**فیلد ناشناخته:** `PATCHABLE_FIELDS` یک whitelist صریح است؛ هر کلید دیگری در
body **نادیده گرفته می‌شود، نه ذخیره**. بدون این، یک کلاینت می‌توانست
`__plugin_states__` یا هر کلید دلخواهی را در تب تنظیمات بات بنویسد. اگر بعد از
فیلتر هیچ فیلد معتبری نماند، ۴۰۰ با کد `empty_patch` برمی‌گردد.

**cache-bust:** هر مسیر نوشتن از `patchSettings` می‌گذرد که خودش بعد از نوشتن
`bustTabCache` می‌زند — قابل فراموش‌کردن نیست چون روت اصلاً دسترسی مستقیم به
`tenantSheets` ندارد.

**cutover:** هر سه مسیر نوشتن اول `assertSheetsAuthoritative("bot_settings")` را
صدا می‌زنند؛ اگر آن entity به Postgres مهاجرت کرده باشد، ۴۰۹ با کد
`entity_on_postgres` برمی‌گردد به‌جای اینکه کاربر فکر کند ذخیره شد.

**متادیتای پاسخ:** `GET`/`PATCH` علاوه بر `settings` یک فیلد `cacheBust: boolean`
برمی‌گردانند تا UI فاز ۴ بتواند بنر درست را نشان دهد («چند ثانیه» وقتی cache-bust
فعال است، «تا حدود یک دقیقه» وقتی نیست) به‌جای اینکه عدد را حدس بزند.

**گیت بیلد:** build سرور سبز.

---

## گزارش فازهای ۴ و ۵ — UI تنظیمات ربات

این دو فاز در یک commit رفتند چون فاز ۴ میزبان تب‌هاست و فاز ۵ سه تب دیگر به
همان میزبان اضافه می‌کند؛ جدا کردنشان یعنی یک commit که build نمی‌شود.

### ساختار

`BotSettingsForm.tsx` قدیمی **حذف شد** — یک صفحه‌ی طولانی که چهار موضوع بی‌ربط
(نام بات، کد ادمین، شیت، حذف) را پشت‌سرهم چیده بود. جایش:

```
irforge/src/components/bots/settings/
  api.ts                 هوک‌های react-query روی customFetch (بدون orval)
  useDraft.ts            «state محلی + ذخیره‌ی صریح» مشترک همه‌ی تب‌ها
  SettingsSaveBar.tsx    نوار ذخیره/بازگردانی + بنر کش + نمایش خطا
  BotSettingsSection.tsx میزبان تب‌ها
  TabGeneral.tsx  TabMessages.tsx  TabForceJoin.tsx
  TabWorkingHours.tsx  TabAntiFlood.tsx  TabPayment.tsx  TabDanger.tsx
```

### هفت تب

| تب | محتوا |
|---|---|
| عمومی | نام/توضیح بات (Postgres سایت) + زبان، ارز، واترمارک، حالت تعمیر (شیت) |
| پیام‌ها | هر ۱۱ پیام، با شمارنده‌ی کاراکتر و چیپ‌های placeholder |
| عضویت اجباری | لیست کانال‌ها + افزودن/حذف + بررسی دسترسی + `force_join_message` |
| ساعت کاری | سوییچ، چیپ روزها، ساعت باز/بسته، پیام، پیش‌نمایش زنده |
| آنتی‌فلاد | سوییچ + سه عدد با توضیح + خلاصه‌ی یک‌خطی + پیام اخطار |
| پرداخت | `payment_info`, `support_username` |
| خطرناک | توکن، کد ادمین، شیت (فقط سوپرادمین)، حذف بات با تأیید تایپ نام |

### رفتار مشترک (طبق «رفتار مشترک همه‌ی تب‌ها»ی فاز ۴)

- **state محلی + ذخیره‌ی صریح + بازگردانی** در `useDraft`.
- **دکمه‌ی ذخیره تا وقتی چیزی عوض نشده disabled است** — مقایسه‌ی عمیق پیش‌نویس
  با داده‌ی سرور، نه یک فلگ دستی که یادش می‌رود ریست شود.
- `useDraft` وقتی داده‌ی تازه از سرور می‌آید **فقط اگر کاربر چیزی تغییر نداده
  باشد** خودش را به‌روز می‌کند؛ وگرنه یک refetch پس‌زمینه ورودی نیمه‌کاره را می‌کشت.
- **بنر تأخیر** از فیلد `cacheBust` پاسخ سرور می‌آید، حدس زده نمی‌شود: «چند
  ثانیه» وقتی cache-bust فعال است، «تا حدود یک دقیقه» وقتی نیست.
- **`409 entity_on_postgres`** پیام مخصوص خودش را دارد، نه «خطایی رخ داد».
- بات بدون شیت (`409 no_sheet`) پیام «هنوز شیت ندارد» می‌گیرد، نه خطا.

### باگ B1 — هشدار تغییرات ذخیره‌نشده

`irforge/src/lib/unsaved-changes.ts` یک رجیستری کوچک بیرون از React است، چون
ناوبری سکشن‌ها با `navigate()` روی `<button>` انجام می‌شود؛ نه `beforeunload`
می‌گیردش و نه یک listener روی کلیک لینک‌ها. سه پوشش:

| ترک از کجا | مکانیزم |
|---|---|
| سوییچ تب داخل تنظیمات | `AlertDialog` («همین‌جا می‌مانم» / «بی‌خیال شو و برو») |
| سوییچ سکشن در سایدبار workspace | `confirmDiscardUnsaved()` داخل `goTo` |
| بستن/refresh تب مرورگر | `beforeunload` در `useUnsavedGuard` |

### تب پیام‌ها — چیپ‌های placeholder

`{order_id}`, `{amount}`, `{reason}`, `{support}` زیر هر پیام مربوطه به‌صورت
چیپ کلیک‌شدنی‌اند و **در محل کرسر** درج می‌شوند (نه ته متن — وگرنه عملاً
بی‌فایده‌اند). اگر کاربر یکی را حذف کند، هشدار زیر همان textarea می‌آید و دقیقاً
می‌گوید کدام‌ها گم شده‌اند. شمارنده‌ی کاراکتر روی ۴۰۰۰ قرمز می‌شود و ذخیره جلوی
ارسال را می‌گیرد (سرور هم مستقلاً همین را رد می‌کند).

### فاز ۵ — سه تب

- **عضویت اجباری:** افزودن با Enter یا دکمه، حذف تکی، و دکمه‌ی «بررسی دسترسی» که
  اندپوینت جدید `POST /api/bots/:botId/settings/channels/check` را صدا می‌زند.
  آن اندپوینت با توکن رمزگشایی‌شده‌ی بات `getMe` + `getChatMember` می‌زند و سه
  حالت برمی‌گرداند: `ok` (بات ادمین است)، `error` (نیست/کانال پیدا نشد)،
  `unknown` (توکن در دسترس نیست یا تلگرام جواب نداد). **توکن هرگز به کلاینت
  نمی‌رود** و نبودن توکن crash نیست، یک نتیجه‌ی «نامعلوم» با پیام روشن است.

- **ساعت کاری — نگاشت روزها تأیید شد:** `models.py:158` صریحاً
  `# 0=Monday … 6=Sunday` است و پیش‌فرض `[0,1,2,3,4]` یعنی دوشنبه تا جمعه. چیپ‌ها
  به همین ترتیب چیده شده‌اند. این با `Date.getDay()` جاوااسکریپت (۰=یکشنبه)
  **یکی نیست**، و تبدیل در تابع جداگانه‌ی `jsDayToBotDay(jsDay) = (jsDay+6)%7`
  انجام می‌شود تا یک جای واحد داشته باشد.
  پیش‌نمایش زنده «الان بات باز/بسته است» با **ساعت ایران (UTC+3:30)** حساب
  می‌شود نه ساعت مرورگر کاربر، و بازه‌ی شب‌گرد (مثل ۲۲:۰۰ تا ۰۶:۰۰) را هم درست
  می‌فهمد.

- **آنتی‌فلاد:** سه عدد با ولیدیشن محلیِ هم‌ارز سرور (`max_messages ≥ 1`,
  `interval_seconds ≥ 1`, `ban_duration_seconds ≥ 0`)، توضیح یک‌خطی زیر هرکدام، و
  یک خلاصه‌ی پویا: «بیشتر از ۵ پیام در ۵ ثانیه ← ۶۰ ثانیه بی‌جواب».

### i18n

namespace جدید `botSettings` با **۱۳۷ کلید در هر ۵ زبان** (fa/en/tr/ar/ru).
کد جدید هیچ `fa ? "…" : "…"`ای ندارد؛ حتی متن‌هایی که از `BotSettingsForm`
منتقل شدند به locale رفتند (آن فایل فقط دو زبان را پوشش می‌داد).

### موبایل و RTL

نوار هفت‌تایی تب‌ها زیر md افقی اسکرول می‌شود. همه‌ی فاصله‌ها `ms-*`/`me-*`.
ورودی‌های ساعت، یوزرنیم، توکن و شناسه‌ی شیت `dir="ltr"` دارند تا در فارسی هم
درست خوانده شوند.

**گیت بیلد:** هر سه سبز + ۱۲ تست سرور.

---

## گزارش فاز ۶ — API پنل‌ها

**تفکیک:** منطق دامنه در `api-server/src/lib/panelOps.ts` (بدون HTTP، بدون
Google → قابل تست)، و `routes/botPanels.ts` فقط ولیدیشن ورودی و HTTP.

| متد | مسیر | کار |
|---|---|---|
| GET | `/panels` | لیست + درخت محاسبه‌شده |
| GET | `/panels/health` | گزارش ناهماهنگی‌ها |
| POST | `/panels/repair` | رفع خودکار موارد قابل‌رفع |
| GET | `/panels/:panelId` | یک پنل |
| GET | `/panels/:panelId/references` | چه کسی به این پنل لینک داده |
| POST | `/panels` | ساخت (id سمت سرور با `crypto.randomUUID`) |
| PATCH | `/panels/:panelId` | ویرایش partial |
| DELETE | `/panels/:panelId?strategy=…&buttonStrategy=…` | حذف امن |
| POST | `/panels/:panelId/home` | ست‌کردن خانه |
| POST | `/panels/:panelId/toggle` | فعال/غیرفعال |
| POST | `/panels/:panelId/link` | تغییر والد |
| GET | `/panel-catalog` | انواع پنل/اکشن/استایل برای UI |

`/panels/health` و `/panels/repair` عمداً **قبل از** `/panels/:panelId` ثبت
شده‌اند، وگرنه اکسپرس «health» را یک `panelId` می‌خواند.

### حذف — باگ‌های B6 و B7

`strategy` **اجباری** است (بدون آن ۴۰۰ با کد `strategy_required`)، چون هر سه
انتخاب معنای متفاوتی دارند و پیش‌فرضِ ضمنی همان کاری است که بات می‌کند:
یتیم‌کردن بی‌خبر.

| strategy | رفتار |
|---|---|
| `cascade` | کل زیردرخت حذف می‌شود |
| `reparent` | بچه‌ها به `parent_id` پنل حذف‌شده وصل می‌شوند |
| `orphan` | بچه‌ها `parent_id = null` می‌گیرند |

در **هر سه** حالت: `children` همه‌ی والدها از روی `parent_id`ها بازسازی می‌شود،
دکمه‌های `action="panel"` که به پنل حذف‌شده اشاره دارند طبق `buttonStrategy`
(`disable` پیش‌فرض یا `remove`) اصلاح می‌شوند، و اگر پنلِ حذف‌شده خانه بود
`bot_settings.home_panel_id` هم پاک می‌شود.

**«غیرفعال‌کردن» دکمه دقیقاً یعنی چه:** بات هر action ناشناخته را به
`callback_data = value or "noop"` تبدیل می‌کند (`handlers/user.py:853`) و هیچ
هندلری روی `noop` نیست. پس دکمه‌ی غیرفعال‌شده `{action:"callback", value:"noop"}`
می‌شود: دکمه سر جایش می‌ماند ولی کاری نمی‌کند — به‌جای اینکه به پنل ناموجود لینک
بدهد. این از روی رفتار واقعی بات انتخاب شد، نه حدس.

**کامندهای معلق فقط گزارش می‌شوند، اصلاح نمی‌شوند:** یک کامند با
`target="panel:<id>"` بعد از حذف پنل معلق می‌ماند، ولی تصمیمش با کاربر است
(فاز ۱۲ ویرایشگرش را می‌سازد) — حذفِ یک پنل نباید بی‌خبر کامند کاربر را دستکاری کند.

### خانه — باگ B8

`setHomePanel` هر سه کار را با هم می‌کند: `is_home=false` روی بقیه،
`is_home=true` روی این، و `home_panel_id` در تنظیمات. اگر وسط کار شکست بخورد،
best-effort پرچم‌ها را برمی‌گرداند و لاگ می‌کند.

### `/health` و `/repair`

هفت کد ناهماهنگی: `home_mismatch`, `multiple_home`, `no_home`,
`dangling_parent`, `stale_children`, `button_to_missing_panel`,
`command_to_missing_panel`. هرکدام پرچم `repairable` دارند و `/repair` فقط
همان‌ها را درست می‌کند (کامند معلق عمداً `repairable: false` است).

### تغییر نوع پنل — باگ B5

در بات **اصلاً ممکن نیست** (منوی `pb:edit:` فقط عنوان/محتوا/مدیا/دکمه دارد).
اینجا `PATCH` نوع را می‌پذیرد و در پاسخ فیلد `dropped` برمی‌گرداند تا UI بتواند
دقیقاً بگوید چه چیزی از دست رفت: نوع متنی‌شده → کل مدیا، نوع تک‌مدیایی‌شده →
فقط اولین مدیای کاروسل می‌ماند.

### باگی که تست پیدا کرد

`buildTree` برای زنجیره‌ی حلقه‌ای والد (A→B→A) یک **گراف حلقه‌ای** برمی‌گرداند.
پیمایش ساده‌ی خروجی — از جمله `JSON.stringify` در پاسخ HTTP — روی آن می‌ایستد.
حالا حلقه‌ها قبل از ساخت گراف شناسایی و بریده می‌شوند (هر گره روی حلقه ریشه
می‌شود). این باگ فقط به این دلیل پیدا شد که تست خروجی را واقعاً پیمایش می‌کرد.

### ولیدیشن

عنوان (خالی نباشد، ≤۲۰۰)، محتوا (≤۴۰۰۰)، شکل نوع و اکشن، `https://` اجباری برای
`url`/`mini_app`، استایل از لیست مجاز، حداکثر ۸ دکمه در ردیف، حداکثر ۱۰۰ دکمه،
`timer_seconds` بین ۰ تا ۸۶۴۰۰، `capacity ≥ 0`، و **والد**: باید موجود باشد،
خودش نباشد، و از نوادگان خودش نباشد (جلوگیری از حلقه، کد `cycle`).

نوع پنلِ ناشناخته **رد نمی‌شود** بلکه فقط شکلش چک می‌شود: پلاگین‌های فعال انواع
جدید ثبت می‌کنند و سایت لیستشان را قطعی نمی‌داند؛ رد کردن یعنی سایت جلوی یک نوع
کاملاً معتبر را بگیرد.

**PATCH هرگز فیلد غایب را پاک نمی‌کند** — merge روی whitelist است.

**گیت بیلد:** build سرور سبز، **۲۰ تست سبز**.
