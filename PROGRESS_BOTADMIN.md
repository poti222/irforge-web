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
| ۱ — لایه‌ی سرویس `botConfig` + حل کش | ⬜ | — | — | باید قبل از شروع، تصمیم بگیری خطای typecheck از قبل موجود (بخش د) چطور صفر می‌شود، وگرنه معیار پایان این فاز هرگز سبز نمی‌شود. |
| ۲ — پوسته‌ی workspace و ناوبری بات‌ها | ⬜ | — | — | این فاز به‌طور طبیعی خطای `sectionManagement` را رفع می‌کند (بخش د). |
| ۳ — API تنظیمات ربات | ⬜ | — | — | — |
| ۴ — UI تنظیمات ربات (چرخ‌دنده) | ⬜ | — | — | — |
| ۵ — عضویت اجباری / ساعت کاری / آنتی‌فلاد | ⬜ | — | — | نگاشت روزهای هفته `0=دوشنبه … 6=یکشنبه` (تأییدشده در بخش «ه»، مورد ۱۱). |
| ۶ — API پنل‌ها (CRUD پایه) | ⬜ | — | — | شکل واقعی مدیای پنل با متن پرامپت فرق دارد — بخش «ه»، موارد ۱ و ۲. |
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
