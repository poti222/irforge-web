import { Router } from "express";
import { google } from "googleapis";
import {
  db,
  usersTable,
  sessionsTable,
  botsTable,
  telegramLinkTokensTable,
  loginChallengesTable,
  telegramLoginRequestsTable,
  smsOtpCodesTable,
  SMS_OTP_PURPOSES,
  type SmsOtpPurpose,
} from "@workspace/db";
import { eq, and, gt, count, isNull, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { normaliseEmail, emailEquals, isEmailUniqueViolation } from "../lib/email";
import { syncUserUpsert, syncSessionUpsert, syncSessionDelete } from "../lib/sheetsSync";
import { verifyTelegramAuth, verifyTelegramInitData } from "../lib/telegramAuth";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendResetCodeSms, sendResetCodeTelegram, sendTelegramUnlinked } from "../lib/registrationBot";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  codeExpiry,
  devEchoCode,
  generateCode,
  hashCode,
  isExpired,
  normalizePhone,
  verifyCode as verifyOtp,
} from "../lib/otp";
import { sendLoginCode } from "../lib/registrationBot";
import { EMAIL_AUTH_CLOSED, EMAIL_AUTH_CLOSED_MESSAGE_FA, EMAIL_AUTH_CLOSED_CODE } from "../lib/authPolicy";
import { sendEmailLoginCode } from "../lib/authEmails";
import { sendOtpSms } from "../lib/smsir";
import { smsOtpSendRateLimit, checkSmsOtpSendRateLimit, sendSmsOtpRateLimited } from "../lib/smsOtpRateLimit";
import { authRateLimit, hit, clientIp, phoneKey, emailKey, reset, send429, PHONE_FAIL_LIMIT, PHONE_BLOCK_MS } from "../middleware/rateLimit";
import { hashSessionToken, hashUserAgent } from "../lib/sessionToken";
import { checkProfile } from "../lib/profile";

/** برای نمایش در پاسخ — اشاره‌ی ماسک‌شده به ایمیل، نه خودِ آن. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/**
 * کد بازیابی رمز حالا از `lib/otp.ts` می‌آید — همان تولیدکننده، همان هش و
 * همان مقایسه‌ی timing-safe که ثبت‌نام و ورود استفاده می‌کنند. قبلاً اینجا یک
 * پیاده‌سازی دوم (randomBytes + sha256 با نمک متفاوت و مقایسه‌ی `===`) وجود
 * داشت؛ دو پیاده‌سازیِ کد یعنی دو جا برای اشتباه‌کردن.
 */

const router = Router();

/**
 * BUG FIX: /auth/register و /auth/login قبلاً یک شکل ناقص از کاربر برمی‌گردوندن
 * (فقط telegramUsername، بدون telegramId/telegramFirstName/telegramLastName/
 * telegramPhotoUrl) در حالی که /auth/me شکل کامل رو برمی‌گردوند. چون
 * AuthContext.tsx نتیجه‌ی login/register رو مستقیم توی همون کش react-query
 * می‌ریزه که useGetMe ازش می‌خونه، بلافاصله بعد از هر ورود جدید (مثلاً بعد از
 * logout) فیلد telegramId روی این آبجکت ناقص `undefined` می‌شد — و چون
 * profile.tsx وضعیت «متصل به بات» رو از روی telegramId می‌سنجه
 * (isTelegramLinked = Boolean(u.telegramId))، کاربر با این‌که یوزرنیمش توی
 * دیتابیس ذخیره مونده بود، دوباره «قطع» نشون داده می‌شد تا یک‌بار refetch
 * واقعی /me اتفاق بیفته. این تابع مشترک، شکل خروجی هر سه route رو یکی می‌کنه
 * تا این مشکل دیگه هیچ‌جا تکرار نشه.
 */
export function toAuthUser(user: typeof usersTable.$inferSelect, botCount: number) {
  const profile = checkProfile(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    plan: user.plan,
    bio: user.bio ?? null,
    telegramId: user.telegramId ?? null,
    telegramUsername: user.telegramUsername ?? null,
    telegramFirstName: user.telegramFirstName ?? null,
    telegramLastName: user.telegramLastName ?? null,
    telegramPhotoUrl: user.telegramPhotoUrl ?? null,
    hasUsedTrial: user.hasUsedTrial ?? false,
    hasSeenTrialOffer: user.hasSeenTrialOffer ?? false,
    phone: user.phone ?? null,
    phoneVerified: user.phoneVerified ?? false,
    emailVerified: user.emailVerified ?? false,
    platformUsername: user.platformUsername ?? null,
    gender: (user.gender as "male" | "female" | null) ?? null,
    oauthProvider: user.oauthProvider ?? null,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    twoFactorMethod: user.twoFactorMethod ?? null,
    profileComplete: profile.complete,
    missingProfileFields: profile.missing,
    onlyUsernameMissing: profile.onlyUsernameMissing,
    botCount,
    createdAt: user.createdAt.toISOString(),
  };
}

function generateToken(userId: string): string {
  return Buffer.from(
    `${userId}:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`
  ).toString("base64");
}

/** Below this, a session is worth another write; above it, skip the extra
 * UPDATE on every single authenticated request. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export async function getUserIdFromToken(token: string): Promise<string | null> {
  const now = new Date();
  const tokenHash = hashSessionToken(token);
  const rows = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.token, tokenHash), gt(sessionsTable.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    // Fire-and-forget: activity tracking must never add latency (or a
    // failure mode) to the auth check itself.
    db.update(sessionsTable).set({ lastUsedAt: now })
      .where(eq(sessionsTable.token, tokenHash))
      .catch((err) => logger.warn({ err }, "session lastUsedAt update failed"));
  }

  return row.userId;
}

export function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  /**
   * پیش‌فرض-رد برای مهمان‌ها.
   *
   * توکن مهمان نوع دیگری است (`guest_…`) و **هرگز** از این گارد رد نمی‌شود.
   * روت‌هایی که واقعاً باید برای مهمان باز باشند، صریحاً `allowGuest` را
   * می‌گیرند. اگر مهمان از همین‌جا رد می‌شد، یک بررسی جاافتاده در یک روت
   * پایین‌دستی کافی بود تا کل API ناشناس شود.
   */
  if (token.startsWith("guest_")) {
    res.status(401).json({ error: "Unauthorized", code: "guest_not_allowed" });
    return;
  }
  getUserIdFromToken(token)
    .then((userId) => {
      if (!userId) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      req.userId = userId;
      next();
    })
    .catch((err) => {
      logger.error({ err }, "requireAuth DB error");
      res.status(500).json({ error: "Internal server error" });
    });
}

export function requireAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    // super_admin هم به همه چیزی که admin دسترسی داره دسترسی داره
    if (!user[0] || (user[0].role !== "admin" && user[0].role !== "super_admin")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

/**
 * فقط super_admin.
 *
 * `requireAdmin` اینجا **کافی نیست**: صفحه‌های پشت این گارد می‌توانند نقش‌ها را
 * عوض کنند، و ادمینی که بتواند به خودش super_admin بدهد، عملاً super_admin است.
 */
export function requireSuperAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    if (!user || user.role !== "super_admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

function sessionExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

// POST /api/auth/register
router.post("/auth/register", async (_req, res) => {
  // ⛔ مسیر قدیمیِ ثبت‌نام با ایمیل بسته شد: بدون rate limit، بدون تأیید ایمیل،
  // بدون حداقل طول رمز، و با صدور فوری نشست — یعنی هرکسی می‌توانست ایمیلِ
  // دیگران را «اشغال» کند و بعد از ورود قربانی با گوگل/ایمیل، وارد همان حساب
  // شود. ثبت‌نام فقط از `/auth/signup/*` (صفحه‌ی یک‌تکه) انجام می‌شود.
  res.status(410).json({
    error: "This registration endpoint was removed. Please use the sign-up page.",
    code: "endpoint_removed",
  });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// گام یک از دو. **هیچ نشستی اینجا ساخته نمی‌شود** حتی با اطلاعات کاملاً درست:
// یک چالش ساخته می‌شود و کد به تلگرام کاربر می‌رود. «مرا به خاطر بسپار» وجود
// ندارد؛ عامل دوم یا همیشه هست یا اصلاً نیست.
router.post("/auth/login", authRateLimit("login"), async (req, res) => {
  const startedAt = Date.now();

  /**
   * پاسخ یکسان برای «شماره وجود ندارد» و «رمز غلط».
   *
   * علاوه بر متن یکسان، زمان پاسخ هم یکسان‌سازی می‌شود: اگر مسیر «کاربر پیدا
   * نشد» سریع‌تر برگردد، همان اختلاف زمان می‌گوید کدام شماره‌ها حساب دارند و
   * اندپوینت به ابزار کشف شماره تبدیل می‌شود.
   */
  const genericFail = async () => {
    const elapsed = Date.now() - startedAt;
    const floor = 400;
    if (elapsed < floor) await new Promise((r) => setTimeout(r, floor - elapsed));
    res.status(401).json({ error: "Invalid credentials", code: "invalid_credentials" });
  };

  try {
    // IRFORGE_PROMPT_V3 Phase 14 — شماره یا ایمیل، هرکدام که فرستاده شده.
    // اگر هر دو بیایند شماره برتری دارد؛ چیزی که واقعاً تعیین می‌کند کد از
    // کدام کانال می‌رود ویژگی‌های خودِ حساب است (پایین‌تر)، نه این‌که کاربر
    // کدام شناسه را تایپ کرده.
    const phone = normalizePhone(req.body?.phone);
    const email = !phone && req.body?.email ? normaliseEmail(req.body.email) : null;
    const password = req.body?.password;
    if ((!phone && !email) || typeof password !== "string" || password === "") {
      await genericFail();
      return;
    }
    if (EMAIL_AUTH_CLOSED && email) {
      res.status(403).json({ error: EMAIL_AUTH_CLOSED_MESSAGE_FA, code: EMAIL_AUTH_CLOSED_CODE });
      return;
    }

    // بلاک per-identifier بعد از ۵ ورود ناموفق در ۱۵ دقیقه.
    const rateKey = phone ? phoneKey(phone) : emailKey(email as string);
    const blocked = await hit(rateKey, PHONE_FAIL_LIMIT, PHONE_BLOCK_MS);
    if (!blocked.allowed) {
      res.status(429).json({
        error: "Too many attempts. Please try again later.",
        code: "rate_limited",
        retryAfterSeconds: blocked.retryAfterSeconds,
      });
      return;
    }

    const [user] = phone
      ? await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1)
      : await db.select().from(usersTable).where(emailEquals(email)).limit(1);
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      await genericFail();
      return;
    }
    // بن‌شده اصلاً وارد نمی‌شود. تعلیق‌شده برعکس — باید بتواند وارد شود و
    // همه‌چیز را ببیند، فقط هیچ عملی نمی‌تواند انجام دهد (اجرای این محدودیت
    // در تک‌تک مسیرهای نوشتنی + قفل‌شدنِ دکمه‌ها در فرانت است، نه اینجا).
    if (user.status === "banned") {
      res.status(403).json({ error: "Account banned", code: "banned" });
      return;
    }

    await reset(rateKey);

    // احراز هویت دومرحله‌ای اختیاری است — خودِ کاربر از داخل تنظیمات
    // روشن/خاموشش می‌کند (identityverificationspec.md، «Decisions locked in
    // with Ali»). پیش از این، این مرحله برای همه‌ی حساب‌ها همیشه اجباری بود
    // (چالش تلگرام/ایمیل که هیچ‌وقت خاموش نمی‌شد) — همان چیزی که خاموش بودن
    // ۲FA را بی‌معنی می‌کرد. وقتی خاموش است، رمز عبور به‌تنهایی کافی است.
    if (!user.twoFactorEnabled) {
      logger.info({ userId: user.id }, "Login completed (2FA disabled)");
      res.json(await issueSession(user, req));
      return;
    }

    const method = user.twoFactorMethod ?? "telegram";
    const code = generateCode();
    const challengeId = crypto.randomUUID();
    await db.insert(loginChallengesTable).values({
      id: challengeId,
      userId: user.id,
      codeHash: hashCode(code),
      codeExpiresAt: codeExpiry(),
    });

    let destinationHint: string;
    if (method === "email") {
      const delivery = await sendEmailLoginCode(user.email, code, null);
      if (!delivery.ok) {
        logger.error({ userId: user.id, error: delivery.error }, "login: 2FA email delivery failed");
        res.status(502).json({ error: "Could not send the sign-in email", code: "email_delivery_failed" });
        return;
      }
      destinationHint = maskEmail(user.email);
    } else if (method === "sms") {
      if (!user.phone) {
        logger.error({ userId: user.id }, "login: 2FA method is sms but the account has no phone");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      const sendResult = await sendOtpSms(user.phone, code);
      if (!sendResult.success) {
        logger.error({ userId: user.id, error: sendResult.error }, "login: 2FA SMS delivery failed");
        res.status(502).json({ error: "Could not send the sign-in SMS", code: "sms_send_failed" });
        return;
      }
      destinationHint = user.phone.replace(/^(\+\d{4}).*(\d{2})$/, "$1***$2");
    } else {
      if (!user.telegramId) {
        logger.error({ userId: user.id }, "login: 2FA method is telegram but the account has no telegramId");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      await sendLoginCode(user.telegramId, code, null, user.phone ?? undefined);
      destinationHint = user.telegramUsername ? `@${user.telegramUsername.slice(0, 3)}***` : "Telegram";
    }

    logger.info({ userId: user.id, method }, "Login challenge issued (2FA)");
    res.json({
      challengeId,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      destinationHint,
    });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/login/verify ─────────────────────────────────────────────
// گام دو: کد را بررسی می‌کند و نشست را صادر می‌کند.
router.post("/auth/login/verify", authRateLimit("login_verify"), async (req, res) => {
  try {
    const challengeId = req.body?.challengeId;
    if (typeof challengeId !== "string" || challengeId === "") {
      res.status(400).json({ error: "Invalid challenge", code: "invalid_challenge" });
      return;
    }

    const [challenge] = await db
      .select()
      .from(loginChallengesTable)
      .where(eq(loginChallengesTable.id, challengeId))
      .limit(1);

    // مصرف‌شده، منقضی یا ناموجود — همه یک پیام می‌گیرند.
    if (!challenge || challenge.consumedAt || isExpired(challenge.codeExpiresAt)) {
      res.status(400).json({ error: "This code has expired", code: "challenge_expired" });
      return;
    }

    // افزایشِ اتمیک: خواندن→نوشتن جدا باعث می‌شد درخواست‌های موازی همه
    // `attempts` یکسان بخوانند و سقفِ ۵ تلاش با ارسال هم‌زمان دور زده شود.
    const [bumped] = await db
      .update(loginChallengesTable)
      .set({ attempts: sql`${loginChallengesTable.attempts} + 1` })
      .where(and(eq(loginChallengesTable.id, challengeId), isNull(loginChallengesTable.consumedAt)))
      .returning({ attempts: loginChallengesTable.attempts });
    if (!bumped) {
      res.status(400).json({ error: "This code has expired", code: "challenge_expired" });
      return;
    }
    const attempts = bumped.attempts;

    if (attempts > MAX_CODE_ATTEMPTS) {
      await db
        .update(loginChallengesTable)
        .set({ consumedAt: new Date() })
        .where(eq(loginChallengesTable.id, challengeId));
      logger.warn({ userId: challenge.userId }, "Login challenge killed after too many attempts");
      res.status(429).json({ error: "Too many attempts", code: "too_many_attempts" });
      return;
    }

    if (!verifyOtp(String(req.body?.code ?? ""), challenge.codeHash)) {
      res.status(400).json({
        error: "The code is incorrect",
        code: "invalid_code",
        attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts),
      });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, challenge.userId))
      .limit(1);
    if (!user) {
      res.status(400).json({ error: "This code has expired", code: "challenge_expired" });
      return;
    }
    // بین «ورودِ رمز» و «واردکردنِ کد» ممکن است ادمین حساب را بن کرده باشد.
    if (user.status === "banned") {
      res.status(403).json({ error: "Account banned", code: "banned" });
      return;
    }

    // مصرفِ اتمیک: دو تأییدِ هم‌زمان با یک کدِ درست فقط یک نشست می‌دهند.
    const consumedRows = await db
      .update(loginChallengesTable)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginChallengesTable.id, challengeId), isNull(loginChallengesTable.consumedAt)))
      .returning({ id: loginChallengesTable.id });
    if (consumedRows.length === 0) {
      res.status(400).json({ error: "This code has expired", code: "challenge_expired" });
      return;
    }

    logger.info({ userId: user.id }, "Login completed");
    res.json(await issueSession(user, req));
  } catch (err) {
    logger.error({ err }, "Login verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/logout
router.post("/auth/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const tokenHash = hashSessionToken(authHeader.slice(7));
    await db.delete(sessionsTable).where(eq(sessionsTable.token, tokenHash)).catch(() => {});
    syncSessionDelete(tokenHash);
  }
  res.json({ success: true });
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, async (req: any, res) => {
  try {
    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    const user = users[0];
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, user.id));
    res.json(toAuthUser(user, botCount));
  } catch (err) {
    logger.error({ err }, "Get me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/telegram
// FIX [1.2 backend]: همیشه telegramPhotoUrl رو آپدیت می‌کنه (حتی اگه avatar قبلاً ست شده بود)
router.post("/auth/telegram", requireAuth, async (req: any, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      res.status(503).json({ error: "Telegram login is not configured on this server" });
      return;
    }

    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.body ?? {};
    if (!id || !first_name || !auth_date || !hash) {
      res.status(400).json({ error: "Missing required Telegram auth fields" });
      return;
    }

    const result = verifyTelegramAuth(
      { id, first_name, last_name, username, photo_url, auth_date, hash },
      botToken
    );
    if (!result.ok) {
      res.status(401).json({ error: result.reason });
      return;
    }

    const telegramId = String(id);
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, telegramId))
      .limit(1);
    if (existing[0] && existing[0].id !== req.userId) {
      res.status(409).json({ error: "This Telegram account is already linked to another user" });
      return;
    }

    const updateData: Record<string, any> = {
      telegramId,
      telegramUsername: username ?? null,
      telegramFirstName: first_name,
      telegramLastName: last_name ?? null,
      // FIX [1.2 backend]: همیشه آپدیت می‌کنه، حتی اگه مقدار قبلی داشت
      telegramPhotoUrl: photo_url ?? null,
    };

    // FIX [1.2 backend]: اگه عکس تلگرام داره، avatar اصلی رو هم آپدیت کن
    // (قبلاً فقط وقتی avatar خالی بود آپدیت می‌کرد — الان همیشه از تلگرام می‌خونه)
    if (photo_url) {
      updateData.avatar = photo_url;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, req.userId))
      .returning();

    syncUserUpsert({
      id: updated.id, name: updated.name, email: updated.email, role: updated.role,
      plan: updated.plan, status: updated.status, bio: updated.bio,
      telegramUsername: updated.telegramUsername,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    });

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, updated.id));
    res.json(toAuthUser(updated, botCount));
  } catch (err) {
    logger.error({ err }, "Telegram link error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/telegram/miniapp
// FIX [1.2 backend]: همین منطق برای miniapp هم
router.post("/auth/telegram/miniapp", requireAuth, async (req: any, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      res.status(503).json({ error: "Telegram login is not configured on this server" });
      return;
    }

    const { initData } = req.body ?? {};
    if (!initData) {
      res.status(400).json({ error: "Missing initData" });
      return;
    }

    const result = verifyTelegramInitData(initData, botToken);
    if (!result.ok) {
      res.status(401).json({ error: result.reason });
      return;
    }

    const { user: tgUser } = result;
    const telegramId = String(tgUser.id);

    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, telegramId))
      .limit(1);
    if (existing[0] && existing[0].id !== req.userId) {
      res.status(409).json({ error: "This Telegram account is already linked to another user" });
      return;
    }

    const updateData: Record<string, any> = {
      telegramId,
      telegramUsername: tgUser.username ?? null,
      telegramFirstName: tgUser.first_name,
      telegramLastName: tgUser.last_name ?? null,
      // FIX [1.2 backend]: همیشه آپدیت
      telegramPhotoUrl: tgUser.photo_url ?? null,
    };

    if (tgUser.photo_url) {
      updateData.avatar = tgUser.photo_url;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, req.userId))
      .returning();

    syncUserUpsert({
      id: updated.id, name: updated.name, email: updated.email, role: updated.role,
      plan: updated.plan, status: updated.status, bio: updated.bio,
      telegramUsername: updated.telegramUsername,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    });

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, updated.id));
    res.json(toAuthUser(updated, botCount));
  } catch (err) {
    logger.error({ err }, "Telegram miniapp link error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/telegram/unlink ──────────────────────────────────────────
// «قطع دسترسی به تلگرام»: حساب تلگرامِ متصل را از حساب جدا می‌کند (مثلاً
// وقتی دسترسی به آن تلگرام را از دست داده‌اید و می‌خواهید حساب دیگری وصل کنید).
//
// این عمل یک عاملِ هویت را برمی‌دارد، پس سخت‌گیرانه است:
//  • هویت دوباره با **رمز عبور** تأیید می‌شود (با محدودیتِ تلاش). حساب‌های
//    ساخته‌شده با گوگل/گیت‌هاب رمزِ واقعی ندارند و به‌جایش `confirm: true` می‌دهند.
//  • اگر تلگرام «روشِ ورود دومرحله‌ای» حساب است رد می‌شود — ابتدا روش را عوض کنید؛
//    در سکوت ضعیف‌کردنِ ۲FA ممنوع است.
//  • حسابِ «فقط‌تلگرام» (والدِ ثبت‌شده از بات مدرسه) تنها هویتش همین است.
//  • تلگرام برای «پروفایل کامل» لازم است؛ پس بعد از قطع، حساب تا اتصالِ یک
//    حسابِ تلگرامِ تازه در وضعیت «پروفایل ناقص» می‌ماند (همان ویزاردِ تکمیل هویت).
//  • به حسابِ تلگرامِ قبلی پیامِ اطلاع‌رسانی می‌رود (best-effort).
const TG_UNLINK_LIMIT = 5;

router.post("/auth/telegram/unlink", authRateLimit("telegram_unlink"), requireAuth, async (req: any, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!user.telegramId) {
      res.status(409).json({ error: "Telegram is not connected", code: "not_linked" });
      return;
    }
    if (user.isTelegramOnly) {
      res.status(403).json({ error: "This account is Telegram-only and cannot be disconnected", code: "telegram_only" });
      return;
    }
    if (user.twoFactorEnabled && user.twoFactorMethod === "telegram") {
      res.status(409).json({
        error: "Telegram is your two-step sign-in method. Switch the method first.",
        code: "telegram_is_two_factor",
      });
      return;
    }

    if (!user.oauthProvider) {
      const key = `tg-unlink:${user.id}`;
      const verdict = await hit(key, TG_UNLINK_LIMIT, PHONE_BLOCK_MS);
      if (!verdict.allowed) {
        send429(res, verdict.retryAfterSeconds, "تعداد تلاش‌ها بیش از حد مجاز است. بعداً دوباره تلاش کنید.");
        return;
      }
      const password = req.body?.password;
      if (typeof password !== "string" || !(await verifyPassword(password, user.passwordHash))) {
        res.status(401).json({ error: "Password is incorrect", code: "invalid_password" });
        return;
      }
      await reset(key);
    } else if (req.body?.confirm !== true) {
      res.status(400).json({ error: "Confirmation required", code: "confirm_required" });
      return;
    }

    const oldChatId = user.telegramId;
    const avatarWasTelegram =
      !!user.avatar && (user.avatar === user.telegramPhotoUrl || user.avatar.includes("/telegram-photo"));

    const [updated] = await db
      .update(usersTable)
      .set({
        telegramId: null,
        telegramUsername: null,
        telegramFirstName: null,
        telegramLastName: null,
        telegramPhotoFileId: null,
        telegramPhotoUrl: null,
        ...(avatarWasTelegram ? { avatar: null } : {}),
      })
      .where(and(eq(usersTable.id, user.id), eq(usersTable.telegramId, oldChatId)))
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Telegram is not connected", code: "not_linked" });
      return;
    }

    // «پروفایل کامل» حالا ناقص است (تلگرام جزو فیلدهای لازم است).
    const profile = checkProfile(updated);
    let finalUser = updated;
    if (updated.profileComplete !== profile.complete) {
      [finalUser] = await db
        .update(usersTable)
        .set({ profileComplete: profile.complete })
        .where(eq(usersTable.id, user.id))
        .returning();
    }

    // لینک‌های اتصالِ بازِ قبلیِ این کاربر نباید بعداً بی‌صدا دوباره وصل کنند.
    await db.delete(telegramLinkTokensTable).where(eq(telegramLinkTokensTable.userId, user.id));

    syncUserUpsert({
      id: finalUser.id, name: finalUser.name, email: finalUser.email, role: finalUser.role,
      plan: finalUser.plan, status: finalUser.status, bio: finalUser.bio,
      telegramUsername: finalUser.telegramUsername,
      createdAt: finalUser.createdAt, updatedAt: finalUser.updatedAt,
    });
    logger.info({ userId: user.id }, "Telegram unlinked by user");

    void sendTelegramUnlinked(oldChatId).catch((err) =>
      logger.warn({ err }, "telegram unlink notice failed (non-fatal)"),
    );

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, finalUser.id));
    res.json(toAuthUser(finalUser, botCount));
  } catch (err) {
    logger.error({ err }, "Telegram unlink error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/telegram/link/start ──────────────────────────────────────
// G8: "اتصال با ربات" — کاربر روی سایت این اندپوینت رو صدا می‌زنه، یک توکن
// یک‌بارمصرف کوتاه‌مدت می‌گیره، با لینک عمیق t.me/<bot>?start=<token> وارد بات
// می‌شه، بات با /start <token> (routes/telegramWebhook.ts) توکن رو مصرف کرده و
// حساب رو خودکار وصل می‌کنه — بدون نیاز به تایپ کد یا تنظیم دامنه در BotFather.
const LINK_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 دقیقه

router.post("/auth/telegram/link/start", requireAuth, async (req: any, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      res.status(503).json({ error: "Telegram login is not configured on this server" });
      return;
    }

    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    await db.insert(telegramLinkTokensTable).values({
      token,
      userId: req.userId,
      expiresAt,
    });

    res.json({ token, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "Telegram link/start error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/telegram/bot-username ─────────────────────────────────────
// نام کاربری بات از env، تا فرانت بتواند لینک عمیق بسازد. توکن بات هرگز از
// اینجا بیرون نمی‌رود — فقط نام عمومی بات.
router.get("/auth/telegram/bot-username", (_req, res) => {
  const raw = process.env.TELEGRAM_BOT_USERNAME;
  res.json({ username: raw ? raw.replace(/^@/, "") : null });
});

// ─── ورود یک‌کلیکی با تلگرام ─────────────────────────────────────────────────
//
// «دکمه بزنی، بروی توی بات، بات بگوید وارد شدی.» بدون شماره، بدون رمز، بدون
// کد شش‌رقمی — چون خودِ تلگرام هویت را تضمین می‌کند: وبهوک `from.id` را از
// سرورهای تلگرام می‌گیرد، نه از چیزی که کاربر تایپ کرده.
//
// این جریان **فقط** برای حسابی کار می‌کند که `telegramId` دارد. حساب‌های
// قدیمی‌ای که هنوز وصل نشده‌اند از همان مسیر ورود با شماره + `telegram_required`
// یک‌بار وصل می‌شوند و بعد اینجا شناخته می‌شوند.
//
// چرا سه مقدارِ جدا (`id` در لینک، `pollSecret` در مرورگر، `webTicket` در پیام
// بات): ببینید توضیح جدول در lib/db/src/schema/auth.ts.

/** عمر درخواست ورود. عمداً کوتاه: پنجره‌ی حمله‌ی یک لینک لو رفته همین است. */
const TG_LOGIN_TTL_MS = 3 * 60 * 1000;
/** عمر تیکتِ دکمه‌ی داشبورد، از لحظه‌ی تأیید. */
const TG_LOGIN_TICKET_TTL_MS = 10 * 60 * 1000;

/**
 * نشست تازه برای یک کاربر + شکل استاندارد کاربر.
 *
 * هر سه مسیرِ صدور نشست (کد ورود، poll تلگرام، تیکت دکمه‌ی داشبورد) از همین
 * تابع می‌آیند. سه پیاده‌سازیِ «نشست بساز» یعنی سه جا برای جا انداختن
 * `syncSessionUpsert` یا `lastLogin`.
 */
async function issueSession(user: typeof usersTable.$inferSelect, req: { headers: Record<string, unknown> }) {
  // والدِ «فقط-تلگرام» (ثبت‌شده از باتِ مدرسه) هرگز نشستِ سایت نمی‌گیرد؛ تنها نشستِ او کوتاه‌عمرِ باتِ داخلی است (lib/schoolBot/internalApi.ts).
  if (user.isTelegramOnly) throw new Error("telegram_only_account_cannot_login");
  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));

  const token = generateToken(user.id);
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessionExpiresAt();
  await db.insert(sessionsTable).values({
    token: tokenHash, userId: user.id, expiresAt,
    userAgentHash: hashUserAgent(req.headers["user-agent"] as string | undefined),
  });
  syncSessionUpsert({ token: tokenHash, userId: user.id, expiresAt });

  const [{ value: botCount }] = await db
    .select({ value: count() })
    .from(botsTable)
    .where(eq(botsTable.userId, user.id));

  return { user: toAuthUser(user, botCount), token };
}

/** مقایسه‌ی timing-safe برای رازهایی که رشته‌اند و نه هش. */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ─── POST /api/auth/telegram/login/start ─────────────────────────────────────
router.post("/auth/telegram/login/start", authRateLimit("telegram_login_start"), async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
    if (!botToken || !username) {
      res.status(503).json({ error: "Telegram login is not configured on this server" });
      return;
    }

    const id = crypto.randomBytes(16).toString("hex");
    const pollSecret = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TG_LOGIN_TTL_MS);

    await db.insert(telegramLoginRequestsTable).values({
      id,
      pollSecret,
      status: "pending",
      locale: typeof req.body?.locale === "string" ? req.body.locale.slice(0, 8) : null,
      sourceIp: (req.ip ?? "").slice(0, 64) || null,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 512) || null,
      expiresAt,
    });

    res.status(201).json({
      id,
      pollSecret,
      // `tglogin_` + ۳۲ کاراکتر = ۴۰، زیر سقف ۶۴ کاراکتریِ payload تلگرام.
      deepLink: `https://t.me/${username}?start=tglogin_${id}`,
      expiresInSeconds: Math.floor(TG_LOGIN_TTL_MS / 1000),
    });
  } catch (err) {
    logger.error({ err }, "Telegram login start error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/telegram/login/:id/status ─────────────────────────────────
// مرورگرِ آغازکننده این را poll می‌کند. **عمداً `authRateLimit` ندارد**: در
// یک پنجره‌ی ۳ دقیقه‌ای ده‌ها بار صدا زده می‌شود و سقف مشترکِ ۲۰ درخواست در
// ۱۵ دقیقه، ورودِ درست را وسط کار قطع می‌کرد. محافظ اینجا `pollSecret` است،
// نه شمارنده.
router.get("/auth/telegram/login/:id/status", async (req, res) => {
  try {
    const secret = typeof req.query.secret === "string" ? req.query.secret : "";
    const [row] = await db
      .select()
      .from(telegramLoginRequestsTable)
      .where(eq(telegramLoginRequestsTable.id, req.params.id))
      .limit(1);

    // راز غلط و ردیفِ ناموجود یک پاسخ می‌گیرند: وگرنه این اندپوینت می‌گوید
    // کدام شناسه‌ها واقعی‌اند.
    if (!row || !secretEquals(secret, row.pollSecret)) {
      res.status(404).json({ error: "Login request not found", code: "not_found" });
      return;
    }

    if (row.status === "rejected") {
      res.json({ status: "rejected", reason: row.rejectedReason ?? "unknown" });
      return;
    }
    // یک درخواستِ مصرف‌شده دیگر نشست نمی‌دهد، حتی با راز درست.
    if (row.status === "consumed") {
      res.json({ status: "expired" });
      return;
    }
    if (row.status === "pending") {
      res.json({ status: isExpired(row.expiresAt) ? "expired" : "pending" });
      return;
    }

    // ── approved ────────────────────────────────────────────────────────────
    // مصرف **قبل** از هر کار دیگری و به‌صورت شرطی: دو poll هم‌زمان (دو تب،
    // یا یک retry شبکه) نباید دو نشست بسازند.
    const consumed = await db
      .update(telegramLoginRequestsTable)
      .set({ status: "consumed", consumedAt: new Date() })
      .where(
        and(
          eq(telegramLoginRequestsTable.id, row.id),
          eq(telegramLoginRequestsTable.status, "approved"),
        ),
      )
      .returning({ id: telegramLoginRequestsTable.id });
    if (consumed.length === 0) {
      res.json({ status: "expired" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, row.userId!))
      .limit(1);
    if (!user) {
      res.json({ status: "rejected", reason: "no_account" });
      return;
    }
    if (user.status === "banned" || user.status === "suspended") {
      res.json({ status: "rejected", reason: "suspended" });
      return;
    }

    logger.info({ userId: user.id }, "Telegram one-tap login completed");
    res.json({ status: "approved", ...(await issueSession(user, req)) });
  } catch (err) {
    logger.error({ err }, "Telegram login status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/telegram/login/ticket ────────────────────────────────────
// دکمه‌ی «داشبورد» داخل پیام بات به این می‌رسد. جدا از `pollSecret` است تا
// کاربری که روی گوشی بات را باز کرده، همان‌جا هم وارد شود — بدون اینکه نشستِ
// مرورگرِ اولیه را بدزدد یا مصرف کند.
router.post("/auth/telegram/login/ticket", authRateLimit("telegram_login_ticket"), async (req, res) => {
  try {
    const ticket = req.body?.ticket;
    if (typeof ticket !== "string" || ticket === "") {
      res.status(400).json({ error: "Invalid ticket", code: "invalid_ticket" });
      return;
    }

    // مصرف اتمیک: `web_ticket_used_at IS NULL` در همان UPDATE شرط است، پس دو
    // کلیک روی همان دکمه فقط یکی جواب می‌گیرد.
    const [row] = await db
      .update(telegramLoginRequestsTable)
      .set({ webTicketUsedAt: new Date() })
      .where(
        and(
          eq(telegramLoginRequestsTable.webTicket, ticket),
          isNull(telegramLoginRequestsTable.webTicketUsedAt),
        ),
      )
      .returning();

    if (!row || !row.userId || !row.approvedAt) {
      res.status(400).json({ error: "This link has expired", code: "ticket_expired" });
      return;
    }
    if (Date.now() - row.approvedAt.getTime() > TG_LOGIN_TICKET_TTL_MS) {
      res.status(400).json({ error: "This link has expired", code: "ticket_expired" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, row.userId))
      .limit(1);
    if (!user) {
      res.status(400).json({ error: "This link has expired", code: "ticket_expired" });
      return;
    }
    if (user.status === "banned" || user.status === "suspended") {
      res.status(403).json({ error: "Account suspended", code: "suspended" });
      return;
    }

    logger.info({ userId: user.id }, "Telegram login ticket redeemed");
    res.json(await issueSession(user, req));
  } catch (err) {
    logger.error({ err }, "Telegram login ticket error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── ورود با گوگل ─────────────────────────────────────────────────────────
//
// یک هندشیک استاندارد authorization-code: دکمه‌ی «ورود با گوگل» با یک
// navigation کامل (نه fetch) به GET زیر می‌رود، گوگل کاربر را می‌پرسد و به
// GET دومی برمی‌گرداند. چون این یک ریدایرکت مرورگری است نه یک تماس API،
// نشست نهایی (`token`) هرگز در body یک پاسخ JSON به این مسیر برنمی‌گردد؛
// در عوض در URL fragment (بعد از `#`) به فرانت‌اند ریدایرکت می‌شود — دقیقاً
// همان دلیلی که `pollSecret` بالاتر هیچ‌وقت در URL نمی‌رود: query string در
// لاگ سرور و در هدر Referer صفحه‌ی بعدی می‌ماند، fragment هیچ‌کدام را.
//
// تطبیق حساب: چون گوگل ایمیل را خودش تأیید کرده (`verified_email`)، اگر
// از قبل کاربری با همان ایمیل باشد همان حساب لاگین می‌شود؛ وگرنه یک حساب
// تازه با یک passwordHash تصادفیِ غیرقابل‌حدس ساخته می‌شود (ستون در دیتابیس
// NOT NULL است، این حساب صرفاً هرگز از رمز برای ورود استفاده نمی‌کند).
const GOOGLE_OAUTH_STATE_COOKIE = "irforge_g_oauth_state";
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function googleOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function loginErrorRedirect(res: any, code: string) {
  const site = process.env.PUBLIC_SITE_URL || "/";
  res.redirect(`${site.replace(/\/$/, "")}/login?error=${encodeURIComponent(code)}`);
}

// ─── GET /api/auth/google ─────────────────────────────────────────────────
router.get("/auth/google", (req, res) => {
  const client = googleOAuthClient();
  if (!client) {
    loginErrorRedirect(res, "google_unavailable");
    return;
  }
  const state = crypto.randomBytes(24).toString("hex");
  res.cookie(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GOOGLE_OAUTH_STATE_TTL_MS,
    path: "/api/auth/google",
  });
  const url = client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state,
  });
  res.redirect(url);
});

// ─── GET /api/auth/google/callback ────────────────────────────────────────
router.get("/auth/google/callback", async (req, res) => {
  try {
    const client = googleOAuthClient();
    if (!client) {
      loginErrorRedirect(res, "google_unavailable");
      return;
    }

    const cookieState = req.cookies?.[GOOGLE_OAUTH_STATE_COOKIE];
    res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, { path: "/api/auth/google" });
    const queryState = typeof req.query.state === "string" ? req.query.state : "";
    // راز غلط/گمشده و کاربرِ لغوکننده یک مقصد می‌گیرند — پیام دقیق برای این
    // مسیر که کاربر مستقیم چیزی تایپ نمی‌کند اهمیتی ندارد.
    if (!cookieState || !queryState || !secretEquals(queryState, cookieState)) {
      loginErrorRedirect(res, "google_failed");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      loginErrorRedirect(res, "google_failed");
      return;
    }

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: client, version: "v2" });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email || profile.verified_email !== true) {
      loginErrorRedirect(res, "google_email_unverified");
      return;
    }
    const email = normaliseEmail(profile.email);

    const existing = await db.select().from(usersTable).where(emailEquals(email)).limit(1);
    let user = existing[0];

    if (user && (user.status === "banned" || user.status === "suspended")) {
      loginErrorRedirect(res, "suspended");
      return;
    }

    // ⛔ پیوندِ خودکار فقط به حسابی که ایمیلش **تأیید شده**. ایمیلِ حساب‌های
    // ثبت‌شده با شماره/تلگرام تأییدنشده است؛ اگر اینجا وارد همان حساب
    // می‌شدیم، مهاجمی که قبلاً با ایمیل قربانی ثبت‌نام کرده بود (و رمزش را
    // می‌داند) بعد از ورودِ قربانی با گوگل هنوز به همان حساب دسترسی داشت.
    if (user && !user.emailVerified) {
      logger.warn({ userId: user.id }, "Google sign-in refused: existing account email is unverified");
      loginErrorRedirect(res, "email_unverified_account");
      return;
    }

    if (!user) {
      const id = crypto.randomUUID();
      const randomPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
      const [created] = await db
        .insert(usersTable)
        .values({
          id,
          name: profile.name || email.split("@")[0],
          email,
          passwordHash: randomPasswordHash,
          avatar: profile.picture ?? null,
          role: "user",
          plan: "free",
          status: "active",
          emailVerified: true,
          oauthProvider: "google",
        })
        .returning();
      user = created;
      syncUserUpsert({
        id: user.id, name: user.name, email: user.email, role: user.role,
        plan: user.plan, status: user.status, bio: user.bio,
        telegramUsername: user.telegramUsername, createdAt: user.createdAt,
      });
      logger.info({ userId: user.id }, "New account created via Google sign-in");
    } else {
      logger.info({ userId: user.id }, "Google sign-in completed");
    }

    const { token } = await issueSession(user, req);
    const site = (process.env.PUBLIC_SITE_URL || "/").replace(/\/$/, "");
    res.redirect(`${site}/auth/google/callback#token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.error({ err }, "Google OAuth callback error");
    loginErrorRedirect(res, "google_failed");
  }
});

// ─── ورود با گیت‌هاب ──────────────────────────────────────────────────────
//
// همان الگوی گوگل بالا، فقط handshake با endpointهای خودِ گیت‌هاب (نه یک
// SDK): GET /login/oauth/authorize برای ریدایرکت اول، POST
// /login/oauth/access_token برای گرفتن accessToken، و GET /user (+ در صورت
// نبودِ ایمیل عمومی، GET /user/emails) برای پروفایل. تطبیق حساب هم دقیقاً
// همان‌طور: بر اساس ایمیلِ **تأییدشده**، چون این ستونِ یکتای واقعی روی
// جدول کاربران است، نه یک `githubId` جداگانه.
//
// افزودن یک provider بعدی (دیسکورد، اپل، …) یعنی کپی همین دو مسیر با
// endpointهای آن سرویس — الگو همینجا مستند است.
const GITHUB_OAUTH_STATE_COOKIE = "irforge_gh_oauth_state";
const GITHUB_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function githubOAuthConfig() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

// ─── GET /api/auth/github ─────────────────────────────────────────────────
router.get("/auth/github", (req, res) => {
  const config = githubOAuthConfig();
  if (!config) {
    loginErrorRedirect(res, "github_unavailable");
    return;
  }
  const state = crypto.randomBytes(24).toString("hex");
  res.cookie(GITHUB_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GITHUB_OAUTH_STATE_TTL_MS,
    path: "/api/auth/github",
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("allow_signup", "true");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// ─── GET /api/auth/github/callback ────────────────────────────────────────
router.get("/auth/github/callback", async (req, res) => {
  try {
    const config = githubOAuthConfig();
    if (!config) {
      loginErrorRedirect(res, "github_unavailable");
      return;
    }

    const cookieState = req.cookies?.[GITHUB_OAUTH_STATE_COOKIE];
    res.clearCookie(GITHUB_OAUTH_STATE_COOKIE, { path: "/api/auth/github" });
    const queryState = typeof req.query.state === "string" ? req.query.state : "";
    if (!cookieState || !queryState || !secretEquals(queryState, cookieState)) {
      loginErrorRedirect(res, "github_failed");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      loginErrorRedirect(res, "github_failed");
      return;
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      loginErrorRedirect(res, "github_failed");
      return;
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      loginErrorRedirect(res, "github_failed");
      return;
    }

    const ghHeaders = {
      Authorization: `Bearer ${accessToken}`,
      // گیت‌هاب بدون User-Agent هر تماسی به REST API را با 403 رد می‌کند.
      "User-Agent": "irforge-web",
      Accept: "application/vnd.github+json",
    };
    const profileRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
    if (!profileRes.ok) {
      loginErrorRedirect(res, "github_failed");
      return;
    }
    const profile = (await profileRes.json()) as {
      email?: string | null;
      name?: string | null;
      login?: string;
      avatar_url?: string | null;
    };

    // ایمیل پروفایل عمومی اغلب خالی است (کاربر در تنظیمات گیت‌هاب مخفی‌اش
    // کرده)؛ در آن صورت لیست ایمیل‌ها را می‌گیریم و اولین موردِ primary +
    // verified را برمی‌داریم — دقیقاً همان چیزی که گوگل با `verified_email`
    // تضمین می‌کند، این‌جا هم لازم است چون هویت روی همین ایمیل تطبیق می‌شود.
    let primaryEmail: string | null = profile.email ?? null;
    if (!primaryEmail) {
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers: ghHeaders });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
        primaryEmail = best?.email ?? null;
      }
    }

    if (!primaryEmail) {
      loginErrorRedirect(res, "github_email_unverified");
      return;
    }
    const email = normaliseEmail(primaryEmail);

    const existing = await db.select().from(usersTable).where(emailEquals(email)).limit(1);
    let user = existing[0];

    if (user && (user.status === "banned" || user.status === "suspended")) {
      loginErrorRedirect(res, "suspended");
      return;
    }

    // همان قاعده‌ی گوگل: فقط حسابِ دارای ایمیلِ تأییدشده.
    if (user && !user.emailVerified) {
      logger.warn({ userId: user.id }, "GitHub sign-in refused: existing account email is unverified");
      loginErrorRedirect(res, "email_unverified_account");
      return;
    }

    if (!user) {
      const id = crypto.randomUUID();
      const randomPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
      const [created] = await db
        .insert(usersTable)
        .values({
          id,
          name: profile.name || profile.login || email.split("@")[0],
          email,
          passwordHash: randomPasswordHash,
          avatar: profile.avatar_url ?? null,
          role: "user",
          plan: "free",
          status: "active",
          emailVerified: true,
          oauthProvider: "github",
        })
        .returning();
      user = created;
      syncUserUpsert({
        id: user.id, name: user.name, email: user.email, role: user.role,
        plan: user.plan, status: user.status, bio: user.bio,
        telegramUsername: user.telegramUsername, createdAt: user.createdAt,
      });
      logger.info({ userId: user.id }, "New account created via GitHub sign-in");
    } else {
      logger.info({ userId: user.id }, "GitHub sign-in completed");
    }

    const { token } = await issueSession(user, req);
    const site = (process.env.PUBLIC_SITE_URL || "/").replace(/\/$/, "");
    res.redirect(`${site}/auth/github/callback#token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.error({ err }, "GitHub OAuth callback error");
    loginErrorRedirect(res, "github_failed");
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// V3: recovery is phone + SMS OTP only — no email, no Telegram. The user
// enters the phone number on file for the account; if it matches, a code
// goes out over SMS (lib/registrationBot.ts:sendResetCodeSms → lib/smsSender.ts).

/** عمر کد بازیابی رمز (هم پیامک، هم بات). */
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
/** حداکثر حدس برای یک کد بازیابی، بعد از آن کد می‌میرد. */
const RESET_MAX_TRIES = 5;
const RESET_PASSWORD_MIN = 8;
const resetTryKey = (userId: string) => `reset-try:${userId}`;
const resetRequestKey = (phone: string) => `reset-req:${phone}`;

/**
 * کد بازیابی را یا با پیامک می‌فرستد (`method: "sms"`، پیش‌فرض) یا داخل
 * بات تلگرامِ پلتفرم (`method: "telegram"`، فقط برای حسابِ متصل به تلگرام).
 *
 * شناسه‌ی حساب در هر دو حالت **شماره** است. پاسخ همیشه یکسان است — چه شماره
 * ثبت باشد، چه نباشد، چه تلگرام وصل باشد، چه نه — و زمانِ پاسخ هم یکسان‌سازی
 * می‌شود (قبلاً مسیر «کاربر نیست» فوری برمی‌گشت و از روی زمان، شماره‌های
 * ثبت‌شده لو می‌رفتند).
 */
router.post("/auth/forgot-password", authRateLimit("forgot_password"), async (req, res) => {
  const startedAt = Date.now();
  const genericMessage = "اگر این شماره ثبت شده باشد، کد بازیابی ارسال می‌شود.";
  const respondGeneric = async () => {
    const elapsed = Date.now() - startedAt;
    const floor = 700;
    if (elapsed < floor) await new Promise((r) => setTimeout(r, floor - elapsed));
    res.json({ message: genericMessage, expiresInSeconds: Math.floor(RESET_CODE_TTL_MS / 1000) });
  };

  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      res.status(400).json({ error: "Phone number is required" });
      return;
    }
    const method: "sms" | "telegram" = req.body?.method === "telegram" ? "telegram" : "sms";

    // کلید جدا از شمارنده‌ی ورود: قبلاً با ۵ درخواستِ «فراموشی» می‌شد ورودِ
    // صاحب حساب را هم قفل کرد.
    const blocked = await hit(resetRequestKey(phone), PHONE_FAIL_LIMIT, PHONE_BLOCK_MS);
    if (!blocked.allowed) {
      send429(res, blocked.retryAfterSeconds, "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.");
      return;
    }
    // سقف هزینه‌ی پیامک (۱ دقیقه، ۱۰ دقیقه، روزانه، IP) فقط برای مسیر پیامک.
    if (method === "sms") {
      const smsVerdict = await checkSmsOtpSendRateLimit(phone, clientIp(req));
      if (!smsVerdict.allowed) {
        sendSmsOtpRateLimited(res, smsVerdict);
        return;
      }
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (!user || user.status === "banned" || (method === "telegram" && !user.telegramId)) {
      await respondGeneric();
      return;
    }

    const code = generateCode();
    await db.update(usersTable)
      .set({ resetCodeHash: hashCode(code), resetCodeExpiresAt: new Date(Date.now() + RESET_CODE_TTL_MS) })
      .where(eq(usersTable.id, user.id));
    // کدِ تازه = شمارنده‌ی حدسِ تازه.
    await reset(resetTryKey(user.id));

    if (method === "telegram") {
      await sendResetCodeTelegram(user.telegramId as string, code);
    } else {
      await sendResetCodeSms(phone, code, null);
    }
    logger.info({ userId: user.id, method }, "Password reset code issued");

    await respondGeneric();
  } catch (err) {
    logger.error({ err }, "Forgot password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post("/auth/reset-password", authRateLimit("reset_password"), async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const { code, newPassword } = req.body ?? {};
    if (!phone || !code || typeof newPassword !== "string" || !newPassword) {
      res.status(400).json({ error: "phone, code and newPassword are required" });
      return;
    }
    if (newPassword.length < RESET_PASSWORD_MIN) {
      res.status(400).json({ error: `Password must be at least ${RESET_PASSWORD_MIN} characters` });
      return;
    }
    const invalid = () => res.status(400).json({ error: "Invalid or expired code" });

    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt || isExpired(user.resetCodeExpiresAt)) {
      invalid();
      return;
    }

    // ⛔ سقف حدس روی خودِ کد. قبلاً این مسیر هیچ شمارنده‌ای نداشت (کلیدِ
    // per-phone فقط در forgot-password زده می‌شد) و یک کد ۶ رقمی ۱۵ دقیقه
    // قابل brute-force بود. حالا ۵ حدس و کد می‌میرد.
    const tries = await hit(resetTryKey(user.id), RESET_MAX_TRIES, PHONE_BLOCK_MS);
    if (!tries.allowed) {
      await db.update(usersTable)
        .set({ resetCodeHash: null, resetCodeExpiresAt: null })
        .where(eq(usersTable.id, user.id));
      logger.warn({ userId: user.id }, "Password reset code killed after too many attempts");
      send429(res, tries.retryAfterSeconds, "تعداد تلاش‌ها بیش از حد مجاز است. دوباره کد بگیرید.");
      return;
    }

    // مقایسه‌ی timing-safe.
    if (!verifyOtp(String(code), user.resetCodeHash)) {
      invalid();
      return;
    }

    await reset(resetTryKey(user.id));
    await reset(phoneKey(phone));

    // یک‌بارمصرف و اتمیک: شرطِ همان هش داخل UPDATE است.
    const updated = await db.update(usersTable)
      .set({
        passwordHash: await hashPassword(newPassword),
        resetCodeHash: null,
        resetCodeExpiresAt: null,
      })
      .where(and(eq(usersTable.id, user.id), eq(usersTable.resetCodeHash, user.resetCodeHash)))
      .returning({ id: usersTable.id });
    if (updated.length === 0) {
      invalid();
      return;
    }

    // رمز عوض شد ⇒ همه‌ی نشست‌های قدیمی باطل. وگرنه کسی که قبلاً نشست
    // داشت (دستگاه دزدیده‌شده، مهاجم) بعد از بازیابی هم داخل می‌ماند.
    const revoked = await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.userId, user.id))
      .returning({ token: sessionsTable.token });
    for (const r of revoked) syncSessionDelete(r.token);

    logger.info({ userId: user.id, revokedSessions: revoked.length }, "Password reset completed");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Reset password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// IRFORGE_SMS_OTP_PROMPT Phase 4 — پیامک به‌عنوان روش سومِ OTP (کنار تلگرام
// و ایمیل)، برای هر سه هدف: register | login | password_reset.
//
// جدولِ مستقلِ sms_otp_codes (فاز ۲) و rate limit فاز ۳
// (lib/smsOtpRateLimit.ts) اینجا به هم وصل می‌شوند؛ خودِ ارسال از
// lib/smsir.ts (فاز ۱) می‌آید. برخلاف تلگرام (رایگان)، هر بار موفقِ این
// روت پول واقعی خرج می‌کند اگر کلیدِ Production فعال باشد.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * عمداً ۲ دقیقه، نه ۵ دقیقه‌ی `CODE_TTL_MS` تلگرام/ایمیل — هر ارسالِ مجدد
 * اینجا هزینه‌ی واقعیِ پیامک دارد، پس نمی‌خواهیم کاربر را به نگه‌داشتنِ یک
 * کدِ قدیمی و صبرِ طولانی تشویق کنیم. طول عمر عمداً همین‌جا تعیین می‌شود، نه
 * در schema (ببینید کامنتِ `smsOtpCodesTable` در schema/auth.ts).
 */
const SMS_OTP_CODE_TTL_MS = 2 * 60 * 1000;

function isSmsOtpPurpose(value: unknown): value is SmsOtpPurpose {
  return typeof value === "string" && (SMS_OTP_PURPOSES as readonly string[]).includes(value);
}

/**
 * پیامِ ژنریکِ ارسال. برای register واقعاً یعنی «رفت». برای login/password_reset
 * حتی وقتی شماره اصلاً حساب ندارد همین برمی‌گردد — دقیقاً همان الگوی ضدِّ
 * شمارشِ `/auth/forgot-password`، وگرنه این اندپوینت به ابزارِ کشفِ شماره
 * تبدیل می‌شود.
 */
const SMS_OTP_SENT_MESSAGE = "کد تأیید برای این شماره پیامک شد.";

// ─── POST /api/auth/otp/sms/send ─────────────────────────────────────────────
router.post("/auth/otp/sms/send", smsOtpSendRateLimit(), async (req, res) => {
  try {
    const purpose = req.body?.purpose;
    if (!isSmsOtpPurpose(purpose)) {
      res.status(400).json({ error: "هدف نامعتبر است", code: "invalid_purpose" });
      return;
    }
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      res.status(400).json({ error: "شماره موبایل نامعتبر است", code: "invalid_phone" });
      return;
    }

    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);

    if (purpose === "register") {
      // برخلاف login/password_reset پایین، اینجا افشای «این شماره قبلاً
      // ثبت شده» همان قاعده‌ی /auth/register (پیامِ صریحِ «Email already
      // registered») است، نه ضدِّشمارش — کاربری که دارد ثبت‌نام می‌کند باید
      // بداند شماره‌اش قبلاً گرفته شده، وگرنه کدی می‌گیرد که به‌جایی نمی‌رسد.
      if (existingUser) {
        res.status(409).json({ error: "این شماره قبلاً ثبت شده است", code: "phone_already_registered" });
        return;
      }
    } else if (
      !existingUser ||
      existingUser.status === "banned" ||
      existingUser.status === "suspended"
    ) {
      // login / password_reset روی شماره‌ی ناموجود یا بن‌شده: پاسخِ یکسان با
      // موفقیت، بدونِ درجِ ردیف و بدونِ صداکردنِ sendOtpSms — نه شماره لو
      // می‌رود، نه پولِ پیامک برایش خرج می‌شود.
      res.json({
        message: SMS_OTP_SENT_MESSAGE,
        expiresInSeconds: Math.floor(SMS_OTP_CODE_TTL_MS / 1000),
      });
      return;
    }

    const code = generateCode();
    await db.insert(smsOtpCodesTable).values({
      id: crypto.randomUUID(),
      phone,
      purpose,
      userId: purpose === "register" ? null : (existingUser as typeof usersTable.$inferSelect).id,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + SMS_OTP_CODE_TTL_MS),
      sourceIp: clientIp(req).slice(0, 64),
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 512) || null,
    });

    const sendResult = await sendOtpSms(phone, code);
    if (!sendResult.success) {
      // کدِ خام هرگز به فرانت برنمی‌گردد، حتی اینجا — فقط اینکه ارسال جواب
      // نداد. جزئیاتِ خطای خامِ sms.ir همین‌جا (لاگ) می‌ماند، نه در پاسخ.
      logger.warn({ purpose, error: sendResult.error }, "sendOtpSms failed");
      res.status(502).json({
        error: "ارسال پیامک ناموفق بود. کمی بعد دوباره تلاش کنید.",
        code: "sms_send_failed",
      });
      return;
    }

    logger.info({ purpose }, "SMS OTP sent");
    res.json({
      message: SMS_OTP_SENT_MESSAGE,
      expiresInSeconds: Math.floor(SMS_OTP_CODE_TTL_MS / 1000),
      // فقط وقتی AUTH_DEV_ECHO_CODES=true — تا فازِ ۵ (و QA) بدونِ سوزاندنِ
      // اعتبارِ sms.ir قابل تست باشد. پیش‌فرض خاموش، هرگز در production.
      ...devEchoCode(code),
    });
  } catch (err) {
    logger.error({ err }, "SMS OTP send error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/otp/sms/verify ───────────────────────────────────────────
// رفتار بعد از موفقیت به purpose بستگی دارد:
//  • login → نشستِ کامل صادر می‌شود (issueSession)، دقیقاً مثلِ
//    /auth/login/verify و /auth/telegram/login/ticket.
//  • password_reset → نشست صادر نمی‌شود؛ به‌جایش یک resetToken کوتاه‌عمر
//    روی همان resetCodeHash/resetCodeExpiresAtِ usersTable نوشته می‌شود که
//    /auth/reset-password (بدونِ هیچ تغییری) با آن رمز را عوض می‌کند —
//    همان مکانیزمِ قبلی، فقط کدِ خامش این‌بار از مسیرِ sms.ir Verify آمده.
//  • register → هنوز کاربری وجود ندارد؛ فقط verified:true برمی‌گردد تا
//    فرانت‌اند به گامِ بعدیِ ثبت‌نام برود (ساختِ حساب کارِ فازِ دیگری است).
router.post("/auth/otp/sms/verify", authRateLimit("otp_sms_verify"), async (req, res) => {
  try {
    const purpose = req.body?.purpose;
    if (!isSmsOtpPurpose(purpose)) {
      res.status(400).json({ error: "هدف نامعتبر است", code: "invalid_purpose" });
      return;
    }
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      res.status(400).json({ error: "شماره موبایل نامعتبر است", code: "invalid_phone" });
      return;
    }

    const [row] = await db
      .select()
      .from(smsOtpCodesTable)
      .where(
        and(
          eq(smsOtpCodesTable.phone, phone),
          eq(smsOtpCodesTable.purpose, purpose),
          isNull(smsOtpCodesTable.consumedAt),
        ),
      )
      .orderBy(desc(smsOtpCodesTable.createdAt))
      .limit(1);

    // ناموجود یا منقضی — یک پیام، تا این اندپوینت هم اوراکلِ «آیا کدی برای
    // این شماره فرستاده شده» نشود.
    if (!row || isExpired(row.expiresAt)) {
      res.status(400).json({ error: "کد منقضی شده یا نامعتبر است", code: "code_expired" });
      return;
    }

    // افزایشِ اتمیکِ شمارنده **قبل** از مقایسه (درخواست‌های موازی نباید
    // سقف را دور بزنند).
    const [bumped] = await db
      .update(smsOtpCodesTable)
      .set({ attempts: sql`${smsOtpCodesTable.attempts} + 1` })
      .where(and(eq(smsOtpCodesTable.id, row.id), isNull(smsOtpCodesTable.consumedAt)))
      .returning({ attempts: smsOtpCodesTable.attempts });
    if (!bumped) {
      res.status(400).json({ error: "کد منقضی شده یا نامعتبر است", code: "code_expired" });
      return;
    }
    const attempts = bumped.attempts;

    if (attempts > MAX_CODE_ATTEMPTS) {
      // ⛔ کدِ کشته‌شده با `expiresAt` بسته می‌شود، **نه** `consumedAt`.
      // `consumedAt` یعنی «با موفقیت تأیید شد» و `recentSmsRegisterProof` همان
      // را اثباتِ مالکیتِ شماره می‌گیرد — پیش‌تر با ۶ حدسِ غلط می‌شد برای هر
      // شماره‌ای «تأیید» ساخت.
      await db
        .update(smsOtpCodesTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(smsOtpCodesTable.id, row.id));
      logger.warn({ purpose }, "SMS OTP killed after too many attempts");
      res.status(429).json({ error: "تعداد تلاش‌ها بیش از حد مجاز است", code: "too_many_attempts" });
      return;
    }

    if (!verifyOtp(String(req.body?.code ?? ""), row.codeHash)) {
      res.status(400).json({
        error: "کد وارد شده اشتباه است",
        code: "invalid_code",
        attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - attempts),
      });
      return;
    }

    // مصرفِ اتمیک: شرطِ `consumedAt IS NULL` داخل خودِ UPDATE، تا دو
    // درخواستِ هم‌زمان با همان کدِ درست هر دو یک نتیجه‌ی موفق نگیرند.
    const consumed = await db
      .update(smsOtpCodesTable)
      .set({ consumedAt: new Date() })
      .where(and(eq(smsOtpCodesTable.id, row.id), isNull(smsOtpCodesTable.consumedAt)))
      .returning({ id: smsOtpCodesTable.id });
    if (consumed.length === 0) {
      res.status(400).json({ error: "این کد قبلاً استفاده شده است", code: "code_expired" });
      return;
    }

    if (purpose === "register") {
      logger.info("SMS OTP verified for registration");
      res.json({ verified: true, phone });
      return;
    }

    // login / password_reset: ردیف حتماً userId دارد (هنگامِ send برای این
    // دو هدف پر شده)؛ اگر بینِ send و verify حساب حذف/بن شده باشد همان
    // پیامِ «منقضی شده» را می‌گیرد، نه یک خطای داخلی یا افشای وضعیتِ حساب.
    const [user] = row.userId
      ? await db.select().from(usersTable).where(eq(usersTable.id, row.userId)).limit(1)
      : [];
    if (!user || user.status === "banned" || user.status === "suspended") {
      res.status(400).json({ error: "کد منقضی شده یا نامعتبر است", code: "code_expired" });
      return;
    }

    // این هم یک تأییدِ واقعیِ شماره است — با دکمه‌ی request_contact تلگرام
    // فرقی ندارد، پس همان ستون را true می‌کند (ببینید کامنتِ phoneVerified
    // در schema/users.ts).
    if (!user.phoneVerified) {
      await db.update(usersTable).set({ phoneVerified: true }).where(eq(usersTable.id, user.id));
    }

    if (purpose === "login") {
      logger.info({ userId: user.id }, "SMS OTP login completed");
      res.json(await issueSession(user, req));
      return;
    }

    // password_reset: بدونِ نشست. یک رازِ کوتاه‌عمر (۱۰ دقیقه) روی همان
    // resetCodeHash/resetCodeExpiresAtِ usersTable — تا /auth/reset-password
    // بدونِ هیچ تغییری همان چک را روی این رمزِ تازه انجام دهد.
    const resetToken = crypto.randomBytes(32).toString("hex");
    await db
      .update(usersTable)
      .set({
        resetCodeHash: hashCode(resetToken),
        resetCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .where(eq(usersTable.id, user.id));

    logger.info({ userId: user.id }, "SMS OTP verified for password reset");
    res.json({ verified: true, resetToken });
  } catch (err) {
    logger.error({ err }, "SMS OTP verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
