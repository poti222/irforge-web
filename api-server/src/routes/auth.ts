import { Router } from "express";
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
import { eq, and, gt, count, isNull, desc } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { normaliseEmail, emailEquals, isEmailUniqueViolation } from "../lib/email";
import { syncUserUpsert, syncSessionUpsert, syncSessionDelete } from "../lib/sheetsSync";
import { verifyTelegramAuth, verifyTelegramInitData } from "../lib/telegramAuth";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendResetCodeSms } from "../lib/registrationBot";
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
import { sendEmailLoginCode } from "../lib/authEmails";
import { sendOtpSms } from "../lib/smsir";
import { authRateLimit, hit, clientIp, phoneKey, emailKey, reset, PHONE_FAIL_LIMIT, PHONE_BLOCK_MS } from "../middleware/rateLimit";
import { hashSessionToken, hashUserAgent } from "../lib/sessionToken";

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
function toAuthUser(user: typeof usersTable.$inferSelect, botCount: number) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    plan: user.plan,
    bio: user.bio ?? null,
    telegramId: user.telegramId ?? null,
    telegramUsername: user.telegramUsername ?? null,
    telegramFirstName: user.telegramFirstName ?? null,
    telegramLastName: user.telegramLastName ?? null,
    telegramPhotoUrl: user.telegramPhotoUrl ?? null,
    hasUsedTrial: user.hasUsedTrial ?? false,
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
router.post("/auth/register", async (req, res) => {
  try {
    const { name, password } = req.body;
    const email = normaliseEmail(req.body?.email);
    if (!name || !email || !password) {
      res.status(400).json({ error: "Name, email and password are required" });
      return;
    }
    // این مسیر قدیمی ایمیل را «همان‌طور که تایپ شده» ذخیره می‌کرد. حالا مثل
    // مسیر جدید نرمال می‌شود، وگرنه یک حساب با `Ali@Gmail.com` برای هر
    // جست‌وجوی دیگری نامرئی می‌ماند.
    const existing = await db
      .select()
      .from(usersTable)
      .where(emailEquals(email))
      .limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(usersTable)
      .values({ id, name, email, passwordHash, role: "user", plan: "free", status: "active" })
      .returning();
    const token = generateToken(id);
    const tokenHash = hashSessionToken(token);
    const sessionExpiry = sessionExpiresAt();
    await db.insert(sessionsTable).values({
      token: tokenHash, userId: id, expiresAt: sessionExpiry,
      userAgentHash: hashUserAgent(req.headers["user-agent"]),
    });
    syncSessionUpsert({ token: tokenHash, userId: id, expiresAt: sessionExpiry });
    syncUserUpsert({
      id: user.id, name: user.name, email: user.email, role: user.role,
      plan: user.plan, status: user.status, bio: user.bio,
      telegramUsername: user.telegramUsername, createdAt: user.createdAt,
    });
    res.status(201).json({
      user: toAuthUser(user, 0),
      token,
    });
  } catch (err) {
    logger.error({ err }, "Register error");
    res.status(500).json({ error: "Internal server error" });
  }
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
    if (user.status === "banned" || user.status === "suspended") {
      res.status(403).json({ error: "Account suspended" });
      return;
    }

    // IRFORGE_PROMPT_V3 Phase 14 — یک حساب فقط-ایمیل (بدون شماره) هرگز شماره
    // یا تلگرامی نداشته که وصل کند؛ کدش را روی همان ایمیل می‌گیرد. اما یک
    // حساب قدیمیِ شماره‌محور که تلگرامش وصل نیست باید همان مسیر قبلی
    // («وصل کن») را ببیند — نه این‌که ناگهان کد را جای دیگری بگیرد.
    const isEmailOnlyAccount = !user.telegramId && !user.phone;

    if (!user.telegramId && !isEmailOnlyAccount) {
      // حساب‌های ساخته‌شده پیش از این فیچر تلگرام ندارند و نمی‌توانند کد بگیرند.
      // نه اجازه‌ی عبور بدون عامل دوم، نه قفل‌شدن: یک وضعیت مشخص برمی‌گردد که UI
      // آن را به صفحه‌ی «حسابت باید به تلگرام وصل شود» با لینک عمیق تبدیل می‌کند،
      // و همان ماشین فاز ۳ را با purpose = "link" دوباره استفاده می‌کند.
      const linkToken = crypto.randomBytes(16).toString("hex");
      await db.insert(telegramLinkTokensTable).values({
        token: linkToken,
        userId: user.id,
        purpose: "link",
        expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS),
      });
      const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? null;
      res.status(409).json({
        error: "This account needs Telegram connected before signing in",
        code: "telegram_required",
        deepLink: username ? `https://t.me/${username}?start=${linkToken}` : null,
      });
      return;
    }

    await reset(rateKey);

    const code = generateCode();
    const challengeId = crypto.randomUUID();
    await db.insert(loginChallengesTable).values({
      id: challengeId,
      userId: user.id,
      codeHash: hashCode(code),
      codeExpiresAt: codeExpiry(),
    });

    if (isEmailOnlyAccount) {
      const delivery = await sendEmailLoginCode(user.email, code, null);
      if (!delivery.ok) {
        logger.error({ userId: user.id, error: delivery.error }, "login: email delivery failed");
        res.status(502).json({ error: "Could not send the sign-in email", code: "email_delivery_failed" });
        return;
      }
    } else {
      await sendLoginCode(user.telegramId as string, code, null, user.phone ?? undefined);
    }

    logger.info({ userId: user.id }, "Login challenge issued");
    res.json({
      challengeId,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      // اشاره‌ی ماسک‌شده به مقصد، نه خودِ مقصد.
      destinationHint: isEmailOnlyAccount
        ? maskEmail(user.email)
        : user.telegramUsername
          ? `@${user.telegramUsername.slice(0, 3)}***`
          : "Telegram",
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

    const attempts = challenge.attempts + 1;
    await db
      .update(loginChallengesTable)
      .set({ attempts })
      .where(eq(loginChallengesTable.id, challengeId));

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

    await db
      .update(loginChallengesTable)
      .set({ consumedAt: new Date() })
      .where(eq(loginChallengesTable.id, challengeId));

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

    res.json({
      id: updated.id, name: updated.name, email: updated.email,
      avatar: updated.avatar, role: updated.role, plan: updated.plan,
      bio: updated.bio ?? null,
      telegramId: updated.telegramId ?? null,
      telegramUsername: updated.telegramUsername ?? null,
      telegramFirstName: updated.telegramFirstName ?? null,
      telegramLastName: updated.telegramLastName ?? null,
      telegramPhotoUrl: updated.telegramPhotoUrl ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
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

    res.json({
      id: updated.id, name: updated.name, email: updated.email,
      avatar: updated.avatar, role: updated.role, plan: updated.plan,
      bio: updated.bio ?? null,
      telegramId: updated.telegramId ?? null,
      telegramUsername: updated.telegramUsername ?? null,
      telegramFirstName: updated.telegramFirstName ?? null,
      telegramLastName: updated.telegramLastName ?? null,
      telegramPhotoUrl: updated.telegramPhotoUrl ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Telegram miniapp link error");
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

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// V3: recovery is phone + SMS OTP only — no email, no Telegram. The user
// enters the phone number on file for the account; if it matches, a code
// goes out over SMS (lib/registrationBot.ts:sendResetCodeSms → lib/smsSender.ts).

router.post("/auth/forgot-password", authRateLimit("forgot_password"), async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      res.status(400).json({ error: "Phone number is required" });
      return;
    }

    // Generic response used whether or not the account exists (anti-enumeration).
    const genericMessage = "اگر این شماره ثبت شده باشد، کد بازیابی با پیامک ارسال می‌شود.";

    // Per-phone throttle — same bucket/limits as login failures, so this
    // can't be hammered to spam SMS at an arbitrary number.
    const rateKey = phoneKey(phone);
    const blocked = await hit(rateKey, PHONE_FAIL_LIMIT, PHONE_BLOCK_MS);
    if (!blocked.allowed) {
      res.status(429).json({
        error: "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
        code: "rate_limited",
        retryAfterSeconds: blocked.retryAfterSeconds,
      });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (!user) {
      res.json({ message: genericMessage });
      return;
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.update(usersTable)
      .set({ resetCodeHash: hashCode(code), resetCodeExpiresAt: expiresAt })
      .where(eq(usersTable.id, user.id));

    await sendResetCodeSms(phone, code, null);

    res.json({ message: genericMessage });
  } catch (err) {
    logger.error({ err }, "Forgot password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post("/auth/reset-password", authRateLimit("reset_password"), async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const { code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      res.status(400).json({ error: "phone, code and newPassword are required" });
      return;
    }
    if (String(newPassword).length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (
      !user ||
      !user.resetCodeHash ||
      !user.resetCodeExpiresAt ||
      isExpired(user.resetCodeExpiresAt) ||
      // مقایسه‌ی timing-safe؛ `!==` روی رشته به‌محض اولین بایت متفاوت
      // برمی‌گشت و همان اختلاف زمانی به مهاجم اجازه‌ی حدسِ بایت‌به‌بایت می‌داد.
      !verifyOtp(String(code), user.resetCodeHash)
    ) {
      res.status(400).json({ error: "Invalid or expired code" });
      return;
    }

    // موفق — شمارنده‌ی تلاش‌های ناموفقِ همین شماره پاک می‌شود (همان کلیدی که
    // بالا و در /auth/login استفاده می‌شود).
    await reset(phoneKey(phone));

    await db.update(usersTable)
      .set({
        passwordHash: await hashPassword(newPassword),
        resetCodeHash: null,
        resetCodeExpiresAt: null,
      })
      .where(eq(usersTable.id, user.id));

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
router.post("/auth/otp/sms/send", async (req, res) => {
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

    // شمارنده **قبل** از مقایسه بالا می‌رود، وگرنه یک درخواستِ نیمه‌کاره
    // تلاشِ رایگان می‌داد — همان قاعده‌ی /auth/login/verify.
    const attempts = row.attempts + 1;
    await db.update(smsOtpCodesTable).set({ attempts }).where(eq(smsOtpCodesTable.id, row.id));

    if (attempts > MAX_CODE_ATTEMPTS) {
      await db
        .update(smsOtpCodesTable)
        .set({ consumedAt: new Date() })
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
