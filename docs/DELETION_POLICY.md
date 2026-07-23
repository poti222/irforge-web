# سیاست حذف کامل داده (حذف دستی + انقضای پلن)

**فاز:** 1 — فقط مستندسازی و تأیید یافته‌های ممیزی کد. **هیچ کدی در این فاز
تغییر نکرده.**
**این فایل عیناً در هر سه ریپو (`mainbot`, `support-bot`, `web`) کپی شده.**

منبع تصمیم: `ClaudeCode_Prompt_FullDeletion_ExpiryPolicy.md`. این سند فقط
همون تصمیم‌ها و معماری رو مکتوب می‌کنه؛ فازهای ۲ تا ۴ (که کد واقعی رو
می‌سازن) در PROGRESS.md هر ریپو دنبال می‌شن.

---

## ۰. یافته‌های ممیزی کد — تأییدشده در این فاز

قبل از نوشتن این سند، کد واقعی چک شد تا مطمئن بشیم توصیف زیر با وضعیت
فعلی مطابقت داره:

- `website/web/api-server/src/lib/sheetsSync.ts` از قبل دو تابع آماده
  داره که نوشته شدن ولی **هیچ‌جا صدا زده نمی‌شن**:
  `syncTenantDelete(botToken)` (حذف ردیف تننت از تب `tenants` رجیستری) و
  `syncSheetPoolUpsert({...})` (آزادکردن جای شیت توی `sheet_pool`).
  تأیید شد با `grep` روی صادرات این دو تابع و مصرف‌کننده‌هاشون.
- روت `DELETE /api/bots/:botId` در `src/routes/bots.ts` امروز فقط
  Postgres سایت (ردیف بات + `commands` + `installed_plugins`) و
  `syncBotDelete()` (mirror توی `SHEETS_DATA_ID`) رو پاک می‌کنه. تأیید شد:
  بدنه‌ی این روت هیچ فراخوانی‌ای به `syncTenantDelete` یا
  `syncSheetPoolUpsert` نداره.
- اسپردشیت اختصاصیِ هر تننت (پنل/فرم روش سوار هست) فقط با **Google Drive
  API** قابل حذف/ترش‌شدنه. این دسترسی امروز فقط در `mainbot`
  (`bot/utils/sheets_client.py`) وجود داره؛ وب‌سایت به Drive API دسترسی
  ندارد.
- `mainbot/bot/bot/utils/subscriptions.py` فقط `_in_grace()` رو مدیریت
  می‌کنه (پلن فعال در طول grace). بعد از اتمام grace هیچ مکانیزم حذف
  نهایی‌ای وجود نداره — تننت برای همیشه روی پلن رایگان می‌مونه.

این چهار مورد دقیقاً همون مبنایی هستن که معماری فاز‌های بعدی روشون
سوار می‌شه.

---

## ۱. تصمیم محصولی (نهایی)

- بعد از اتمام grace یک تننت:
  - **روز ۰** (لحظه‌ی پایان grace): هشدار اول («۷ روز مونده تا حذف کامل»).
  - **روز ۴**: هشدار دوم («۳ روز مونده تا حذف کامل»).
  - **روز ۷**: حذف کامل و برگشت‌ناپذیر.
- اسپردشیت اختصاصی تننت باید **کامل از گوگل‌درایو حذف/ترش (trash) بشه**،
  نه فقط خالی بشه.

### جدول زمان‌بندی هشدار/حذف انقضا

| زمان نسبت به پایان grace | اقدام |
|---|---|
| ۰ روز | ارسال هشدار ۱: «۷ روز مونده تا حذف کامل» |
| ۴ روز | ارسال هشدار ۲: «۳ روز مونده تا حذف کامل» |
| ۷ روز | حذف کامل و برگشت‌ناپذیر (Drive trash + پاک‌شدن از رجیستری/sheet_pool + پاک‌شدن Postgres سایت) |

---

## ۲. معماری هدف

چون وب‌سایت دسترسی Drive API نداره و mainbot دسترسی مستقیم به Postgres
سایت نداره، هماهنگی بین دو سرویس از طریق یک **صف مشترک** روی همون
اسپردشیت رجیستری انجام می‌شه، به‌علاوه‌ی یک endpoint داخلی محافظت‌شده روی
وب‌سایت:

- تب جدید `deletion_queue` در رجیستری — ستون‌ها:
  `bot_token, tenant_sheet_id, requested_by (manual|expiry), requested_at, status (pending|done|failed)`.
- هر طرفی که تصمیم به حذف گرفت، یک ردیف اینجا اضافه می‌کنه (فقط برای
  ثبت/رصد — منبع اجرای واقعیِ Drive trash جای دیگه‌ست، پایین توضیح داده
  شده).
- یک endpoint داخلی روی وب‌سایت: `POST /internal/bots/:botId/purge`،
  محافظت‌شده با هدر `X-Internal-Secret` (مقایسه با
  `process.env.INTERNAL_PURGE_SECRET`، نه `requireAuth` معمولی). این
  endpoint دقیقاً همون کاری رو می‌کنه که مسیر حذف دستی می‌کنه: پاک‌کردن
  Postgres سایت + `syncTenantDelete` + `syncSheetPoolUpsert` +
  `syncDeletionQueueAdd(requested_by: "expiry")`.
- یک job زمان‌بندی‌شده توی mainbot که صف رو می‌خونه و کار Drive
  (trash کردن اسپردشیت اختصاصی) رو انجام می‌ده.

### ۲.۱ دیاگرام متنی — جریان حذف دستی (کاربر از پنل وب دکمه‌ی حذف رو می‌زنه)

```
[کاربر → دکمه‌ی «حذف بات» در پنل]
        │
        ▼
DELETE /api/bots/:botId   (web/api-server, requireAuth)
        │
        ├─▶ حذف ردیف bot + commands + installed_plugins از Postgres سایت
        ├─▶ syncBotDelete(botId)              → mirror در SHEETS_DATA_ID
        ├─▶ syncTenantDelete(botToken)         → حذف ردیف از تب tenants (رجیستری)
        ├─▶ syncSheetPoolUpsert(status:"available") → آزادکردن جای شیت در sheet_pool
        └─▶ syncDeletionQueueAdd(requested_by:"manual") → ردیف جدید در deletion_queue
                                                            (status: pending)
        ▼
[پاسخ 204 به کاربر — از این لحظه بات و رکوردهای وب‌سایتی‌اش قطعاً پاک شدن]

... (تا ۱۰ دقیقه بعد، غیرهمزمان) ...

[mainbot → deletion_worker، هر ۱۰ دقیقه صف را می‌خواند]
        │
        ├─▶ ردیف pending با tenant_sheet_id پیدا می‌شود
        ├─▶ Drive API: trash کردن اسپردشیت اختصاصی تننت
        └─▶ ردیف صف → status:"done"
```

### ۲.۲ دیاگرام متنی — جریان انقضای پلن (بدون اقدام کاربر)

```
[پایان grace یک تننت — تشخیص توسط mainbot/bot/utils/subscriptions.py]
        │
        ▼
ثبت grace_ended_at  (اولین لحظه‌ای که _in_grace() برای این تننت False می‌شود)
        │
        ▼
[چک دوره‌ای mainbot — همون الگوی scheduler که در plugins/wallet/service.py استفاده شده]
        │
        ├─ 0 ≤ (now − grace_ended_at) < 4 روز  و هشدار۱ نرفته  → ارسال «۷ روز مونده»
        ├─ 4 ≤ (now − grace_ended_at) < 7 روز  و هشدار۲ نرفته  → ارسال «۳ روز مونده»
        └─ (now − grace_ended_at) ≥ 7 روز  و هنوز حذف نشده:
                │
                ├─▶ Drive API: trash مستقیم اسپردشیت اختصاصی تننت
                │      (mainbot از قبل به Drive دسترسی دارد — نیازی به صف نیست)
                ├─▶ پاک‌کردن ردیف تننت از تب tenants رجیستری + آزادکردن sheet_pool
                ├─▶ syncDeletionQueueAdd(requested_by:"expiry") → ثبت در deletion_queue
                │      (صرفاً برای ردیابی/گزارش، نه اجرای مجدد)
                └─▶ POST {WEBSITE_API_URL}/internal/bots/:botId/purge
                       هدر: X-Internal-Secret: {INTERNAL_PURGE_SECRET}
                              │
                              ▼
                    [web/api-server → همون منطق DELETE /api/bots/:botId]
                    پاک‌کردن Postgres سایت (bot + commands + installed_plugins)
                              │
                              ▼
                    اگر HTTP fail شد → فقط لاگ، تلاش مجدد در چرخه‌ی بعدی
                    (idempotent: اگر بات از قبل پاک شده باشد → 404/no-op امن، نه کرش)
```

---

## ۳. نکته‌ی race و ایمنی

- مسیر دستی و مسیر انقضا هر دو در نهایت روی همون سه مقصد اثر می‌ذارن
  (Postgres سایت، تب `tenants`، `sheet_pool`) — به همین دلیل endpoint
  داخلی `purge` باید idempotent باشه: اگر بات از قبل پاک شده (مثلاً هر
  دو مسیر همزمان اجرا شدن)، باید 404 بی‌خطر برگردونه، نه استثنا/کرش.
- تب `deletion_queue` صرفاً برای رصد/گزارش استفاده می‌شه، نه به‌عنوان
  تنها منبع اجرای عملیات مسیر دستی — چون Drive trash در مسیر دستی هم
  توسط همون `deletion_worker` دوره‌ای mainbot (نه بلادرنگ) انجام می‌شه؛
  یعنی «حذف دستی» یک تأخیر کوتاه (تا حداکثر یک چرخه‌ی worker، پیشنهادی
  ۱۰ دقیقه) تا trash شدنِ واقعیِ اسپردشیت داره، هرچند Postgres/رجیستری
  بلافاصله پاک می‌شن.

---

## ۴. ⚠️ نیاز به تأیید دستی (اقدام لازم از علی، در Google Cloud Console)

**باید قبل از رفتن فازهای ۲-۴ به تولید تأیید بشه:**

Service account‌ای که mainbot الان برای Google Sheets استفاده می‌کنه
(`bot/utils/sheets_client.py`) باید scope مربوط به **Drive API**
(`https://www.googleapis.com/auth/drive`) رو هم روی Google Cloud Console
فعال/تأییدشده داشته باشه. بدون این scope:

- عملیات trash کردن اسپردشیت اختصاصی تننت (چه در مسیر انقضا که مستقیم
  توسط mainbot انجام می‌شه، چه در مسیر دستی که توسط `deletion_worker`
  انجام می‌شه) **fail خواهد شد**.
- طبق مکانیزم retry فاز ۳ (حداکثر ۵ بار تلاش، بعدش `status:"failed"` +
  لاگ هشدار)، این fail بی‌صدا نمی‌مونه ولی تا وقتی scope درست نشه، حذف
  واقعی هرگز موفق نمی‌شه — یعنی اسپردشیت‌های تننت‌های حذف‌شده برای همیشه
  در Drive باقی می‌مونن با وضعیت `failed` در صف.

**این یک چک دستی است که باید در Google Cloud Console → IAM & Admin →
Service Accounts (یا از طریق scope‌های OAuth تعریف‌شده برای این
service account) توسط علی انجام و تأیید بشود، قبل از این‌که فاز ۴
(سیاست واقعی انقضا) روی تننت‌های واقعی فعال بشه.**

---

## ۵. وضعیت فعلی این تسک

| فاز | وضعیت | یادداشت |
|---|---|---|
| فاز ۱ — مستندسازی | ✅ انجام شد | همین فایل. هیچ کدی تغییر نکرد. |
| فاز ۲ — website: وصل‌کردن حذف کامل + صف | ⬜ در انتظار | |
| فاز ۳ — mainbot: پردازش صف حذف (Drive trash) | ⬜ در انتظار | |
| فاز ۴ — mainbot: سیاست واقعی انقضا | ⬜ در انتظار | |
| فاز ۵ — تأیید نهایی | ⬜ در انتظار | |
