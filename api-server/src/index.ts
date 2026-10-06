import app from "./app";
import { logger } from "./lib/logger";
import { registerTelegramWebhookIfConfigured } from "./lib/telegram";
import { refreshExchangeRateFromApi } from "./lib/exchangeRate";
import { startPaymentSweeper } from "./lib/paymentSweeper";
import { migrateLegacyWalletTopups } from "./lib/walletTopupMigration";
import { defaultPaymentNotifiers } from "./routes/paymentSmsWebhook";
import { pool as dbPool } from "@workspace/db";
import { runStartupCryptoSelfCheck } from "./lib/tokenCrypto.js";
import { sweepTierExpiry } from "./lib/tierExpiry.js";
import { sweepBotLifecycle } from "./lib/botLifecycle.js";
import { sweepSqlDatabaseExpiry } from "./lib/sqlDatabaseExpiry.js";

const port = Number(process.env.PORT ?? 3000);

// pg-migration checkpoint, condition 3 replacement -- see
// tokenCrypto.ts::runStartupCryptoSelfCheck for why this exists (a real
// cross-service round-trip can't be run from outside a live container) and
// irforge-app's utils/registry_token_crypto.py for the matching bot-side
// check. Never throws.
runStartupCryptoSelfCheck();

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// G8: بی‌صدا و best-effort — نبودش فقط یعنی «اتصال با ربات» غیرفعاله، سرور رو نمی‌خوابونه.
// از حادثه‌ی امنیتی ۲۰۲۶-۰۹ به بعد، پشتِ TELEGRAM_WEBHOOK_ENABLED گارد شده — ببینید
// docstringِ خودِ تابع در lib/telegram.ts.
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

// ماژولِ کارت‌به‌کارتِ خودکار (فاز ۹): هر دقیقه — انقضایِ pending/queued، ارتقایِ صف، پاک‌سازیِ پیامک‌های ignoredِ
// قدیمی و رویدادهای لاگ، و هشدارِ گوشیِ ساکت/فیشِ بی‌جواب/اثرِ گیرکرده. (جایگزینِ expireStaleTopups قدیمی؛ همان
// الگوی setInterval، بدون زیرساختِ cron جدید. چندنمونه‌ای امن است: advisory lock.)
startPaymentSweeper(dbPool as any, defaultPaymentNotifiers(dbPool as any));

// فاز ۸: ردیف‌های قدیمیِ wallet_topups / sms_logs را (idempotent، زیرِ advisory lock، یک تراکنش) به ماژولِ جدید می‌آورد
// تا بعد از استقرار هیچ درخواستِ در حالِ پرداخت یا سابقه‌ای یتیم نماند. بدونِ ردیفِ جدید، چیزی نمی‌نویسد.
// (migrate.mjs پیش از بوت جدول‌ها را ساخته است.) نتیجه در لاگ و در «پنل ادمین ← کارت‌به‌کارت خودکار ← لاگ» می‌آید.
void migrateLegacyWalletTopups(dbPool as any)
  .then((r) => { if (!r.ok && !r.skipped) logger.error({ attention: r.attention, orphans: r.orphans }, "legacy wallet top-up migration incomplete"); })
  .catch((err) => logger.error({ err }, "legacy wallet top-up migration failed"));

// IRFORGE_MONTHLY_TIER_EXPIRY_PROMPT — استاندارد/پرو ماهانه‌اند: باید تمدید یا
// خاموش شوند دقیقاً همان لحظه‌ای که تاریخ می‌رسد، نه فقط یک‌بار در روز. همان
// الگوی setInterval بالا، بدون هیچ زیرساختِ cron جدید.
setInterval(() => {
  void sweepTierExpiry().catch((err) => logger.error({ err }, "sweepTierExpiry failed"));
}, 10 * 60 * 1000);

// انقضا ⇒ حذفِ نهایی (لایوباگ ۲۰۲۶-۱۰-۰۶: «بات‌ها وقتی زمانشان تمام می‌شود پاک نمی‌شوند»): تریال ۷ روزه / پکیج ۳۰ روزه ←
// قطعِ سرویس ← ۷ روز مهلتِ تمدید (هشدار روزِ ۰ و ۳ روز مانده) ← حذفِ کامل. اولین اجرا ۲ دقیقه بعد از بوت
// (تا sweepTierExpiry و خودِ سرور آماده شوند)، بعد هر ۱۰ دقیقه. ببینید lib/botLifetime.ts / lib/botLifecycle.ts.
const runBotLifecycleSweep = () => {
  void sweepBotLifecycle().catch((err) => logger.error({ err }, "sweepBotLifecycle failed"));
};
setTimeout(runBotLifecycleSweep, 2 * 60 * 1000);
setInterval(runBotLifecycleSweep, 10 * 60 * 1000);

// IRFORGE_PAID_SQL_DATABASE_PROMPT — همان دلیلِ sweepTierExpiry بالا، برایِ
// اشتراکِ ماهانه‌ی دیتابیسِ SQL هر بات.
setInterval(() => {
  void sweepSqlDatabaseExpiry().catch((err) => logger.error({ err }, "sweepSqlDatabaseExpiry failed"));
}, 10 * 60 * 1000);
