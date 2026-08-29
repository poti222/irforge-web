import app from "./app";
import { logger } from "./lib/logger";
import { registerTelegramWebhookIfConfigured } from "./lib/telegram";
import { refreshExchangeRateFromApi } from "./lib/exchangeRate";

const port = Number(process.env.PORT ?? 3000);

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// G8: بی‌صدا و best-effort — نبودش فقط یعنی «اتصال با ربات» غیرفعاله، سرور رو نمی‌خوابونه
void registerTelegramWebhookIfConfigured();

// Phase 10 (identityverificationspec.md): نرخ دلار به ریال هر ساعت تازه
// می‌شود. کرون جداگانه‌ای روی Railway نیست (همان دلیلی که migrate.mjs's
// cleanupExpired() هم در بوت اجرا می‌شود، نه یک job جدا)، ولی این یک پروسه‌ی
// طولانی‌مدت است، پس setInterval همان‌قدر کافی است — نیازی به هیچ زیرساخت
// جدیدی نیست. یک‌بار همین‌جا در بوت هم اجرا می‌شود تا نرخ زودتر از اولین
// ساعت آماده باشد؛ شکستش بی‌صدا لاگ می‌شود (ببینید خودِ تابع) و نرخِ قبلی
// را دست‌نخورده می‌گذارد.
void refreshExchangeRateFromApi();
setInterval(() => { void refreshExchangeRateFromApi(); }, 60 * 60 * 1000);
