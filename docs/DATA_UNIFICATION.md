# یکدست‌سازی env بین سه سرویس (mainbot / support-bot / web)

**فاز:** 1 — فقط مستندسازی، هیچ کدی تغییر نکرده.
**این فایل عیناً در هر سه ریپو (`mainbot`, `support-bot`, `web`) کپی شده.**

نکته‌ی حیاتی که هر فاز بعدی باید بدونه: در حال حاضر **بدون هیچ fallback**ی
هر سه سرویس دارن — یعنی همین امروز هم اگه Railway درست ست شده باشه کار
می‌کنن. فازهای ۲–۴ فقط اسم‌های جدید رو *اضافه* می‌کنن، اسم قدیمی رو حذف
نمی‌کنن؛ پس تا وقتی فاز ۵ (چک‌لیست نهایی Railway) اجرا نشه، تغییری در
رفتار زنده هیچ سرویسی رخ نمی‌ده.

---

## ۱. جدول env varهای مربوط به Google Sheets

### ۱.۱ Spreadsheet ID رجیستری مشترک (تب `tenants`)

این همون شیتیه که هر سه سرویس براش باید یک ID یکسان داشته باشن.

| سرویس | فایل | اسم فعلی | اسم هدف (بعد فاز ۲-۴) | نکته |
|---|---|---|---|---|
| mainbot | `bot/config.py` → `bot/main.py` | `SPREADSHEET_ID` | `REGISTRY_SPREADSHEET_ID` (fallback به `SPREADSHEET_ID`) | **مهم:** `main.py` مستقیماً `SPREADSHEET_ID` رو به `TenantMiddleware` می‌ده و از آن به‌عنوان اسپردشیت رجیستری اصلیِ بات اصلی استفاده می‌کنه (نگاه کن کامنت‌های `main.py` خط ۳۶-۴۹). |
| mainbot | `bot/utils/registry.py` | `REGISTRY_SPREADSHEET_ID` | `REGISTRY_SPREADSHEET_ID` (بدون تغییر) | این ریپو از قبل اسم هدف رو داره؛ فقط `main.py` هنوز از اسم قدیمی (`SPREADSHEET_ID`) می‌خونه. یعنی **همین الان هم این دو تا env var باید مقدار یکسان داشته باشن روی Railway**، چون دو مصرف‌کننده‌ی جدا از دو اسم جدا برای همون یک شیت استفاده می‌کنن. |
| support-bot | `config.py` | `MASTER_REGISTRY_SHEET_ID` (الزامی، بدون fallback) | `REGISTRY_SPREADSHEET_ID` (fallback به `MASTER_REGISTRY_SHEET_ID`) | فعلاً required-بدون-fallback؛ نبودش کل بات رو در import-time می‌ترکونه (`ConfigError`). |
| web/api-server | `src/lib/sheetsSync.ts` | `SHEETS_REGISTRY_ID` | `REGISTRY_SPREADSHEET_ID` (fallback به `SHEETS_REGISTRY_ID`) | تب‌های `tenants` و `sheet_pool` رو توی همین اسپردشیت می‌خونه/می‌نویسه — همون نقش رجیستری. |

### ۱.۲ Credential سرویس‌اکانت گوگل

| سرویس | فایل | فرمت فعلی | اسم هدف | نکته |
|---|---|---|---|---|
| mainbot | `bot/utils/sheets_client.py` | `GOOGLE_CREDENTIALS_JSON` (رشته JSON کامل؛ اگه ست نباشه fallback به فایل محلی `credentials.json`) | `GOOGLE_CREDENTIALS_JSON` (بدون تغییر) | از قبل اسم هدف رو داره. |
| support-bot | `config.py` | `GOOGLE_SERVICE_ACCOUNT_JSON` (رشته JSON کامل، الزامی) | اول `GOOGLE_CREDENTIALS_JSON` رو چک کن، fallback به `GOOGLE_SERVICE_ACCOUNT_JSON` | |
| web/api-server | `src/lib/sheets.ts` | `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_KEY` (دو تا جدا، PEM؛ فعلاً `GOOGLE_CREDENTIALS_JSON` اصلاً پشتیبانی نمی‌شه) | اول `GOOGLE_CREDENTIALS_JSON` رو چک کن (parse کن `client_email`/`private_key` ازش)، fallback به `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_KEY` | این تنها سرویسیه که الان اصلاً از فرمت JSON کامل پشتیبانی نمی‌کنه — فاز ۴ باید parse اضافه کنه. |

### ۱.۳ اسپردشیت دومی که فقط در web وجود داره (بی‌ربط به رجیستری)

| سرویس | فایل | اسم | نقش |
|---|---|---|---|
| web/api-server | `src/lib/sheetsSync.ts` | `SHEETS_DATA_ID` | یک اسپردشیت کاملاً جدا که تب‌های کسب‌وکاری (`users`, `bots`, `orders`, `sessions`, `admins`, `bot_settings`, `panels`, `forms`, `discounts`, `payments`, `referrals`, `promos`, `support`) رو به شکل key/value آینه (mirror) می‌کنه. Postgres در این سرویس منبع حقیقتِ اصلیه؛ نوشتن روی این شیت fire-and-forget و صرفاً برای دیده‌بانی/بک‌آپ دستیه (نگاه کن کامنت بالای `sheetsSync.ts`). **هیچ ربطی به شیت رجیستری (`tenants`) نداره و در یکدست‌سازی این فاز دست نمی‌خوره** — فقط اگه در آینده لازم شد اسمش هم تغییر کنه، جدا از `REGISTRY_SPREADSHEET_ID` می‌مونه. |

---

## ۲. `BUSINESS_DATABASE_URL` در mainbot — آیا به شیت رجیستری مربوطه؟

**نه، کاملاً جداست و به این فاز (یکدست‌سازی env مربوط به شیت رجیستری) هیچ
ربطی نداره.**

جزئیات (از `bot/config.py`):

- `BUSINESS_DATABASE_URL` یک connection string **Postgres** (پیشنهادی: Neon)
  است، نه یک Spreadsheet ID. نقشش «منبع حقیقتِ داده‌ی تجاری» بعد از مهاجرت
  تدریجی Sheets→Postgres (نگاه کن PHASE 17 در `PROGRESS.md` این ریپو) است.
- این جدا از `DATABASE_URL` هم هست (اون یکی فقط cache/session/queue/lock
  روی Railway Postgres است، بدون هیچ داده‌ی تجاری).
- اگه خالی باشه، بات با یک warning ادامه می‌ده و همه‌چیز از Google Sheets
  خونده می‌شه — کرش نمی‌کنه.
- **جمع‌بندی:** سه متغیر کاملاً مجزا در mainbot وجود داره که نباید با هم
  قاطی بشن:
  1. `SPREADSHEET_ID` / `REGISTRY_SPREADSHEET_ID` → شیت رجیستری (Google
     Sheets) — موضوع این فاز.
  2. `DATABASE_URL` → Postgres، فقط cache/runtime.
  3. `BUSINESS_DATABASE_URL` → Postgres، مهاجرت تدریجی داده‌ی تجاری —
     **خارج از scope این فاز.**

مشابهش در web/api-server هم صادقه: Postgres آنجا (نگاه کن `lib/db`) از
قبل منبع حقیقتِ اصلیه و `SHEETS_DATA_ID` فقط یک آینه‌ست — پس آن Postgres
هم به همین ترتیب از این فاز خارجه.

---

## ۳. چک‌لیست ست‌کردن سرویس‌اکانت گوگل

1. برو به [Google Cloud Console](https://console.cloud.google.com/) →
   پروژه‌ی موردنظر (یا بساز یکی جدید).
2. فعال کن: **Google Sheets API** و **Google Drive API** (mainbot از هر
   دو استفاده می‌کنه — `sheets_client.py` هر دو scope رو می‌خواد؛
   support-bot و web فقط به Sheets API نیاز دارن).
3. برو به **IAM & Admin → Service Accounts → Create Service Account**.
   یک اسم بده (مثلاً `irforge-sheets`)، نقش لازم نیست (دسترسی از طریق
   share مستقیم روی شیت داده می‌شه، نه IAM project-level).
4. روی سرویس‌اکانت ساخته‌شده کلیک کن → تب **Keys → Add Key → Create new
   key → JSON**. یک فایل `.json` دانلود می‌شه — این همون credential کامله.
5. از داخل فایل JSON، مقدار `client_email` رو کپی کن (چیزی شبیه
   `xxx@yyy.iam.gserviceaccount.com`).
6. برو به هر Google Spreadsheet که این سه سرویس باید بهش دسترسی داشته
   باشن (شیت رجیستری + هر شیت tenant + `SHEETS_DATA_ID` در web) → دکمه‌ی
   **Share** → همون `client_email` رو با نقش **Editor** اضافه کن.
7. برای env varها:
   - اگه سرویس فرمت «رشته JSON کامل» می‌خواد (mainbot/support-bot، و بعد
     فاز ۴ هم web): کل محتوای فایل دانلودشده رو minify کن (یک خط، بدون
     newline واقعی — newlineهای داخل `private_key` باید به‌صورت `\n`
     literal بمونن) و بذار توش.
   - اگه سرویس فرمت «email + key جدا» می‌خواد (web فعلاً): از همون فایل
     JSON، `client_email` رو در `GOOGLE_SERVICE_ACCOUNT_EMAIL` و
     `private_key` رو در `GOOGLE_SERVICE_ACCOUNT_KEY` بذار (با `\n`
     literal به‌جای newline واقعی).
8. **هیچ‌وقت این فایل JSON یا محتویاتش رو commit نکن.** فقط در Railway →
   Variables ست بشه.

---

## ۴. وضعیت فعلی یکدست‌سازی

- ✅ فازهای ۱ تا ۴ تکمیل شدن — کد هر سه سرویس الان اسم‌های یکدست‌شده رو
  اول می‌خونه، با fallback اجباری به اسم قدیمی اگه اسم جدید ست نباشه.
  هیچ منطق کاری تغییر نکرده؛ فقط env loading.
  - **فاز ۲ (mainbot):** `REGISTRY_SPREADSHEET_ID` الان تنها منبع خوانده‌شده
    در همه‌جای کده (`config.py` مقدارش رو با fallback به `SPREADSHEET_ID`
    قدیمی محاسبه می‌کنه؛ `main.py`/`registry.py`/`runtime_context.py`/
    `handlers/__init__.py` همه از همون یک مقدار محاسبه‌شده در `config`
    می‌خونن، نه مستقیم از `os.getenv`). `GOOGLE_CREDENTIALS_JSON` از قبل
    اسم هدف بود، تغییری نکرد.
  - **فاز ۳ (support-bot):** `config.py` اول `REGISTRY_SPREADSHEET_ID` و
    `GOOGLE_CREDENTIALS_JSON` رو می‌خونه، fallback به `MASTER_REGISTRY_SHEET_ID`
    و `GOOGLE_SERVICE_ACCOUNT_JSON` قدیمی. رفتار fail-fast (نبود هیچ‌کدوم
    از دو اسم → کرش با پیام روشن) حفظ شده.
  - **فاز ۴ (web/api-server):** `src/lib/sheets.ts` الان `GOOGLE_CREDENTIALS_JSON`
    رو parse می‌کنه (`client_email`/`private_key`)، fallback به
    `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_KEY` قدیمی.
    `src/lib/sheetsSync.ts` اول `REGISTRY_SPREADSHEET_ID` رو می‌خونه،
    fallback به `SHEETS_REGISTRY_ID`. `SHEETS_DATA_ID` دست‌نخورده موند.
    `src/routes/database.ts` (پنل ادمین) هم برای یکدستی به همون resolver
    وصل شد تا با fallback جدید هم‌آهنگ بمونه.
- تا اینجا **هیچ متغیر قدیمی‌ای از Railway حذف نشده و لازم هم نبود** —
  fallback باعث شد کد جدید بدون هیچ تغییر در مقادیر فعلی Railway کار کنه.
- فاز ۵ (همین بخش، پایین) build نهایی هر سه سرویس رو تأیید می‌کنه و
  چک‌لیست دقیق مقادیر Railway رو می‌ده تا دیگه لازم نباشه به fallback
  تکیه کرد.

---

## ۵. چک‌لیست Railway — مقادیر نهایی env varها (بدون تکیه به fallback)

**فاز:** 5 — تأیید نهایی. هیچ کدی در این فاز تغییر نکرد.

### ۵.۱ نتیجه‌ی build/compile هر سه سرویس

| سرویس | دستور | نتیجه |
|---|---|---|
| mainbot | `python3 -m py_compile` روی کل `bot/` | ✅ سبز |
| support-bot | `python3 -m py_compile` روی کل ریپو (بجز `tests/`) | ✅ سبز |
| web/api-server | `pnpm --filter @workspace/api-server run build` (esbuild) | ✅ سبز — `Build complete → dist/index.cjs` (یک warning بی‌ربط و از قبل موجود درباره‌ی `import.meta` در `src/app.ts`، ربطی به این تغییرات نداره) |
| web/irforge (فرانت) | `pnpm --filter @workspace/irforge run build` (vite) | ✅ سبز — `✓ built in ~13s` (warningهای sourcemap و chunk-size بی‌ربط و از قبل موجودن) |

### ۵.۲ مقادیر دقیقی که باید روی Railway ست بشن

اینا اسم‌های **یکدست نهایی**ن. بعد از ست‌کردن این‌ها روی هر سه سرویس،
دیگه هیچ‌کدوم به fallback نیاز نداره (فالبک‌ها همچنان توی کد می‌مونن به‌عنوان
شبکه‌ی ایمنی، ولی دیگه استفاده نمی‌شن).

| Env var | mainbot | support-bot | web/api-server | مقدار |
|---|---|---|---|---|
| `REGISTRY_SPREADSHEET_ID` | ✅ لازم | ✅ لازم | ✅ لازم | همون یک Spreadsheet ID شیت رجیستری (تب `tenants`) — **دقیقاً یک مقدار مشترک بین هر سه سرویس.** |
| `GOOGLE_CREDENTIALS_JSON` | ✅ لازم | ✅ لازم | ✅ لازم | محتوای کامل فایل JSON سرویس‌اکانت گوگل، minify‌شده در یک خط (newline داخل `private_key` به‌صورت `\n` literal) — **همون یک مقدار مشترک بین هر سه سرویس** (همون سرویس‌اکانتی که روی شیت رجیستری Editor شیر شده). |
| `SHEETS_DATA_ID` | ❌ ربطی نداره | ❌ ربطی نداره | ✅ لازم (بی‌ربط به رجیستری) | Spreadsheet ID جداگانه‌ی آینه‌ی داده‌های کسب‌وکاری وب (مستقل از بالا — **مقدار متفاوت** از `REGISTRY_SPREADSHEET_ID`). |
| `BUSINESS_DATABASE_URL` | 🔶 اختیاری | ❌ ربطی نداره | ❌ ربطی نداره | Postgres connection string، خارج از scope این یکدست‌سازی (بخش ۲ همین سند). خالی بمونه هم بات کرش نمی‌کنه. |
| `DATABASE_URL` | ❌ ربطی نداره | ❌ ربطی نداره | ✅ لازم | Postgres اصلی وب، خارج از scope Sheets. |

### ۵.۳ اسم‌های قدیمی — بعد از این فاز دیگه لازم نیستن (ولی حذفشون هم اختیاریه)

بعد از ست‌کردن جدول بالا، این اسم‌های قدیمی صرفاً fallback مرده‌ای هستن که
کد بهشون نیازی نداره؛ می‌تونی نگه‌شون داری (بی‌ضرره) یا از Railway پاک
کنی — تصمیمش با شماست:

| اسم قدیمی | سرویس |
|---|---|
| `SPREADSHEET_ID` | mainbot |
| `MASTER_REGISTRY_SHEET_ID` | support-bot |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | support-bot |
| `SHEETS_REGISTRY_ID` | web/api-server |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | web/api-server |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | web/api-server |

**توصیه:** اول جدول ۵.۲ رو روی هر سه سرویس ست کن و دیپلوی کن، مطمئن شو
همه‌چیز درست کار می‌کنه (لاگ‌ها رو چک کن)، *بعد* اگه خواستی اسم‌های قدیمی
جدول ۵.۳ رو پاک کن. تا وقتی مقدار قدیمی و جدید با هم روی Railway ست
باشن، مشکلی پیش نمی‌آد — کد همیشه اول اسم جدید رو می‌خونه.

---
