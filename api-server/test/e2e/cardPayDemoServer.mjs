/**
 * test/e2e/cardPayDemoServer.mjs — سرورِ دموی «کارت‌به‌کارت خودکار» برایِ گرفتنِ **عکسِ واقعیِ آموزش** و تستِ UI.
 *
 * یک schemaِ موقتِ Postgres با همه‌ی جدول‌ها، **routeهای واقعیِ** سایت (مدیریتِ سوپرادمین، شارژِ کیف‌پول، وبهوکِ پیامک، تنظیماتِ
 * فروشنده) و داده‌ی نمونه‌ی واقعی که از خودِ همان routeها/موتورِ تطبیق ساخته می‌شود (نه INSERT ساختگیِ وضعیت‌ها). فقط احرازِ هویت
 * (هدرِ x-demo-user / x-demo-super) جعلی است.
 *
 * اجرا: CARD_TEST_PG_URL=… node --import tsx/esm api-server/test/e2e/cardPayDemoServer.mjs
 * خروجی: یک خطِ JSON با `port` و اطلاعاتِ نمونه؛ تا SIGTERM می‌ماند (بعدش schema را می‌اندازد).
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ef".repeat(32);
process.env.PUBLIC_SITE_URL ??= "https://irforge.ir";
process.env.SMS_WEBHOOK_SECRET ??= "legacy-secret-for-demo";

import http from "node:http";
import express from "express";
import { DDL_ALL, SITE_TABLES_DDL } from "./../helpers/cardPayDdl.mjs";

const { createAdminCardAutoConfirmRouter } = await import("../../src/routes/adminCardAutoConfirm.ts");
const { createWalletTopupRouter } = await import("../../src/routes/walletTopup.ts");
const { createPaymentSmsRouter } = await import("../../src/routes/paymentSmsWebhook.ts");
const { createLegacyWalletWebhookRouter } = await import("../../src/routes/walletTopupSmsWebhook.ts");
const { createBotPaymentChannelsRouter } = await import("../../src/routes/botPaymentChannels.ts");
const { createChannel, validateNewChannel, PLATFORM_OWNER } = await import("../../src/lib/paymentChannelAdmin.ts");
const { matchSms } = await import("../../src/lib/paymentMatcher.ts");
const { createPaymentAlerts } = await import("../../src/lib/paymentAlerts.ts");
const { logPaymentEvent } = await import("../../src/lib/paymentEvents.ts");
const { registerDefaultPaymentEffects } = await import("../../src/lib/paymentEffectsBoot.ts");
const { DEFAULT_CARD_GUIDE } = await import("../../src/lib/platformSettings.ts");
const { createBotPayment } = await import("../../src/lib/paymentBotApi.ts");
const { sweepPaymentRequests } = await import("../../src/lib/paymentSweeper.ts");
registerDefaultPaymentEffects();

const pgMod = await import("pg");
const Pool = pgMod.default?.Pool ?? pgMod.Pool;
const PG_URL = process.env.CARD_TEST_PG_URL;
if (!PG_URL) { console.error("CARD_TEST_PG_URL لازم است"); process.exit(2); }

const admin = new Pool({ connectionString: PG_URL, max: 2 });
const schema = `card_demo_${Math.random().toString(36).slice(2, 10)}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({ connectionString: PG_URL, max: 20, options: `-c search_path=${schema}` });
await pool.query(DDL_ALL);
await pool.query(SITE_TABLES_DDL);
await pool.query(`INSERT INTO users (id, name, email, role) VALUES
  ('u_admin','مدیر سایت','admin@irforge.ir','super_admin'),
  ('u_demo','کاربر نمونه','user@example.com','user'),
  ('u_maryam','مریم احمدی','maryam@example.com','user'),
  ('u_reza','رضا کریمی','reza@example.com','user'),
  ('u_sara','سارا محمدی','sara@example.com','user'),
  ('u_omid','امید حسینی','omid@example.com','user'),
  ('u_seller','نگین صادقی (فروشنده)','negin@example.com','user')`);
await pool.query(`INSERT INTO bots (id, user_id, name, sheet_id) VALUES ('bot_demo','u_seller','فروشگاه نمونه','sheet_DEMO_12345')`);

const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
const alerts = createPaymentAlerts({
  record: (ev) => logPaymentEvent(pool, ev),
  notifyPlatformUser: async () => {},
  notifyAdmins: async () => {},
  notifyBotOwner: async () => {},
});
const notifiers = { record: (ev) => logPaymentEvent(pool, ev), notifyPlatformUser: async () => {}, notifyAdmins: async () => {}, notifyBotOwner: async () => {} };

let guide = null;
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.text({ type: "text/plain", limit: "16kb" }));
const userAuth = (req, res, next) => {
  const u = req.header("x-demo-user");
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
  req.userId = u; next();
};
app.use("/api", createAdminCardAutoConfirmRouter({
  pool, hitFn: okHit, notifiers, audit: async () => {},
  superAdmin: (req, res, next) => {
    if (req.header("x-demo-super") !== "1") { res.status(403).json({ error: "Super admin only" }); return; }
    req.userId = "u_admin"; next();
  },
}));
app.use("/api", createWalletTopupRouter({ pool, hitFn: okHit, alerts, auth: userAuth, profile: (_q, _s, n) => n(), notifyAdmins: async () => {} }));
app.use("/api", createPaymentSmsRouter({ pool, hitFn: okHit, matcher: (p, id) => matchSms(p, id, { alerts }) }));
app.use("/api", createLegacyWalletWebhookRouter({ pool, hitFn: okHit, rateLimit: (_q, _s, n) => n(), alerts }));
app.use("/api", createBotPaymentChannelsRouter({
  pool, hitFn: okHit, audit: async () => {}, auth: userAuth,
  resolveBot: async (userId, botId) => {
    if (botId === "bot_demo" && (userId === "u_seller" || userId === "u_admin")) return { botId };
    throw { status: 404, error: "این بات پیدا نشد یا مال شما نیست." };
  },
  guide: {
    get: async () => guide ?? { ...DEFAULT_CARD_GUIDE },
    set: async (input, by) => { guide = { ...DEFAULT_CARD_GUIDE, ...input, isDefault: false, by }; return guide; },
  },
}));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}/api`;

// ─── داده‌ی نمونه (از همان routeها) ─────────────────────────────────────────
const asUser = async (user, method, path, body) => {
  const res = await fetch(`${origin}${path}`, {
    method, headers: { "content-type": "application/json", "x-demo-user": user }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const sms = async (channelId, secret, text, extra = {}) => (await fetch(`${origin}/payments/sms/${channelId}`, {
  method: "POST", headers: { "content-type": "application/json", "x-sms-secret": secret },
  body: JSON.stringify({ text, sender: "Blubank", time: new Date().toISOString(), ...extra }),
})).json();
const bankSms = (rial, name = "مریم") => `بلو\nواریز پول\n ${name} عزیز، ${Number(rial).toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 12,480,000 ریال\n۲۱:۱۱\n۱۴۰۵.۰۷.۰۷`;

const platform = await createChannel(pool, {
  owner: PLATFORM_OWNER, maxChannels: 5,
  fields: validateNewChannel({ cardNumber: "6037997000000001", holderName: "شرکت آی‌آر‌فورج", bankName: "بلوبانک", senderAllowlist: ["Blubank"], minAmountToman: 100_000 }),
});

// ۱) مریم ۵۰۰ هزار تومان واریز می‌کند → پیامک → تأییدِ خودکار
const rA = await asUser("u_maryam", "POST", "/wallet/topup/request", { amount: 500_000 });
await sms(platform.channel.id, platform.smsSecret, bankSms(rA.json.finalAmount));
// ۲) رضا فیش می‌فرستد (پیامک نمی‌رسد) → منتظرِ بررسی
import fs from "node:fs";
// فیشِ نمونه: اگر DEMO_RECEIPT_PNG داده شده تصویرِ واقعیِ رندرشده، وگرنه یک پیکسل.
const PNG = process.env.DEMO_RECEIPT_PNG && fs.existsSync(process.env.DEMO_RECEIPT_PNG)
  ? `data:image/png;base64,${fs.readFileSync(process.env.DEMO_RECEIPT_PNG).toString("base64")}`
  : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const rB = await asUser("u_reza", "POST", "/wallet/topup/request", { amount: 200_000 });
await asUser("u_reza", "POST", `/wallet/topup/${rB.json.id}/receipt`, { receiptUrl: PNG });
// ۳) سارا در حالِ پرداخت
const rC = await asUser("u_sara", "POST", "/wallet/topup/request", { amount: 100_000 });
// پیامکِ واریزِ سارا ۱۵ دقیقه «زودتر» از ساختِ درخواست ثبت شده (گوشی دیر فوروارد کرده) → خودکار match نمی‌شود؛ ادمین دستی تخصیص می‌دهد
await sms(platform.channel.id, platform.smsSecret, bankSms(rC.json.finalAmount, "سارا"), { time: new Date(Date.now() - 15 * 60_000).toISOString() });
// ۴) امید منقضی می‌شود
const rD = await asUser("u_omid", "POST", "/wallet/topup/request", { amount: 300_000 });
await pool.query("UPDATE payment_requests SET expires_at = NOW() - interval '2 minutes' WHERE id = $1", [rD.json.id]);
await sweepPaymentRequests(pool, { notifiers });
// ۵) پیامکِ واریزِ بدونِ درخواست (۷۰۰ هزار تومان) و یک برداشت (نادیده) و یک فرستنده‌ی ناشناس
await sms(platform.channel.id, platform.smsSecret, bankSms(7_000_000, "فاطمه"), { time: new Date(Date.now() - 20 * 60_000).toISOString() });
await sms(platform.channel.id, platform.smsSecret, `بلو\nبرداشت\n 1,500,000 ریال از حساب شما کسر شد.\n موجودی: 10,980,000 ریال`);
await sms(platform.channel.id, platform.smsSecret, bankSms(2_000_000), { sender: "+98912xxxxxxx" });

// یک تلاشِ ناموفق (secretِ غلط) و یک پیامک از آدرسِ قدیمیِ وبهوک → رویدادِ هشدار در لاگ
await fetch(`${origin}/payments/sms/${platform.channel.id}`, { method: "POST", headers: { "content-type": "application/json", "x-sms-secret": "irfsms_wrong" }, body: JSON.stringify({ text: "x" }) });
await fetch(`${origin}/internal/wallet-topup/sms-webhook`, {
  method: "POST", headers: { "content-type": "application/json", "x-sms-webhook-secret": process.env.SMS_WEBHOOK_SECRET },
  body: JSON.stringify({ text: "پیامکِ تبلیغاتیِ بانک", sender: "Blubank" }),
});

// کانالِ فروشندهٔ نمونه (از همان route) + دو درخواستِ bot + گوشیِ ساکت
const made = await asUser("u_seller", "POST", "/bots/bot_demo/payment-channels", {
  kind: "card_manual", cardNumber: "6104337000000008", holderName: "نگین صادقی", bankName: "ملت", minAmountToman: 100_000, senderAllowlist: ["Bank Mellat"],
});
const botCh = made.json.channel;
await createBotPayment(pool, { botId: "bot_demo", userId: "123456789", purpose: "order", orderId: "ORD-1042", baseAmountRial: 2_500_000 });
const { payment: p2 } = await createBotPayment(pool, { botId: "bot_demo", userId: "987654321", purpose: "wallet_topup", baseAmountRial: 1_500_000 });
await sms(botCh.id, made.json.smsSecret, bankSms(p2.finalAmountRial, "نگین"), { sender: "Bank Mellat" });
await pool.query("UPDATE payment_channels SET last_sms_at = NOW() - interval '20 hours' WHERE id = $1", [botCh.id]);

console.log(JSON.stringify({
  port, origin, platformChannelId: platform.channel.id, platformSecret: platform.smsSecret, botChannelId: botCh.id,
  pendingRequestId: rC.json.id, reviewRequestId: rB.json.id, confirmedRequestId: rA.json.id,
}));

const shutdown = async () => {
  try { server.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } catch { /* ignore */ }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
