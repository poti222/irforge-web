/**
 * test/telegramWebhookGate.test.mjs — امنیتی ۲۰۲۶-۰۹: registerTelegramWebhookIfConfigured
 * نباید بدونِ TELEGRAM_WEBHOOK_ENABLED=true رویِ توکن setWebhook بزند.
 *
 * علتش: TELEGRAM_BOT_TOKEN همان توکنی است که irforge-app با آن getUpdates
 * (polling) می‌زند. صدا زدنِ بی‌قیدوشرطِ setWebhook روی هر بوت، آن polling را
 * بی‌صدا می‌کشت و محتوایِ واقعیِ /start بات را (welcome_msg/دکمه‌ها) از بین
 * می‌برد — دقیقاً همان چیزی که این حادثه را گزارش داد.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { registerTelegramWebhookIfConfigured } = await import("../src/lib/telegram.ts");

function withFetchSpy(run) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { json: async () => ({ ok: true, result: true }) };
  };
  return run(calls).finally(() => {
    global.fetch = original;
  });
}

test("بدونِ TELEGRAM_WEBHOOK_ENABLED، setWebhook هرگز صدا زده نمی‌شود", async () => {
  await withFetchSpy(async (calls) => {
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    const prevSite = process.env.PUBLIC_SITE_URL;
    const prevEnabled = process.env.TELEGRAM_WEBHOOK_ENABLED;
    process.env.TELEGRAM_BOT_TOKEN = "123:fake-token";
    process.env.PUBLIC_SITE_URL = "https://irforge.ir";
    delete process.env.TELEGRAM_WEBHOOK_ENABLED;

    await registerTelegramWebhookIfConfigured();
    assert.equal(calls.length, 0, "setWebhook نباید بدونِ گارد صدا زده شود");

    process.env.TELEGRAM_WEBHOOK_ENABLED = "false";
    await registerTelegramWebhookIfConfigured();
    assert.equal(calls.length, 0, "TELEGRAM_WEBHOOK_ENABLED=false هم نباید فراخوانی کند");

    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevSite === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = prevSite;
    if (prevEnabled === undefined) delete process.env.TELEGRAM_WEBHOOK_ENABLED;
    else process.env.TELEGRAM_WEBHOOK_ENABLED = prevEnabled;
  });
});

test("با TELEGRAM_WEBHOOK_ENABLED=true، setWebhook دقیقاً یک‌بار صدا زده می‌شود", async () => {
  await withFetchSpy(async (calls) => {
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    const prevSite = process.env.PUBLIC_SITE_URL;
    const prevEnabled = process.env.TELEGRAM_WEBHOOK_ENABLED;
    process.env.TELEGRAM_BOT_TOKEN = "123:fake-token";
    process.env.PUBLIC_SITE_URL = "https://irforge.ir";
    process.env.TELEGRAM_WEBHOOK_ENABLED = "true";

    await registerTelegramWebhookIfConfigured();
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/bot123:fake-token\/setWebhook$/);

    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevSite === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = prevSite;
    if (prevEnabled === undefined) delete process.env.TELEGRAM_WEBHOOK_ENABLED;
    else process.env.TELEGRAM_WEBHOOK_ENABLED = prevEnabled;
  });
});
