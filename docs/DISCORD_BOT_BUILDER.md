# بات‌ساز دیسکورد — سمتِ سایت (irforge-web)

این پروژه «کنترل‌کننده»ی بات‌های دیسکورد است: پنل کاربر، ادیتور بصری، API و دیتابیس. خودِ بات‌ها را پروژه‌ی جدا و پایتونیِ
**irforge-dis** اجرا می‌کند (مثل `irforge-app` برای تلگرام).

```
irforge-web (این پروژه)                         irforge-dis (پایتون، discord.py)
 React: /discord-bots, /discord-bots/:id         هر ~۴ ثانیه جدول discord_bots را می‌خواند
 API:   /api/discord-bots/*                      و بات‌ها را روشن/خاموش/هات‌ریلود می‌کند
 DB:    discord_bots, discord_bot_kv, _logs  ◄──► همان دیتابیس Postgres
```

هیچ ارتباط مستقیمی بین دو پروژه نیست؛ فقط دیتابیس مشترک و **یک کلید مشترک** (`BOT_TOKEN_ENCRYPTION_KEY`).

## چه چیزی در این پروژه اضافه شد
* `api-server/src/routes/discordBots.ts` — API (ساخت، توکن، بلوپرینت، start/stop/restart، لاگ، دیتابیس، ادمین)
* `api-server/src/lib/discordBlueprint.ts` + `discordCatalog.json` — اعتبارسنجی (هم‌قانون با پایتون)
* `lib/db/src/schema/discordBots.ts`، جدول‌ها در `api-server/migrate.mjs` (+ `lib/db/migrations/0061_discord_bots.sql`)
* `irforge/src/pages/discord-bots.tsx`، `discord-bot-editor.tsx`، `admin-discord-bots.tsx`،
  `components/discord/*`، `lib/discord-bots-api.ts`، آیتم منو و روت‌ها

## راه‌اندازی
1. Deploy معمولی؛ جدول‌ها با `migrate.mjs` خودکار ساخته می‌شوند.
2. پروژه‌ی **irforge-dis** را جداگانه بالا بیاورید (راهنما در README آن) با **همین `BOT_TOKEN_ENCRYPTION_KEY`** و `DATABASE_URL`.
3. اختیاری: `DISCORD_MAX_BOTS_PER_USER` (پیش‌فرض ۳؛ سوپرادمین نامحدود).

بدون irforge-dis سایت و ادیتور کار می‌کنند ولی بات‌ها هرگز آنلاین نمی‌شوند (پنل هشدار «اجراکننده پاسخ نمی‌دهد» نشان می‌دهد).

## همگام‌سازی کاتالوگ اکشن‌ها
منبع حقیقت در irforge-dis است (`irforge_discord/catalog.json`). بعد از تغییرش:
`node scripts/sync-discord-catalog.mjs ../irforge-dis/irforge_discord/catalog.json`
و `api-server/test/fixtures/discord_blueprint_cases.json` را هم با `irforge-dis/tests/fixtures/blueprint_cases.json` یکی نگه دارید.

## دکمه، منوی انتخاب و فرم (Modal)
* **دکمه / منوی انتخاب** روی اکشن‌های «پاسخ»، «ارسال پیام» و «Embed» اضافه می‌شود (حداکثر ۵ دکمه و ۲ منو). هر کدام اکشن‌های خودش را
  اجرا می‌کند و بعد از ری‌استارت بات هم کار می‌کند. مقدار انتخاب‌شده: `{select.value}` و `{select.values}`.
* **فرم (`show_modal`)** باید اولین کارِ یک دستور اسلش/دکمه/منو باشد (دیسکورد پاسخ اول را فقط برای نمایش فرم می‌پذیرد) و بعد از آن
  اکشن‌های همان لیست اجرا نمی‌شوند؛ ادامه‌ی کار در «بعد از ارسال فرم اجرا شود» است. مقدار فیلدها: `{modal.شناسه}`.
* اکشن‌های دکمه/منو/فرم فقط به اطلاعات «کسی که کلیک/ارسال کرد» دسترسی دارند، نه متغیرهای لحظه‌ی ساخت پیام.
