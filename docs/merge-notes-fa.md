# یادداشت ترکیب (web)

این درخت ترکیبِ سه چیز است، روی پایه‌ی `irforge-web-main__15_.zip`:

1. **اصلاحات امنیتیِ auth + ثبت‌نام یک‌صفحه‌ای** (`routes/signup.ts`، `signup_sessions`، مایگریشن `0059_signup_sessions.sql`، فراموشی رمز با بات، قطع تلگرام).
2. **`school-reps.zip`** — دانش‌آموزِ منتخب (مایگریشن `0058_school_reps.sql`، `routes/schoolReps.ts`، `lib/schoolBot/reps.ts`، `lib/schoolRepSchedule.ts`، صفحه‌ی `pages/schools/teacher/reps.tsx`).
3. **`emoji-files.zip`** (سمت وب) — ایموجی سفارشی (`routes/botCustomEmoji.ts`، `lib/custom-emoji.ts`، `components/emoji/*`، تگ `tg-emoji` در `catalogHtml.ts`، تغییرِ `vite.config.ts` و `ui/input.tsx`/`textarea.tsx`). سمتِ اپِ این ویژگی در `irforge-app-main.zip` است.

## تداخل‌ها و تصمیم‌ها
- `routes/index.ts`، `api-server/migrate.mjs`، `api-server/src/index.ts`: merge سه‌طرفه (هیچ conflict ای نماند). زمان‌بندِ منتخب‌ها داخل بلاکِ `DISABLE_BACKGROUND_JOBS` است.
- شماره‌ی مایگریشن: `0058` برای منتخب‌ها ماند؛ ثبت‌نام شد `0059`.
- `TutorialSectionId` در `lib/tutorials/content.ts`: `"emojis"` اضافه شد (بدونِ آن `BotWorkspaceDocument.tsx` تایپ‌چک نمی‌شد).
- تستِ `CANONICAL_TAGS` به‌روز شد (حالا `tg-emoji` هم هست) + تستِ پاک‌سازیِ `emoji-id` اضافه شد.

## زبان‌ها
- کلیدهای `schools.*` برای منتخب‌ها (۴۶ کلید) در **fa و en** هستند؛ طبق تصمیمِ ثبت‌شده در `locales/registry.ts` فضای‌نام `schools` عمداً فقط fa/en دارد و ar/tr/ru به انگلیسی fallback می‌کنند.
- صفحه‌ی منتخب‌ها دیگر متنِ ثابتِ فارسی و `dir="rtl"` ثابت ندارد؛ تاریخ/عدد با زبانِ رابط نمایش داده می‌شود.
- متن‌های ثبت‌نام، فراموشی رمز و خطاهای ورودِ گوگل/گیت‌هاب (۹۱ کلید `auth.*`) در **هر ۵ زبان** هستند.
- دکمه‌ی «قطع تلگرام» در `profile.tsx` هنوز از الگوی قدیمیِ همان فایل (`fa ? … : …`) استفاده می‌کند.

## تستِ واقعی (e2e) — بعد از ترکیب
همه روی Postgres واقعی؛ تلگرام و پیامک با سرورِ جعلیِ محلی، Sheets با seamِ تستیِ رسمیِ `sheetLayer`.

| فایل | چه چیزی را اجرا می‌کند | نتیجه |
|---|---|---|
| `api-server/e2e/auth-e2e.mjs` | ثبت‌نام یک‌صفحه‌ای، جعلِ شماره، بازیابی با بات، قطع تلگرام، rate limit | ۳۸/۳۸ |
| `api-server/e2e/emoji-e2e.mjs` | API ایموجی (ذخیره/اعتبارسنجی/import پک و id/مالکیت) ← خروجیِ واقعی به کدِ پایتونِ اپ | ۲۴/۲۴ |
| `api-server/e2e/reps-e2e.mjs` | API منتخب‌ها، زمان‌بندِ یادآوری، و ویزاردِ ثبتِ تکلیف داخل بات | ۵۴/۵۴ |
| `irforge-app-main/tests/test_emoji_session_e2e.py` | `EmojiAiohttpSession` با aiogram واقعی و سرورِ تلگرامِ جعلی | ۵/۵ |
| `irforge/e2e-ui/emoji-ui.test.jsx` | دکمه‌ی ایموجی، Input/Textarea، CustomEmojiManager در jsdom | ۱۳/۱۳ |

### باگ‌هایی که همین تست‌ها پیدا کردند (و درست شدند)
- **مدیر ایموجی:** ویرایشِ اسم/فعال‌بودن با `name` انجام می‌شد؛ وقتی دو ردیف نامِ یکسان داشتند (همان حالتی که UI می‌گوید اصلاحش کن) تغییرِ یکی روی هر دو اعمال می‌شد. حالا با `id`.
- **مدیر ایموجی:** import پک وسطِ ویرایش‌هایِ ذخیره‌نشده آن‌ها را بی‌صدا دور می‌ریخت. حالا تا ذخیره/لغو، دکمه‌هایِ import غیرفعال است.
- **درجِ ایموجی:** در فیلدی که کاربر هنوز رویش کلیک نکرده، ایموجی اولِ متن درج می‌شد؛ حالا به انتها اضافه می‌شود (و بعد از کلیک، سرِ مکان‌نما).
- **اپ (پایتون):** `emoji-id` با ارقامِ عربی/فارسی («٣٣٣») از whitelist رد می‌شد؛ تلگرام و سمتِ وب فقط ASCII می‌پذیرند.
