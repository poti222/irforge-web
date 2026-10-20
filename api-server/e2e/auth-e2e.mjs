/**
 * e2e/auth-e2e.mjs — تستِ سرتاسریِ ثبت‌نام/بازیابی/قطع تلگرام روی سرور و Postgres واقعی.
 *
 * تلگرام با یک سرور جعلیِ محلی (TELEGRAM_API_BASE) و پیامک sms.ir با `preload.mjs`
 * شبیه‌سازی می‌شود؛ هیچ درخواستی به بیرون نمی‌رود.
 *
 * اجرا (از پوشه‌ی api-server، با یک Postgres خالی روی پورت ۵۴۳۳ و دیتابیسِ `m`):
 *   DATABASE_URL="postgres://postgres@localhost:5433/mm?host=/tmp" node migrate.mjs
 *   node e2e/auth-e2e.mjs
 * مسیر فایل‌ها را در `spawn`/`DATABASE_URL` پایین با محیط خودتان تطبیق دهید.
 */
import http from "http";
import fs from "fs";
import { spawn } from "child_process";
import crypto from "crypto";
import pg from "pg";

const BOT_TOKEN = "123456:TESTTOKEN";
const secret = crypto.createHash("sha256").update(`${BOT_TOKEN}:irforge_webhook_secret`).digest("hex");
const tgSent = [];
const stub = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const m = req.url.split("/").pop();
    let body = {}; try { body = JSON.parse(b || "{}"); } catch {}
    if (m === "sendMessage") tgSent.push(body);
    res.setHeader("content-type", "application/json");
    if (m === "getUserProfilePhotos") return res.end(JSON.stringify({ ok: true, result: { total_count: 0, photos: [] } }));
    res.end(JSON.stringify({ ok: true, result: true }));
  });
}).listen(9999);

// خودپاک‌کننده: بدونِ این، اجرای دوم روی همان دیتابیس با «phone_taken» می‌شکند.
{
  const pool = new pg.Pool({ connectionString: "postgres://postgres@localhost:5433/mm?host=/tmp" });
  await pool.query("TRUNCATE auth_rate_limits, signup_sessions, sms_otp_codes, users CASCADE");
  await pool.end();
}
fs.writeFileSync("/tmp/sms.log", "");
const server = spawn("node", ["--import", "./e2e/preload.mjs", "--import", "tsx/esm", "src/index.ts"], {
  env: { ...process.env, PORT: "3055", NODE_ENV: "development",
    DATABASE_URL: "postgres://postgres@localhost:5433/mm?host=/tmp",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_BOT_USERNAME: "testbot", TELEGRAM_API_BASE: "http://localhost:9999",
    PUBLIC_SITE_URL: "https://example.test", AUTH_DEV_ECHO_CODES: "true", SMSIR_API_KEY: "x", SMSIR_TEMPLATE_ID: "1",
    SESSION_SECRET: "e2e-secret", OTP_HMAC_SECRET: "e2e-otp-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));

const BASE = "http://localhost:3055/api";
let ipCounter = 10;
async function call(path, method = "GET", body, headers = {}) {
  // هر فراخوانی یک «کلاینت» جدا (X-Forwarded-For) تا سطلِ IP مشترک تست را قفل نکند؛ تستِ G خودِ IP را می‌سنجد.
  const xff = headers["x-forwarded-for"] ?? `10.1.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": xff, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra = "") { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra); } }
const lastSmsCode = () => { const l = fs.readFileSync("/tmp/sms.log", "utf8").trim().split("\n").filter(Boolean).pop(); return l ? JSON.parse(l).parameters[0].value : null; };
const webhook = (text, from, chatId = from.id) => call("/telegram/webhook", "POST", { update_id: Math.floor(Math.random() * 1e9), message: { from, chat: { id: chatId }, text } }, { "x-telegram-bot-api-secret-token": secret });

try {
  for (let i = 0; i < 60; i++) { try { const r = await fetch("http://localhost:3055/api/healthz"); if (r.status < 500) break; } catch {} await sleep(500); }
  await sleep(500);

  console.log("A) Single-page signup");
  let r = await call("/auth/signup/start", "POST", { locale: "fa" });
  check("start 201 + deepLink", r.status === 201 && /t\.me\/testbot\?start=/.test(r.body?.deepLink ?? ""), JSON.stringify(r));
  const id = r.body.registrationId; const linkToken = r.body.deepLink.split("start=")[1];
  r = await call(`/auth/signup/${id}/phone/send`, "POST", { phone: "09121110000" });
  check("SMS blocked before Telegram verified", r.status === 409 && r.body.code === "telegram_required");
  r = await call(`/auth/signup/${id}/email/send`, "POST", { email: "a@b.co" });
  check("email code blocked before Telegram verified", r.status === 409 && r.body.code === "telegram_required");
  r = await call(`/auth/signup/${id}/complete`, "POST", { firstName: "علی", lastName: "رضایی", gender: "male", platformUsername: "ali_r", email: "ali@example.com", password: "Passw0rd!x", passwordConfirm: "Passw0rd!x" });
  check("complete refused without Telegram", r.status === 400 && r.body.code === "telegram_not_verified");

  const from = { id: 777001, first_name: "Ali", username: "ali_t", is_bot: false };
  await webhook(`/start ${linkToken}`, from); await sleep(800);
  const confirm = tgSent.find((m) => String(m.chat_id) === "777001" && m.reply_markup);
  const btnUrl = confirm?.reply_markup?.inline_keyboard?.[0]?.[0]?.url ?? "";
  check("bot confirmation has a return-to-signup button", /^https:\/\/example\.test\/register\?resume=[0-9a-f]{48}$/.test(btnUrl), btnUrl);
  r = await call(`/auth/signup/${id}`);
  check("status: telegram verified from server-side identity", r.body?.telegram?.verified === true && r.body.telegram.username === "ali_t");
  const resume = btnUrl.split("resume=")[1];
  r = await call("/auth/signup/resume", "POST", { token: resume });
  check("resume token restores the session", r.status === 200 && r.body.registrationId === id);
  r = await call("/auth/signup/resume", "POST", { token: "0".repeat(48) });
  check("bad resume token rejected", r.status === 404);

  r = await call(`/auth/signup/${id}`, "PATCH", { firstName: "علی", lastName: "رضایی", gender: "male", platformUsername: "Ali_R", email: "ali@example.com" });
  check("draft saved", r.status === 200 && r.body.draft.platformUsername === "ali_r");

  r = await call(`/auth/signup/${id}/phone/send`, "POST", { phone: "09121234567" });
  check("SMS sent after Telegram verified", r.status === 200, JSON.stringify(r));
  const code = lastSmsCode();
  r = await call(`/auth/signup/${id}/phone/verify`, "POST", { code: code === "111111" ? "222222" : "111111" });
  check("wrong code rejected w/ attemptsLeft", r.status === 400 && r.body.attemptsLeft === 4);
  r = await call(`/auth/signup/${id}/complete`, "POST", { firstName: "علی", lastName: "رضایی", gender: "male", platformUsername: "ali_r", email: "ali@example.com", password: "Passw0rd!x", passwordConfirm: "Passw0rd!x" });
  check("complete refused until phone verified", r.status === 400 && r.body.code === "phone_not_verified");
  r = await call(`/auth/signup/${id}/phone/verify`, "POST", { code });
  check("correct code verifies phone", r.status === 200 && r.body.phone.verified === true);
  r = await call(`/auth/signup/${id}/complete`, "POST", { firstName: "علی", lastName: "رضایی", gender: "male", platformUsername: "ali_r", email: "ali@example.com", password: "short", passwordConfirm: "short" });
  check("weak password rejected", r.status === 400 && r.body.code === "invalid_password");
  r = await call(`/auth/signup/${id}/complete`, "POST", { firstName: "علی", lastName: "رضایی", gender: "male", platformUsername: "ali_r", email: "ali@example.com", password: "Passw0rd!x", passwordConfirm: "Passw0rd!x", enableEmail2fa: true });
  check("email 2FA refused when email not verified", r.status === 400 && r.body.code === "email_not_verified");
  r = await call(`/auth/signup/${id}/complete`, "POST", { firstName: "علی", lastName: "رضایی", gender: "male", platformUsername: "ali_r", email: "ali@example.com", password: "Passw0rd!x", passwordConfirm: "Passw0rd!x" });
  check("complete → 201 + session", r.status === 201 && !!r.body.token, JSON.stringify(r).slice(0, 300));
  const token1 = r.body?.token; const user = r.body?.user;
  check("user has verified phone + Telegram + gender + username", user?.telegramId === "777001" && user?.gender === "male" && user?.platformUsername === "ali_r" && user?.phoneVerified === true, JSON.stringify(user).slice(0, 300));
  r = await call("/auth/me", "GET", undefined, { authorization: `Bearer ${token1}` });
  check("/auth/me works with the new token", r.status === 200 && r.body.email === "ali@example.com");
  r = await call(`/auth/signup/${id}/complete`, "POST", {});
  check("session consumed (no double-complete)", r.status === 404);

  console.log("B) Phone-ownership forgery (old kill-by-attempts hole)");
  const victim = "09125550000";
  r = await call("/auth/otp/sms/send", "POST", { phone: victim, purpose: "register" });
  check("send ok", r.status === 200, JSON.stringify(r));
  for (let i = 0; i < 6; i++) await call("/auth/otp/sms/verify", "POST", { phone: victim, purpose: "register", code: "000000" });
  r = await call("/auth/register/sms/complete", "POST", { phone: victim, firstName: "Eve", lastName: "Mallory", email: "eve@example.com", password: "Passw0rd!x", passwordConfirm: "Passw0rd!x" });
  check("registering a number you never verified is refused", r.status === 400 && r.body.code === "phone_not_verified", JSON.stringify(r));

  console.log("C) Password reset via Telegram bot + attempt cap + session revocation");
  tgSent.length = 0;
  r = await call("/auth/forgot-password", "POST", { phone: "09121234567", method: "telegram" });
  check("forgot (telegram) generic 200", r.status === 200);
  const resetMsg = tgSent.find((m) => String(m.chat_id) === "777001" && /<code>(\d{6})<\/code>/.test(m.text));
  const resetCode = resetMsg?.text.match(/<code>(\d{6})<\/code>/)?.[1];
  check("reset code delivered inside the bot", !!resetCode);
  r = await call("/auth/forgot-password", "POST", { phone: "09120000000", method: "telegram" });
  check("unknown number gets the same generic answer", r.status === 200);
  let last;
  for (let i = 0; i < 6; i++) last = await call("/auth/reset-password", "POST", { phone: "09121234567", code: i === 99 ? resetCode : "000000", newPassword: "NewPassw0rd!" });
  check("6th wrong guess is blocked (429)", last.status === 429, JSON.stringify(last));
  r = await call("/auth/reset-password", "POST", { phone: "09121234567", code: resetCode, newPassword: "NewPassw0rd!" });
  check("the correct code is dead after too many attempts", r.status === 400 || r.status === 429, JSON.stringify(r));
  // fresh code
  tgSent.length = 0;
  await sleep(300);
  r = await call("/auth/forgot-password", "POST", { phone: "09121234567", method: "telegram" });
  const code2 = tgSent.map((m) => m.text.match(/<code>(\d{6})<\/code>/)?.[1]).filter(Boolean).pop();
  r = await call("/auth/reset-password", "POST", { phone: "09121234567", code: code2, newPassword: "NewPassw0rd!" });
  check("fresh code resets the password", r.status === 200, JSON.stringify(r));
  r = await call("/auth/me", "GET", undefined, { authorization: `Bearer ${token1}` });
  check("old session revoked after reset", r.status === 401, JSON.stringify(r));
  r = await call("/auth/login", "POST", { phone: "09121234567", password: "NewPassw0rd!" });
  check("login with the new password", r.status === 200 && !!r.body.token, JSON.stringify(r).slice(0, 200));
  const token2 = r.body?.token;

  console.log("D) Disconnect Telegram");
  r = await call("/auth/telegram/unlink", "POST", { password: "wrong" }, { authorization: `Bearer ${token2}` });
  check("wrong password refused", r.status === 401 && r.body.code === "invalid_password");
  tgSent.length = 0;
  r = await call("/auth/telegram/unlink", "POST", { password: "NewPassw0rd!" }, { authorization: `Bearer ${token2}` });
  check("unlink succeeds with the right password", r.status === 200 && r.body.telegramId == null, JSON.stringify(r).slice(0, 300));
  check("profile marked incomplete until a new Telegram is linked", r.body?.profileComplete === false);
  await sleep(300);
  check("old Telegram chat is notified", tgSent.some((m) => String(m.chat_id) === "777001" && /🔌/.test(m.text)));
  r = await call("/auth/telegram/unlink", "POST", { password: "NewPassw0rd!" }, { authorization: `Bearer ${token2}` });
  check("second unlink → not_linked", r.status === 409 && r.body.code === "not_linked");

  console.log("E) Atomic rate limiting under a parallel burst");
  const phones = "09127770000";
  const burst = await Promise.all(Array.from({ length: 30 }, () => call("/auth/otp/sms/send", "POST", { phone: phones, purpose: "register" })));
  const ok = burst.filter((x) => x.status === 200).length;
  check(`parallel SMS-send burst: ${ok} allowed of 30 (cooldown = 1)`, ok === 1, burst.map((b) => b.status).join(","));

  console.log("F) Legacy open registration endpoint");
  r = await call("/auth/register", "POST", { name: "x", email: "x@example.com", password: "Passw0rd!x" });
  check("POST /auth/register → 410", r.status === 410);
  console.log("G) IP limiter cannot be evaded by spoofing the first X-Forwarded-For entry");
  let blocked = 0;
  for (let i = 0; i < 26; i++) {
    const x = await call("/auth/forgot-password", "POST", { phone: `0912${String(3000000 + i)}` }, { "x-forwarded-for": `evil-${i}-${Math.random()}, 203.0.113.9` });
    if (x.status === 429) blocked++;
  }
  check(`same real IP behind rotating spoofed prefixes gets rate-limited (${blocked} blocked of 26)`, blocked >= 1);

  console.log("H) Autosave PATCH does not consume the shared IP bucket");
  const s2 = await call("/auth/signup/start", "POST", { locale: "fa" }, { "x-forwarded-for": "198.51.100.7" });
  let patchBlocked = 0;
  for (let i = 0; i < 40; i++) {
    const x = await call(`/auth/signup/${s2.body.registrationId}`, "PATCH", { firstName: "n" + i }, { "x-forwarded-for": "198.51.100.7" });
    if (x.status === 429) patchBlocked++;
  }
  check("40 autosaves from one IP are all accepted", patchBlocked === 0, String(patchBlocked));
} catch (e) {
  fail++; console.log("E2E crashed:", e);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log("--- server log tail ---\n" + serverLog.split("\n").slice(-25).join("\n"));
  server.kill(); stub.close(); process.exit(fail ? 1 : 0);
}
