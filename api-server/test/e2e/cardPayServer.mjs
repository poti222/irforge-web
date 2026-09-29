/**
 * test/e2e/cardPayServer.mjs — سرورِ آزمایشیِ سرتاسری برایِ تستِ irforge-app
 * (`tests/test_card_pay_e2e_site.py`، فاز ۵).
 *
 * یک schemaِ موقت روی Postgresِ واقعی می‌سازد، یک بات + یک کانالِ کارت‌به‌کارت (کارتِ رمزنگاری‌شده)
 * seed می‌کند، و **همان routeهای واقعیِ** API داخلیِ بات و وبهوکِ پیامک را روی یک express واقعی بالا
 * می‌آورد. یک خط JSON چاپ می‌کند: `{"port","sheet","smsUrl","smsSecret","channelId"}` و تا SIGTERM
 * منتظر می‌ماند (بعدش schema را می‌اندازد).
 *
 * اجرا: CARD_TEST_PG_URL=… node --import tsx/esm api-server/test/e2e/cardPayServer.mjs
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY = "cd".repeat(32);
process.env.PAYMENT_INTERNAL_SECRET = process.env.PAYMENT_INTERNAL_SECRET || "e2e-internal-secret";

import fs from "node:fs";
import http from "node:http";
import express from "express";

const { encryptToken } = await import("../../src/lib/tokenCrypto.ts");
const { createInternalBotPaymentsRouter } = await import("../../src/routes/internalBotPayments.ts");
const { createPaymentSmsRouter } = await import("../../src/routes/paymentSmsWebhook.ts");
const { createBotPaymentChannelsRouter } = await import("../../src/routes/botPaymentChannels.ts");
const { generateSmsSecret, hashSmsSecret } = await import("../../src/lib/smsChannelSecret.ts");
const pgMod = await import("pg");
const Pool = pgMod.default?.Pool ?? pgMod.Pool;

const PG_URL = process.env.CARD_TEST_PG_URL;
if (!PG_URL) { console.error("CARD_TEST_PG_URL لازم است"); process.exit(2); }

const readSql = (f) => {
  const t = fs.readFileSync(new URL(`../../../lib/db/migrations/${f}`, import.meta.url), "utf8");
  return t.slice(t.indexOf("-- ───"));
};
const ddl = ["0029_card_autoconfirm.sql", "0030_card_autoconfirm_effects.sql", "0031_card_autoconfirm_reject.sql", "0032_card_autoconfirm_p8_p9.sql"].map(readSql).join("\n");

const SHEET = "sheet_E2E_12345";
const admin = new Pool({ connectionString: PG_URL, max: 2 });
const schema = `card_e2e_${Math.random().toString(36).slice(2, 10)}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({ connectionString: PG_URL, max: 20, options: `-c search_path=${schema}` });
await pool.query(ddl);
await pool.query("CREATE TABLE bots (id text PRIMARY KEY, sheet_id text)");
await pool.query("INSERT INTO bots (id, sheet_id) VALUES ('bot_E2E', $1)", [SHEET]);

const smsSecret = generateSmsSecret();
await pool.query(
  `INSERT INTO payment_channels (id, scope, bot_id, kind, card_number_enc, holder_name, bank_name, sms_secret_hash, active, min_amount_rial)
   VALUES ('ch_e2e','bot','bot_E2E','card_manual',$1,'علی احمدی','بلوبانک',$2,true,1000000)`,
  [encryptToken("6037997000000001"), hashSmsSecret(smsSecret)],
);

const okHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
const resolveBot = async (sid) => {
  const { rows } = await pool.query("SELECT id FROM bots WHERE sheet_id = $1", [sid]);
  return rows[0] ? { botId: rows[0].id } : null;
};

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use("/api", createInternalBotPaymentsRouter({ pool, hitFn: okHit, resolveBot }));
app.use("/api", createPaymentSmsRouter({ pool, hitFn: okHit }));
// پنلِ فروشنده (فاز ۷): همان routeِ واقعیِ مدیریتِ کانال؛ فقط احرازِ هویت/اعلانِ audit جعلی است.
const SELLER = "u_e2e_seller";
app.use("/api", createBotPaymentChannelsRouter({
  pool, hitFn: okHit, audit: async () => {},
  auth: (req, _res, next) => { req.userId = SELLER; next(); },
  resolveBot: async (userId, botId) => {
    if (userId !== SELLER || botId !== "bot_E2E") throw { status: 404, error: "not found" };
    return { botId };
  },
}));
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
process.env.PUBLIC_SITE_URL = `http://127.0.0.1:${port}`;
console.log(JSON.stringify({
  port, sheet: SHEET, botId: "bot_E2E", panelBase: `http://127.0.0.1:${port}/api/bots/bot_E2E/payment-channels`, smsUrl: `http://127.0.0.1:${port}/api/payments/sms/ch_e2e`, smsSecret, channelId: "ch_e2e",
  internalSecret: process.env.PAYMENT_INTERNAL_SECRET,
}));

const shutdown = async () => {
  try { server.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } catch { /* ignore */ }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
