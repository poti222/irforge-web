/**
 * routes/signup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ثبت‌نام «یک‌صفحه‌ای».
 *
 * همه‌ی مراحل (هویت، تلگرام، شماره، ایمیل، رمز) روی یک صفحه‌اند، ولی هر عاملِ
 * تأیید **جدا و سمتِ سرور** ثبت می‌شود و `POST …/complete` فقط وقتی حساب
 * می‌سازد که خودِ سرور هر دو عاملِ اجباری را تأییدشده ببیند:
 *
 *   • تلگرام  — اجباری. کاربر لینک عمیقِ بات را باز می‌کند؛ بات `from.id` را از
 *               سرورهای تلگرام می‌گیرد (نه از چیزی که کاربر تایپ کرده) و
 *               `telegram_verified_at` را می‌نویسد. پیامِ تأییدِ بات یک دکمه‌ی
 *               «بازگشت به ثبت‌نام» دارد (routes/telegramWebhook.ts).
 *   • شماره   — اجباری. کدِ پیامکی؛ فقط وقتی تلگرام تأیید شده ارسال می‌شود
 *               (یعنی ربات‌های اسکریپتی پولِ پیامک خرج نمی‌کنند).
 *   • ایمیل   — فقط افزوده می‌شود؛ تأیید اختیاری است (دکمه‌ی «تأیید ایمیل»).
 *               اگر تأیید شود، می‌توان ورود دومرحله‌ای با ایمیل را هم روشن کرد.
 *
 * `registrationId` یک UUID غیرقابل‌حدس است و مثل مسیر قدیمی هرگز در URL نمی‌رود.
 * تنها استثنا توکنِ `resume` است: بات آن را در دکمه‌ی بازگشت می‌گذارد تا مرورگرِ
 * داخلی تلگرام (که storage جدا دارد) بتواند همین نشست را ادامه بدهد؛ عمرش ۳۰
 * دقیقه است و فقط هشِ آن ذخیره می‌شود.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  usersTable,
  sessionsTable,
  botsTable,
  signupSessionsTable,
  telegramLinkTokensTable,
} from "@workspace/db";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normaliseEmail, emailEquals, isEmailUniqueViolation, isPhoneUniqueViolation } from "../lib/email";
import { hashPassword } from "../lib/password";
import { syncSessionUpsert, syncUserUpsert } from "../lib/sheetsSync";
import { authRateLimit, clientIp, hit, send429 } from "../middleware/rateLimit";
import { verifyCaptchaToken } from "../lib/captchaVerify";
import { hashSessionToken, hashUserAgent } from "../lib/sessionToken";
import { toAuthUser } from "./auth";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  devEchoCode,
  generateCode,
  hashCode,
  isExpired,
  normalizePhone,
  verifyCode,
} from "../lib/otp";
import { sendOtpSms } from "../lib/smsir";
import { smsOtpSendRateLimit } from "../lib/smsOtpRateLimit";
import { sendEmailRegistrationCode } from "../lib/authEmails";
import { checkProfile } from "../lib/profile";
import { isFakeName, nameGenderMismatch } from "../lib/identityHeuristics";

const router = Router();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // خودِ نشستِ ثبت‌نام: ۱ روز
const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESUME_TTL_MS = 30 * 60 * 1000;
const MAX_CODE_SENDS_PER_SESSION = 5;

const NAME_MAX = 80;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

class FieldError extends Error {
  constructor(
    public readonly field: string,
    message: string,
    public readonly code: string,
    public readonly status: 400 | 409 = 400,
  ) {
    super(message);
  }
}

function sessionExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function generateSessionToken(userId: string): string {
  return `${userId}.${crypto.randomBytes(32).toString("hex")}`;
}

function botUsername(): string | null {
  const raw = process.env.TELEGRAM_BOT_USERNAME;
  return raw ? raw.replace(/^@/, "") : null;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

async function loadSignup(id: unknown) {
  if (typeof id !== "string" || id === "" || id.length > 80) return null;
  const [row] = await db.select().from(signupSessionsTable).where(eq(signupSessionsTable.id, id)).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/**
 * محدودیتِ per-نشست برای مسیرهای «پرتکرارِ عادی» (ذخیره‌ی خودکارِ پیش‌نویس،
 * لینک تلگرام). این‌ها **نباید** از سطل مشترکِ IP (`authRateLimit`، ۲۰ در ۱۵
 * دقیقه برای کل مسیرهای auth) مصرف کنند: autosave با هر چند ثانیه تایپ یک
 * درخواست می‌زند و کاربرِ واقعی (به‌خصوص پشتِ NAT اپراتورهای موبایل) وسط پر
 * کردن فرم قفل می‌شد. نشست یک UUID غیرقابل‌حدس است، پس کلیدِ مناسبی است.
 */
async function withinSessionLimit(
  req: { params: { id?: string } },
  res: any,
  name: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const verdict = await hit(`signup-${name}:${String(req.params.id ?? "").slice(0, 80)}`, limit, 0, windowMs);
  if (!verdict.allowed) {
    send429(res, verdict.retryAfterSeconds);
    return false;
  }
  return true;
}

async function touch(id: string, patch: Partial<typeof signupSessionsTable.$inferInsert> = {}) {
  await db
    .update(signupSessionsTable)
    .set({ lastActivityAt: new Date(), ...patch })
    .where(eq(signupSessionsTable.id, id));
}

/** هر آنچه صفحه برای رندر لازم دارد؛ هرگز هش کد، IP یا UA برنمی‌گردد. */
function publicView(row: typeof signupSessionsTable.$inferSelect) {
  const emailVerified =
    Boolean(row.emailVerifiedAt) && !!row.email && row.emailVerifiedFor === normaliseEmail(row.email);
  return {
    registrationId: row.id,
    draft: {
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      gender: row.gender === "male" || row.gender === "female" ? row.gender : null,
      platformUsername: row.platformUsername ?? "",
      email: row.email ?? "",
    },
    telegram: {
      verified: Boolean(row.telegramVerifiedAt),
      username: row.telegramUsername,
      firstName: row.telegramFirstName,
    },
    phone: {
      value: row.phone,
      verified: Boolean(row.phoneVerifiedAt),
      codeSent: Boolean(row.phoneCodeHash),
      codeExpiresAt: row.phoneCodeExpiresAt ? row.phoneCodeExpiresAt.toISOString() : null,
      canResend: row.phoneCodeSentCount < MAX_CODE_SENDS_PER_SESSION,
    },
    email: {
      verified: emailVerified,
      codeSent: Boolean(row.emailCodeHash),
      codeExpiresAt: row.emailCodeExpiresAt ? row.emailCodeExpiresAt.toISOString() : null,
      canResend: row.emailCodeSentCount < MAX_CODE_SENDS_PER_SESSION,
    },
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** یک توکن لینک عمیق تازه برای نشست می‌سازد و توکن‌های قبلی همین نشست را پاک می‌کند. */
async function issueTelegramLink(signupId: string): Promise<string | null> {
  const username = botUsername();
  if (!username) return null;
  await db.delete(telegramLinkTokensTable).where(eq(telegramLinkTokensTable.pendingRegistrationId, signupId));
  const token = crypto.randomBytes(16).toString("hex");
  await db.insert(telegramLinkTokensTable).values({
    token,
    userId: null,
    purpose: "signup",
    pendingRegistrationId: signupId,
    expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS),
  });
  return `https://t.me/${username}?start=${token}`;
}

// ─── POST /api/auth/signup/start ─────────────────────────────────────────────
// نشست را می‌سازد (یا نشستِ زنده‌ی خودِ کلاینت را برمی‌گرداند) + لینک بات.
router.post("/auth/signup/start", authRateLimit("signup_start"), async (req, res) => {
  try {
    if (!(await verifyCaptchaToken(req.body?.captchaToken, clientIp(req)))) {
      res.status(400).json({ error: "Captcha verification failed", code: "captcha_failed" });
      return;
    }
    const locale = typeof req.body?.locale === "string" ? req.body.locale.slice(0, 8) : null;

    const existing = await loadSignup(req.body?.registrationId);
    if (existing) {
      const deepLink = await issueTelegramLink(existing.id);
      if (!deepLink) {
        res.status(503).json({ error: "Registration is not configured on this server" });
        return;
      }
      res.json({ ...publicView(existing), deepLink });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const [created] = await db
      .insert(signupSessionsTable)
      .values({
        id,
        locale,
        sourceIp: clientIp(req),
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 512) || null,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
      .returning();

    const deepLink = await issueTelegramLink(id);
    if (!deepLink) {
      logger.error("TELEGRAM_BOT_USERNAME is not configured; signup deep link unavailable");
      res.status(503).json({ error: "Registration is not configured on this server" });
      return;
    }
    logger.info({ registrationId: id }, "Signup session started");
    res.status(201).json({ ...publicView(created), deepLink });
  } catch (err) {
    logger.error({ err }, "signup/start error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/resume ────────────────────────────────────────────
// دکمه‌ی «بازگشت به ثبت‌نام» داخل پیامِ بات. مرورگرِ داخلیِ تلگرام storage
// جدا دارد، پس نمی‌تواند `registrationId` را از تبِ اصلی بخواند.
router.post("/auth/signup/resume", authRateLimit("signup_resume"), async (req, res) => {
  try {
    const token = req.body?.token;
    if (typeof token !== "string" || token.length < 16 || token.length > 128) {
      res.status(404).json({ error: "Link expired", code: "resume_expired" });
      return;
    }
    const [row] = await db
      .select()
      .from(signupSessionsTable)
      .where(eq(signupSessionsTable.resumeHash, sha256(token)))
      .limit(1);
    if (
      !row ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.resumeExpiresAt ||
      row.resumeExpiresAt.getTime() <= Date.now()
    ) {
      res.status(404).json({ error: "Link expired", code: "resume_expired" });
      return;
    }
    res.json(publicView(row));
  } catch (err) {
    logger.error({ err }, "signup/resume error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/signup/username-available ─────────────────────────────────
router.get("/auth/signup/username-available", async (req, res) => {
  try {
    const verdict = await hit(`signup-username:${clientIp(req)}`, 60, 0, 60 * 1000);
    if (!verdict.allowed) {
      send429(res, verdict.retryAfterSeconds);
      return;
    }
    const username = typeof req.query.u === "string" ? req.query.u.trim().toLowerCase() : "";
    if (!USERNAME_RE.test(username)) {
      res.json({ valid: false, available: false });
      return;
    }
    const [taken] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.platformUsername, username))
      .limit(1);
    res.json({ valid: true, available: !taken });
  } catch (err) {
    logger.error({ err }, "signup/username-available error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/signup/:id ────────────────────────────────────────────────
// صفحه این را poll می‌کند تا بفهمد کاربر کارش را در بات تمام کرده.
router.get("/auth/signup/:id", async (req, res) => {
  try {
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    res.json(publicView(row));
  } catch (err) {
    logger.error({ err }, "signup/status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/auth/signup/:id ──────────────────────────────────────────────
// ذخیره‌ی پیش‌نویسِ فرم (تا مرورگرِ دیگری هم بتواند ادامه دهد). فقط ذخیره می‌کند؛
// اعتبارسنجی نهایی در `complete` است. تغییرِ ایمیل، تأییدِ ایمیل را باطل می‌کند.
router.patch("/auth/signup/:id", async (req, res) => {
  try {
    if (!(await withinSessionLimit(req, res, "patch", 300, 15 * 60 * 1000))) return;
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    const body = req.body ?? {};
    const patch: Partial<typeof signupSessionsTable.$inferInsert> = {};
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

    const firstName = str(body.firstName, NAME_MAX);
    if (firstName !== undefined) patch.firstName = firstName || null;
    const lastName = str(body.lastName, NAME_MAX);
    if (lastName !== undefined) patch.lastName = lastName || null;
    if (body.gender === "male" || body.gender === "female") patch.gender = body.gender;
    if (body.gender === null || body.gender === "") patch.gender = null;
    const username = str(body.platformUsername, 20);
    if (username !== undefined) patch.platformUsername = username.toLowerCase() || null;

    if (typeof body.email === "string") {
      const email = body.email.trim() ? normaliseEmail(body.email.trim().slice(0, EMAIL_MAX)) : "";
      if ((email || null) !== (row.email ? normaliseEmail(row.email) : null)) {
        patch.email = email || null;
        // ایمیلِ تازه = تأییدِ تازه.
        patch.emailVerifiedAt = null;
        patch.emailVerifiedFor = null;
        patch.emailCodeHash = null;
        patch.emailCodeExpiresAt = null;
        patch.emailCodeAttempts = 0;
      }
    }

    await touch(row.id, patch);
    const fresh = await loadSignup(row.id);
    res.json(fresh ? publicView(fresh) : { ok: true });
  } catch (err) {
    logger.error({ err }, "signup/patch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/:id/telegram-link ─────────────────────────────────
// لینکِ تازه (لینکِ قبلی ۱۵ دقیقه عمر دارد و یک‌بارمصرف است).
router.post("/auth/signup/:id/telegram-link", async (req, res) => {
  try {
    if (!(await withinSessionLimit(req, res, "tglink", 12, 15 * 60 * 1000))) return;
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    const deepLink = await issueTelegramLink(row.id);
    if (!deepLink) {
      res.status(503).json({ error: "Registration is not configured on this server" });
      return;
    }
    res.json({ deepLink });
  } catch (err) {
    logger.error({ err }, "signup/telegram-link error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/:id/phone/send ────────────────────────────────────
router.post("/auth/signup/:id/phone/send", smsOtpSendRateLimit(), async (req, res) => {
  try {
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    // پیامک هزینه دارد؛ فقط بعد از تأییدِ تلگرام (یک انسانِ واقعی پشتِ یک حسابِ تلگرام).
    if (!row.telegramVerifiedAt) {
      res.status(409).json({ error: "Verify Telegram first", code: "telegram_required" });
      return;
    }
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      res.status(400).json({ error: "Phone number is not valid", code: "invalid_phone" });
      return;
    }
    if (row.phoneCodeSentCount >= MAX_CODE_SENDS_PER_SESSION) {
      res.status(429).json({ error: "Resend limit reached", code: "resend_limit" });
      return;
    }
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (taken) {
      res.status(409).json({ error: "This phone is already registered", code: "phone_taken" });
      return;
    }

    const code = generateCode();
    await touch(row.id, {
      phone,
      phoneCodeHash: hashCode(code),
      phoneCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
      phoneCodeAttempts: 0,
      phoneCodeSentCount: row.phoneCodeSentCount + 1,
      // شمارهٔ تازه = تأییدِ تازه.
      phoneVerifiedAt: null,
    });

    const sent = await sendOtpSms(phone, code);
    if (!sent.success) {
      logger.warn({ registrationId: row.id, error: sent.error }, "signup: SMS delivery failed");
      res.status(502).json({ error: "Could not send the SMS", code: "sms_send_failed" });
      return;
    }
    res.json({ ok: true, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000), ...devEchoCode(code) });
  } catch (err) {
    logger.error({ err }, "signup/phone/send error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/:id/phone/verify ──────────────────────────────────
router.post("/auth/signup/:id/phone/verify", authRateLimit("signup_phone_verify"), async (req, res) => {
  try {
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    if (!row.phone || !row.phoneCodeHash) {
      res.status(400).json({ error: "No code has been sent", code: "no_code" });
      return;
    }
    if (isExpired(row.phoneCodeExpiresAt)) {
      res.status(400).json({ error: "This code has expired", code: "code_expired" });
      return;
    }

    // افزایشِ اتمیک؛ درخواست‌های موازی سقف را دور نمی‌زنند.
    const [bumped] = await db
      .update(signupSessionsTable)
      .set({ phoneCodeAttempts: sql`${signupSessionsTable.phoneCodeAttempts} + 1`, lastActivityAt: new Date() })
      .where(and(eq(signupSessionsTable.id, row.id), sql`${signupSessionsTable.phoneCodeHash} IS NOT NULL`))
      .returning({ attempts: signupSessionsTable.phoneCodeAttempts });
    const attempts = bumped?.attempts ?? MAX_CODE_ATTEMPTS + 1;
    if (attempts > MAX_CODE_ATTEMPTS) {
      await touch(row.id, { phoneCodeHash: null, phoneCodeExpiresAt: null });
      res.status(429).json({ error: "Too many attempts. Request a new code.", code: "too_many_attempts" });
      return;
    }
    if (!verifyCode(String(req.body?.code ?? ""), row.phoneCodeHash)) {
      res.status(400).json({
        error: "The code is incorrect",
        code: "invalid_code",
        attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts),
      });
      return;
    }

    const done = await db
      .update(signupSessionsTable)
      .set({ phoneVerifiedAt: new Date(), phoneCodeHash: null, phoneCodeExpiresAt: null, lastActivityAt: new Date() })
      .where(and(eq(signupSessionsTable.id, row.id), eq(signupSessionsTable.phoneCodeHash, row.phoneCodeHash)))
      .returning({ id: signupSessionsTable.id });
    if (done.length === 0) {
      res.status(400).json({ error: "This code has expired", code: "code_expired" });
      return;
    }
    const fresh = await loadSignup(row.id);
    res.json(fresh ? publicView(fresh) : { ok: true });
  } catch (err) {
    logger.error({ err }, "signup/phone/verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/:id/email/send ────────────────────────────────────
// اختیاری — «تأیید ایمیل».
router.post("/auth/signup/:id/email/send", authRateLimit("signup_email_send"), async (req, res) => {
  try {
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    // ایمیل هم هزینه/ریسکِ سوءاستفاده دارد؛ مثل پیامک فقط بعد از تأییدِ تلگرام.
    if (!row.telegramVerifiedAt) {
      res.status(409).json({ error: "Verify Telegram first", code: "telegram_required" });
      return;
    }
    const raw = typeof req.body?.email === "string" && req.body.email.trim() ? req.body.email : row.email;
    const email = raw ? normaliseEmail(String(raw).trim().slice(0, EMAIL_MAX)) : "";
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Email is not valid", code: "invalid_email" });
      return;
    }
    if (row.emailCodeSentCount >= MAX_CODE_SENDS_PER_SESSION) {
      res.status(429).json({ error: "Resend limit reached", code: "resend_limit" });
      return;
    }
    // سقفِ per-email: نباید بشود این فرم را به سرویسِ ایمیل‌فرستادن برای دیگران تبدیل کرد.
    const perEmail = await hit(`signup-email:${email}`, 3, 0, 10 * 60 * 1000);
    if (!perEmail.allowed) {
      send429(res, perEmail.retryAfterSeconds);
      return;
    }
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(emailEquals(email)).limit(1);
    if (taken) {
      res.status(409).json({ error: "This email is already registered", code: "email_taken" });
      return;
    }

    const code = generateCode();
    await touch(row.id, {
      email,
      emailCodeHash: hashCode(code),
      emailCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
      emailCodeAttempts: 0,
      emailCodeSentCount: row.emailCodeSentCount + 1,
      emailVerifiedAt: null,
      emailVerifiedFor: null,
    });
    const delivery = await sendEmailRegistrationCode(email, code, row.locale);
    if (!delivery.ok) {
      logger.error({ registrationId: row.id, error: delivery.error }, "signup: email delivery failed");
      res.status(502).json({ error: "Could not send the verification email", code: "email_delivery_failed" });
      return;
    }
    res.json({ ok: true, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000), ...devEchoCode(code) });
  } catch (err) {
    logger.error({ err }, "signup/email/send error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/:id/email/verify ──────────────────────────────────
router.post("/auth/signup/:id/email/verify", authRateLimit("signup_email_verify"), async (req, res) => {
  try {
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    if (!row.email || !row.emailCodeHash) {
      res.status(400).json({ error: "No code has been sent", code: "no_code" });
      return;
    }
    if (isExpired(row.emailCodeExpiresAt)) {
      res.status(400).json({ error: "This code has expired", code: "code_expired" });
      return;
    }
    const [bumped] = await db
      .update(signupSessionsTable)
      .set({ emailCodeAttempts: sql`${signupSessionsTable.emailCodeAttempts} + 1`, lastActivityAt: new Date() })
      .where(and(eq(signupSessionsTable.id, row.id), sql`${signupSessionsTable.emailCodeHash} IS NOT NULL`))
      .returning({ attempts: signupSessionsTable.emailCodeAttempts });
    const attempts = bumped?.attempts ?? MAX_CODE_ATTEMPTS + 1;
    if (attempts > MAX_CODE_ATTEMPTS) {
      await touch(row.id, { emailCodeHash: null, emailCodeExpiresAt: null });
      res.status(429).json({ error: "Too many attempts. Request a new code.", code: "too_many_attempts" });
      return;
    }
    if (!verifyCode(String(req.body?.code ?? ""), row.emailCodeHash)) {
      res.status(400).json({
        error: "The code is incorrect",
        code: "invalid_code",
        attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts),
      });
      return;
    }
    const done = await db
      .update(signupSessionsTable)
      .set({
        emailVerifiedAt: new Date(),
        emailVerifiedFor: normaliseEmail(row.email),
        emailCodeHash: null,
        emailCodeExpiresAt: null,
        lastActivityAt: new Date(),
      })
      .where(and(eq(signupSessionsTable.id, row.id), eq(signupSessionsTable.emailCodeHash, row.emailCodeHash)))
      .returning({ id: signupSessionsTable.id });
    if (done.length === 0) {
      res.status(400).json({ error: "This code has expired", code: "code_expired" });
      return;
    }
    const fresh = await loadSignup(row.id);
    res.json(fresh ? publicView(fresh) : { ok: true });
  } catch (err) {
    logger.error({ err }, "signup/email/verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/signup/:id/complete ──────────────────────────────────────
router.post("/auth/signup/:id/complete", authRateLimit("signup_complete"), async (req, res) => {
  try {
    const row = await loadSignup(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired", code: "signup_expired" });
      return;
    }
    const body = req.body ?? {};

    // ── عوامل اجباری: خودِ سرور باید تأییدشده ببیند، نه کلاینت ────────────────
    if (!row.telegramVerifiedAt || !row.telegramId) {
      res.status(400).json({ error: "Telegram is not verified", code: "telegram_not_verified", field: "telegram" });
      return;
    }
    if (!row.phoneVerifiedAt || !row.phone) {
      res.status(400).json({ error: "Phone number is not verified", code: "phone_not_verified", field: "phone" });
      return;
    }

    // ── فیلدها ────────────────────────────────────────────────────────────────
    const text = (v: unknown, field: string, max: number) => {
      if (typeof v !== "string" || v.trim() === "") throw new FieldError(field, `${field} is required`, `${field}_required`);
      const t = v.trim();
      if (t.length > max) throw new FieldError(field, `${field} is too long`, `${field}_too_long`);
      return t;
    };
    const firstName = text(body.firstName, "firstName", NAME_MAX);
    const lastName = text(body.lastName, "lastName", NAME_MAX);
    const fullName = `${firstName} ${lastName}`.trim();
    if (isFakeName(fullName)) throw new FieldError("firstName", "This does not look like a real name", "fake_name");

    if (body.gender !== "male" && body.gender !== "female") {
      throw new FieldError("gender", "Gender must be 'male' or 'female'", "invalid_gender");
    }
    const gender: "male" | "female" = body.gender;

    const username = typeof body.platformUsername === "string" ? body.platformUsername.trim().toLowerCase() : "";
    if (!USERNAME_RE.test(username)) {
      throw new FieldError("platformUsername", "Username must be 3-20 characters: lowercase letters, digits, underscore", "invalid_username");
    }

    const emailRaw = text(body.email, "email", EMAIL_MAX);
    const email = normaliseEmail(emailRaw);
    if (!EMAIL_RE.test(email)) throw new FieldError("email", "Email is not valid", "invalid_email");

    const password = body.password;
    if (typeof password !== "string" || password.length < PASSWORD_MIN) {
      throw new FieldError("password", `Password must be at least ${PASSWORD_MIN} characters`, "invalid_password");
    }
    if (password !== body.passwordConfirm) {
      throw new FieldError("passwordConfirm", "Passwords do not match", "password_mismatch");
    }

    // ایمیل «تأییدشده» فقط وقتی که دقیقاً همین ایمیلِ نهایی کد گرفته و تأیید شده.
    const emailVerified = Boolean(row.emailVerifiedAt) && row.emailVerifiedFor === email;
    const enableEmail2fa = Boolean(body.enableEmail2fa);
    if (enableEmail2fa && !emailVerified) {
      throw new FieldError("enableEmail2fa", "Verify your email first to enable email two-step sign-in", "email_not_verified");
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const token = generateSessionToken(userId);
    const tokenHash = hashSessionToken(token);
    const sessionExpiry = sessionExpiresAt();
    const mismatch = nameGenderMismatch(fullName, gender);

    const created = await db.transaction(async (tx) => {
      // نشست را همین‌جا «ادعا» می‌کنیم: دو ارسالِ هم‌زمان فقط یکی برنده می‌شود.
      const claimed = await tx
        .delete(signupSessionsTable)
        .where(eq(signupSessionsTable.id, row.id))
        .returning({ id: signupSessionsTable.id });
      if (claimed.length === 0) throw new FieldError("registrationId", "Registration not found or expired", "signup_expired");

      const [emailTaken] = await tx.select({ id: usersTable.id }).from(usersTable).where(emailEquals(email)).limit(1);
      if (emailTaken) throw new FieldError("email", "This email is already registered", "email_taken", 409);
      const [phoneTaken] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, row.phone!)).limit(1);
      if (phoneTaken) throw new FieldError("phone", "This phone is already registered", "phone_taken", 409);
      const [tgTaken] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.telegramId, row.telegramId!)).limit(1);
      if (tgTaken) throw new FieldError("telegram", "This Telegram account is already linked to another user", "telegram_taken", 409);
      const [nameTaken] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.platformUsername, username)).limit(1);
      if (nameTaken) throw new FieldError("platformUsername", "Username is already taken", "username_taken", 409);

      const [user] = await tx
        .insert(usersTable)
        .values({
          id: userId,
          name: fullName,
          email,
          passwordHash,
          role: "user",
          plan: "free",
          status: "active",
          gender,
          platformUsername: username,
          phone: row.phone!,
          phoneVerified: true,
          emailVerified,
          twoFactorEnabled: enableEmail2fa,
          twoFactorMethod: enableEmail2fa ? "email" : null,
          telegramId: row.telegramId!,
          telegramUsername: row.telegramUsername,
          telegramFirstName: row.telegramFirstName,
          telegramLastName: row.telegramLastName,
          telegramPhotoFileId: row.telegramPhotoFileId,
          ...(row.telegramPhotoFileId
            ? {
                telegramPhotoUrl: `/api/users/${userId}/telegram-photo`,
                avatar: `/api/users/${userId}/telegram-photo`,
              }
            : {}),
          ...(mismatch
            ? { flaggedForReview: true, flagReason: "gender_mismatch", flaggedAt: new Date() }
            : {}),
        })
        .returning();

      // همان منبعِ حقیقتِ «پروفایل کامل» که complete-profile هم استفاده می‌کند.
      const profile = checkProfile(user);
      const [finalUser] = await tx
        .update(usersTable)
        .set({
          profileComplete: profile.complete,
          ...(profile.complete ? { identityCompletedAt: new Date() } : {}),
        })
        .where(eq(usersTable.id, userId))
        .returning();

      await tx.insert(sessionsTable).values({
        token: tokenHash,
        userId,
        expiresAt: sessionExpiry,
        userAgentHash: hashUserAgent(req.headers["user-agent"]),
      });
      await tx.delete(telegramLinkTokensTable).where(eq(telegramLinkTokensTable.pendingRegistrationId, row.id));
      return finalUser;
    });

    syncSessionUpsert({ token: tokenHash, userId, expiresAt: sessionExpiry });
    syncUserUpsert({
      id: created.id, name: created.name, email: created.email, role: created.role,
      plan: created.plan, status: created.status, bio: created.bio,
      telegramUsername: created.telegramUsername, createdAt: created.createdAt,
    });

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, created.id));
    logger.info({ userId: created.id }, "Signup completed (single-page)");
    res.status(201).json({ user: toAuthUser(created, botCount), token });
  } catch (err) {
    if (err instanceof FieldError) {
      res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
      return;
    }
    if (isEmailUniqueViolation(err)) {
      res.status(409).json({ error: "This email is already registered", code: "email_taken", field: "email" });
      return;
    }
    if (isPhoneUniqueViolation(err)) {
      res.status(409).json({ error: "This phone is already registered", code: "phone_taken", field: "phone" });
      return;
    }
    logger.error({ err }, "signup/complete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
