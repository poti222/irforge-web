/**
 * routes/registration.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ثبت‌نام پنج‌مرحله‌ای با تأیید شماره از طریق تلگرام.
 *
 * ── چرا ترتیب برعکسِ چیزی است که معمولاً انتظار می‌رود ──────────────────────
 * جریانِ «کاربر شماره‌اش را تایپ کند و کد در تلگرام بیاید» با Bot API تلگرام
 * **ممکن نیست**: یک بات نمی‌تواند کاربری را با شماره پیدا کند و نمی‌تواند
 * گفت‌وگو را خودش شروع کند؛ فقط می‌تواند به `chat_id`ای پیام بدهد که قبلاً
 * دیده است. پس ترتیب برعکس شد: **اول اتصال تلگرام، بعد ارسال کد.**
 *
 * این یک دور زدنِ محدودیت نیست، بهتر هم هست: وقتی کاربر داخل بات است، خودِ
 * تلگرام شماره را با دکمه‌ی `request_contact` تحویل می‌دهد — شماره‌ای که
 * **تلگرام تأییدش کرده**، نه چیزی که کاربر تایپ کرده. بدون هزینه‌ی پیامک،
 * بدون غلط تایپی.
 *
 *   ۱ انتخاب روش      شماره (فعال) | ایمیل (غیرفعال، «به‌زودی»)
 *   ۲ هویت            نام، نام خانوادگی، ایمیل
 *   ۳ اتصال تلگرام    لینک عمیق → بات شماره را می‌گیرد و کد را می‌فرستد
 *   ۴ کد              فرم وب
 *   ۵ پایان           رمز ×۲
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  usersTable,
  sessionsTable,
  pendingRegistrationsTable,
  telegramLinkTokensTable,
} from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  normaliseEmail,
  emailEquals,
  isEmailUniqueViolation,
  isPhoneUniqueViolation,
} from "../lib/email";
import { hashPassword } from "../lib/password";
import { syncSessionUpsert, syncUserUpsert } from "../lib/sheetsSync";
import { authRateLimit } from "../middleware/rateLimit";
import { hashSessionToken, hashUserAgent } from "../lib/sessionToken";
import {
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SENDS,
  RESEND_COOLDOWN_MS,
  codeExpiry,
  generateCode,
  hashCode,
  isExpired,
  verifyCode,
} from "../lib/otp";
import { sendRegistrationCode } from "../lib/registrationBot";
import { sendEmailRegistrationCode } from "../lib/authEmails";

const router = Router();

/** رکورد ثبت‌نام ۷ روز زنده می‌ماند تا ثبت‌نام‌های رهاشده در پنل دیده شوند. */
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** توکن لینک عمیق ۱۰ دقیقه — همان مقداری که auth.ts برای purpose=link دارد. */
const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

const NAME_MAX = 80;
const EMAIL_MAX = 254;
/** همان حداقلی که /auth/register اعمال می‌کند — قاعده‌ی دومِ ضعیف‌تر نسازید. */
const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function generateToken(userId: string): string {
  return `${userId}.${crypto.randomBytes(32).toString("hex")}`;
}

/** رشته‌ی اجباری با سقف طول. */
function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`);
  return trimmed;
}

class ValidationError extends Error {}

/** آدرس بات از env — هرگز hardcode نشود. */
function botUsername(): string | null {
  const raw = process.env.TELEGRAM_BOT_USERNAME;
  return raw ? raw.replace(/^@/, "") : null;
}

function deepLink(token: string): string | null {
  const username = botUsername();
  return username ? `https://t.me/${username}?start=${token}` : null;
}

/** رکورد در جریان: نه منقضی، نه تکمیل‌شده. */
async function loadPending(registrationId: unknown) {
  if (typeof registrationId !== "string" || registrationId === "") return null;
  const [row] = await db
    .select()
    .from(pendingRegistrationsTable)
    .where(eq(pendingRegistrationsTable.id, registrationId))
    .limit(1);
  if (!row) return null;
  if (row.step === "completed") return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

async function touch(id: string, patch: Record<string, unknown> = {}) {
  await db
    .update(pendingRegistrationsTable)
    .set({ lastActivityAt: new Date(), ...patch })
    .where(eq(pendingRegistrationsTable.id, id));
}

/**
 * از داخل تراکنش پرتاب می‌شود تا تراکنش rollback شود و بیرون به ۴۰۹ ترجمه شود.
 * برگرداندن یک مقدار از callback تراکنش، آن را commit می‌کرد.
 */
class TakenError extends Error {
  constructor(public readonly field: "email" | "phone") {
    super(`${field} is already registered`);
  }
}

// ─── POST /api/auth/register/start ───────────────────────────────────────────
// گام ۲: هویت. **بدون فیلد شماره** — شماره در گام ۳ از تلگرام می‌آید و
// تأییدشده است. پرسیدنش اینجا فقط یک تناقض احتمالی بین چیزی که کاربر تایپ
// کرده و چیزی که تلگرام گزارش می‌دهد می‌سازد، و بعد باید تصمیم بگیرید کدام
// درست است. آن مسئله را نسازید.
router.post("/auth/register/start", authRateLimit("register_start"), async (req, res) => {
  try {
    const firstName = requireText(req.body?.firstName, "First name", NAME_MAX);
    const lastName = requireText(req.body?.lastName, "Last name", NAME_MAX);
    const emailRaw = requireText(req.body?.email, "Email", EMAIL_MAX);
    const email = normaliseEmail(emailRaw);
    if (!EMAIL_RE.test(email)) throw new ValidationError("Email is not valid");

    const locale = typeof req.body?.locale === "string" ? req.body.locale.slice(0, 8) : null;

    // ⚠️ عمداً یکتایی ایمیل اینجا بررسی **نمی‌شود** و هرگز گفته نمی‌شود که
    // ایمیلی از قبل ثبت شده. گفتن این به یک تماس‌گیرنده‌ی ناشناس، فرم ثبت‌نام
    // را به یک اوراکل شمارش حساب تبدیل می‌کند: یک فهرست ایمیل بدهید و مشتریان
    // شما را نام می‌برد. یکتایی در register/complete اعمال می‌شود، بعد از
    // اینکه کاربر کنترل یک حساب تلگرام و یک شماره را ثابت کرده است.

    const now = new Date();

    // بازگشت از گام تلگرام به گام هویت، دوباره همین اندپوینت را صدا می‌زند.
    // اگر کلاینت `registrationId` زنده‌ای بفرستد که خودش دارد، **همان رکورد
    // به‌روزرسانی می‌شود** و رکورد در انتظار تازه‌ای ساخته نمی‌شود؛ وگرنه هر
    // رفت‌وبرگشت یک ردیف یتیم و یک توکن لینک تازه به جا می‌گذاشت.
    //
    // خودِ `registrationId` یک UUID غیرقابل‌حدس است و همان چیزی است که
    // `/status` و `PATCH /:id` از قبل به‌عنوان سند مالکیت می‌پذیرند؛ اینجا هم
    // همان قرارداد است، نه یک استثنای جدید.
    const existing = await loadPending(req.body?.registrationId);
    // فقط تا وقتی هنوز چیزی تأیید نشده. بعد از تأیید کد، شماره و تلگرام قطعی‌اند
    // و هویت نباید از زیرشان عوض شود.
    const reusable = existing && (existing.step === "identity" || existing.step === "telegram_pending");

    if (reusable) {
      await touch(existing.id, { firstName, lastName, email, locale });

      // توکن لینک قبلی هنوز معتبر است؛ اگر منقضی شده یک تازه صادر می‌کنیم تا
      // QR و دیپ‌لینک گام بعد مرده نباشند.
      const [liveToken] = await db
        .select()
        .from(telegramLinkTokensTable)
        .where(eq(telegramLinkTokensTable.pendingRegistrationId, existing.id))
        .limit(1);

      let token = liveToken?.token ?? null;
      if (!token || liveToken.expiresAt.getTime() <= now.getTime()) {
        if (liveToken) {
          await db
            .delete(telegramLinkTokensTable)
            .where(eq(telegramLinkTokensTable.pendingRegistrationId, existing.id));
        }
        token = crypto.randomBytes(16).toString("hex");
        await db.insert(telegramLinkTokensTable).values({
          token,
          userId: null,
          purpose: "register",
          pendingRegistrationId: existing.id,
          expiresAt: new Date(now.getTime() + LINK_TOKEN_TTL_MS),
        });
      }

      const link = deepLink(token);
      if (!link) {
        logger.error("TELEGRAM_BOT_USERNAME is not configured; registration deep link unavailable");
        res.status(503).json({ error: "Registration is not configured on this server" });
        return;
      }

      logger.info({ registrationId: existing.id }, "Registration identity updated");
      res.status(200).json({ registrationId: existing.id, deepLink: link, step: existing.step });
      return;
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(16).toString("hex");

    await db.insert(pendingRegistrationsTable).values({
      id,
      firstName,
      lastName,
      email,
      step: "identity",
      locale,
      // فقط برای بررسی سوءاستفاده — هرگز در هیچ پاسخی برنمی‌گردد.
      sourceIp: (req.ip ?? "").slice(0, 64) || null,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 512) || null,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    });

    await db.insert(telegramLinkTokensTable).values({
      token,
      userId: null,
      purpose: "register",
      pendingRegistrationId: id,
      expiresAt: new Date(now.getTime() + LINK_TOKEN_TTL_MS),
    });

    const link = deepLink(token);
    if (!link) {
      logger.error("TELEGRAM_BOT_USERNAME is not configured; registration deep link unavailable");
      res.status(503).json({ error: "Registration is not configured on this server" });
      return;
    }

    logger.info({ registrationId: id }, "Registration started");
    res.status(201).json({ registrationId: id, deepLink: link, step: "identity" });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "register/start error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/register/email/start ─────────────────────────────────────
// IRFORGE_PROMPT_V3 Phase 14 — the email counterpart of /register/start.
// No Telegram deep-link step exists for this path: there's nothing for it
// to verify (unlike a phone number, an email address isn't something
// Telegram can hand us pre-verified), so identity collection goes straight
// to sending a code, landing this row at "code_sent" in one call instead
// of two-step ("identity" then "telegram_pending" then "code_sent").
router.post("/auth/register/email/start", authRateLimit("register_start"), async (req, res) => {
  try {
    const firstName = requireText(req.body?.firstName, "First name", NAME_MAX);
    const lastName = requireText(req.body?.lastName, "Last name", NAME_MAX);
    const emailRaw = requireText(req.body?.email, "Email", EMAIL_MAX);
    const email = normaliseEmail(emailRaw);
    if (!EMAIL_RE.test(email)) throw new ValidationError("Email is not valid");
    const locale = typeof req.body?.locale === "string" ? req.body.locale.slice(0, 8) : null;

    // عمداً همان قاعده‌ی /register/start: یکتایی ایمیل اینجا بررسی نمی‌شود
    // و هرگز گفته نمی‌شود که ایمیلی از قبل ثبت شده — وگرنه این فرم به یک
    // اوراکل شمارش حساب تبدیل می‌شود. یکتایی واقعی در /complete اعمال
    // می‌شود، داخل همان تراکنش که ایندکس یکتای دیتابیس آن را تضمین می‌کند.
    const now = new Date();
    const id = crypto.randomUUID();
    const code = generateCode();

    await db.insert(pendingRegistrationsTable).values({
      id,
      registrationMethod: "email",
      firstName,
      lastName,
      email,
      codeHash: hashCode(code),
      codeExpiresAt: codeExpiry(),
      codeSentCount: 1,
      step: "code_sent",
      locale,
      sourceIp: (req.ip ?? "").slice(0, 64) || null,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 512) || null,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    });

    await sendEmailRegistrationCode(email, code, locale);

    logger.info({ registrationId: id }, "Email registration started");
    res.status(201).json({ registrationId: id, step: "code_sent" });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "register/email/start error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/register/:id/status ───────────────────────────────────────
// صفحه‌ی ثبت‌نام این را poll می‌کند تا بفهمد کاربر داخل بات کارش را تمام کرده.
// هرگز `codeHash`، `sourceIp` یا `userAgent` برنمی‌گرداند.
router.get("/auth/register/:id/status", async (req, res) => {
  try {
    const row = await loadPending(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired" });
      return;
    }
    res.json({
      registrationId: row.id,
      step: row.step,
      phone: row.phone,
      telegramUsername: row.telegramUsername,
      telegramFirstName: row.telegramFirstName,
      telegramLastName: row.telegramLastName,
      email: row.email,
      codeExpiresAt: row.codeExpiresAt ? row.codeExpiresAt.toISOString() : null,
      canResend: (row.codeSentCount ?? 0) < MAX_CODE_SENDS,
    });
  } catch (err) {
    logger.error({ err }, "register/status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/register/verify-code ─────────────────────────────────────
router.post("/auth/register/verify-code", authRateLimit("register_verify"), async (req, res) => {
  try {
    const row = await loadPending(req.body?.registrationId);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired" });
      return;
    }
    if (row.step !== "code_sent" && row.step !== "code_verified") {
      res.status(400).json({ error: "No code has been sent yet", code: "no_code" });
      return;
    }
    if (isExpired(row.codeExpiresAt)) {
      res.status(400).json({ error: "This code has expired", code: "code_expired" });
      return;
    }

    // شمارنده **قبل** از مقایسه بالا می‌رود، وگرنه یک درخواستِ نیمه‌کاره
    // می‌توانست تلاش رایگان بدهد.
    const attempts = (row.codeAttempts ?? 0) + 1;
    await touch(row.id, { codeAttempts: attempts });

    if (attempts > MAX_CODE_ATTEMPTS) {
      // شمارنده‌ای که هیچ‌وقت پایان ندارد محدودیت نیست: رکورد را می‌کُشیم.
      await db
        .update(pendingRegistrationsTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(pendingRegistrationsTable.id, row.id));
      logger.warn({ registrationId: row.id }, "Registration killed after too many code attempts");
      res.status(429).json({ error: "Too many attempts. Start again.", code: "too_many_attempts" });
      return;
    }

    if (!verifyCode(String(req.body?.code ?? ""), row.codeHash)) {
      res.status(400).json({
        error: "The code is incorrect",
        code: "invalid_code",
        attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts),
      });
      return;
    }

    await touch(row.id, { verifiedAt: new Date(), step: "code_verified", codeHash: null });
    logger.info({ registrationId: row.id }, "Registration code verified");

    res.json({
      ok: true,
      phone: row.phone,
      telegramUsername: row.telegramUsername,
      telegramFirstName: row.telegramFirstName,
      telegramLastName: row.telegramLastName,
      email: row.email,
    });
  } catch (err) {
    logger.error({ err }, "register/verify-code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/register/resend ──────────────────────────────────────────
router.post("/auth/register/resend", authRateLimit("register_resend"), async (req, res) => {
  try {
    const row = await loadPending(req.body?.registrationId);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired" });
      return;
    }
    const isEmailMethod = row.registrationMethod === "email";
    if (!isEmailMethod && !row.telegramChatId) {
      res.status(400).json({ error: "Telegram is not connected yet", code: "no_telegram" });
      return;
    }
    if ((row.codeSentCount ?? 0) >= MAX_CODE_SENDS) {
      res.status(429).json({ error: "Resend limit reached", code: "resend_limit" });
      return;
    }
    const since = Date.now() - row.lastActivityAt.getTime();
    if (row.codeSentCount > 0 && since < RESEND_COOLDOWN_MS) {
      res.status(429).json({
        error: "Please wait before requesting another code",
        code: "resend_cooldown",
        retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000),
      });
      return;
    }

    const code = generateCode();
    await touch(row.id, {
      codeHash: hashCode(code),
      codeExpiresAt: codeExpiry(),
      codeSentCount: (row.codeSentCount ?? 0) + 1,
      codeAttempts: 0,
      step: "code_sent",
    });
    if (isEmailMethod) {
      await sendEmailRegistrationCode(normaliseEmail(row.email ?? ""), code, row.locale);
    } else {
      await sendRegistrationCode(row.telegramChatId, code, row.locale, row.phone ?? undefined);
    }
    logger.info({ registrationId: row.id }, "Registration code resent");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "register/resend error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/auth/register/:id ────────────────────────────────────────────
// فقط ایمیل، و فقط در گام code_verified. شماره و فیلدهای تلگرام تأیید شده‌اند
// و نباید بعدش قابل ویرایش شوند، وگرنه تأیید بی‌معنی است.
router.patch("/auth/register/:id", async (req, res) => {
  try {
    const row = await loadPending(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired" });
      return;
    }
    if (row.step !== "code_verified") {
      res.status(400).json({ error: "This registration cannot be edited now" });
      return;
    }
    const emailRaw = requireText(req.body?.email, "Email", EMAIL_MAX);
    const email = normaliseEmail(emailRaw);
    if (!EMAIL_RE.test(email)) throw new ValidationError("Email is not valid");

    await touch(row.id, { email });
    res.json({ ok: true, email });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "register PATCH error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/register/complete ────────────────────────────────────────
// بادی فقط `{ registrationId, password, passwordConfirm }` — ایمیل از خودِ
// رکورد می‌آید، نه از کلاینت.
router.post("/auth/register/complete", async (req, res) => {
  try {
    const row = await loadPending(req.body?.registrationId);
    if (!row) {
      res.status(404).json({ error: "Registration not found or expired" });
      return;
    }
    if (!row.verifiedAt || row.step !== "code_verified") {
      res.status(400).json({ error: "Verification is not complete yet", code: "not_verified" });
      return;
    }
    const isEmailMethod = row.registrationMethod === "email";
    // IRFORGE_PROMPT_V3 Phase 14 — an email registration never goes through
    // the Telegram deep-link steps at all, so it has neither by design;
    // that's only a problem for the phone path.
    if (!isEmailMethod && (!row.phone || !row.telegramId)) {
      res.status(400).json({ error: "Telegram is not connected", code: "no_telegram" });
      return;
    }

    const password = req.body?.password;
    const passwordConfirm = req.body?.passwordConfirm;
    if (typeof password !== "string" || password.length < PASSWORD_MIN) {
      res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN} characters` });
      return;
    }
    if (password !== passwordConfirm) {
      res.status(400).json({ error: "Passwords do not match", code: "password_mismatch" });
      return;
    }

    const email = normaliseEmail(row.email);

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const token = generateToken(userId);
    const tokenHash = hashSessionToken(token);
    const sessionExpiry = sessionExpiresAt();
    const fullName = `${row.firstName} ${row.lastName}`.trim();

    // یک تراکنش: کاربر ساخته می‌شود، رکورد در انتظار حذف می‌شود، نشست صادر
    // می‌شود. اگر هرکدام شکست بخورد هیچ‌کدام اعمال نمی‌شوند.
    //
    // یکتایی ایمیل و شماره **داخل** همین تراکنش بررسی می‌شود، نه قبلش. قبلاً
    // `select` بیرون از تراکنش بود و بین آن و `insert` یک پنجره باز می‌ماند:
    // دو ثبت‌نام هم‌زمان هر دو «گرفته نشده» می‌خواندند و هر دو جلو می‌رفتند.
    //
    // اما مرجع واقعی، این `select` نیست — ایندکس یکتای `users_email_lower_idx`
    // است. این بررسی فقط برای پیام خطای درست است؛ تضمین از دیتابیس می‌آید و
    // نقض قید در `catch` به همان ۴۰۹ ترجمه می‌شود.
    const user = await db.transaction(async (tx) => {
      const [emailTaken] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(emailEquals(email))
        .limit(1);
      if (emailTaken) throw new TakenError("email");

      // یک ثبت‌نام با ایمیل اصلاً شماره‌ای ندارد — چیزی برای برخورد نیست،
      // و `eq(usersTable.phone, null)` هم در SQL هرگز چیزی مطابقت نمی‌دهد،
      // فقط یک کوئری بی‌فایده است.
      if (row.phone) {
        const [phoneTaken] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.phone, row.phone))
          .limit(1);
        if (phoneTaken) throw new TakenError("phone");
      }

      const [created] = await tx
        .insert(usersTable)
        .values({
          id: userId,
          name: fullName,
          email,
          passwordHash,
          role: "user",
          plan: "free",
          status: "active",
          phone: row.phone,
          phoneVerified: Boolean(row.phone) && !isEmailMethod,
          emailVerified: isEmailMethod,
          telegramId: row.telegramId,
          telegramUsername: row.telegramUsername,
          telegramFirstName: row.telegramFirstName,
          telegramLastName: row.telegramLastName,
          telegramPhotoFileId: row.telegramPhotoFileId,
          // ⚠️ فقط `file_id` کافی نیست. رابط کاربری از `telegramPhotoUrl` /
          // `avatar` می‌خواند، نه از file_id — و مسیر ثبت‌نام با شماره این دو
          // را ست نمی‌کرد، برای همین عکس پروفایل تلگرام هیچ‌وقت لود نمی‌شد
          // (کاربر یک آواتار خالی می‌دید). این همان URL پروکسی است که مسیر
          // «اتصال با ربات» هم می‌سازد (`routes/telegramWebhook.ts`).
          ...(row.telegramPhotoFileId
            ? {
                telegramPhotoUrl: `/api/users/${userId}/telegram-photo`,
                avatar: `/api/users/${userId}/telegram-photo`,
              }
            : {}),
        })
        .returning();

      await tx.insert(sessionsTable).values({
        token: tokenHash, userId, expiresAt: sessionExpiry,
        userAgentHash: hashUserAgent(req.headers["user-agent"]),
      });
      await tx
        .delete(pendingRegistrationsTable)
        .where(eq(pendingRegistrationsTable.id, row.id));
      await tx
        .delete(telegramLinkTokensTable)
        .where(eq(telegramLinkTokensTable.pendingRegistrationId, row.id));
      return created;
    });

    syncSessionUpsert({ token: tokenHash, userId, expiresAt: sessionExpiry });
    syncUserUpsert({
      id: user.id, name: user.name, email: user.email, role: user.role,
      plan: user.plan, status: user.status, bio: user.bio,
      telegramUsername: user.telegramUsername, createdAt: user.createdAt,
    });

    logger.info({ userId: user.id }, "Registration completed");
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        plan: user.plan,
        status: user.status,
        bio: user.bio,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
        emailVerified: user.emailVerified,
        telegramId: user.telegramId,
        telegramUsername: user.telegramUsername,
        telegramFirstName: user.telegramFirstName,
        telegramLastName: user.telegramLastName,
        telegramPhotoUrl: user.telegramPhotoUrl,
        profileComplete: user.profileComplete,
        botCount: 0,
        createdAt: user.createdAt.toISOString(),
      },
      token,
    });
  } catch (err) {
    // رکورد در انتظار عمداً زنده می‌ماند تا کاربر بتواند ایمیلش را اصلاح کند و
    // دوباره تلاش کند، نه اینکه کل ثبت‌نام را از اول شروع کند.
    if (err instanceof TakenError || isEmailUniqueViolation(err) || isPhoneUniqueViolation(err)) {
      const field =
        err instanceof TakenError
          ? err.field
          : isEmailUniqueViolation(err)
            ? "email"
            : "phone";
      res.status(409).json(
        field === "email"
          ? { error: "This email is already registered", code: "email_taken" }
          : { error: "This phone is already registered", code: "phone_taken" },
      );
      return;
    }
    logger.error({ err }, "register/complete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
