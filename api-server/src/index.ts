import app from "./app";
import { logger } from "./lib/logger";
import { registerTelegramWebhookIfConfigured } from "./lib/telegram";

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
