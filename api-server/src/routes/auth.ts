import { Router } from "express";
import { db, usersTable, sessionsTable, botsTable, telegramLinkTokensTable, loginChallengesTable } from "@workspace/db";
import { eq, and, gt, count } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { normaliseEmail, emailEquals, isEmailUniqueViolation } from "../lib/email";
import { syncUserUpsert, syncSessionUpsert, syncSessionDelete } from "../lib/sheetsSync";
import { verifyTelegramAuth, verifyTelegramInitData } from "../lib/telegramAuth";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendTelegramMessage } from "../lib/telegram";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  codeExpiry,
  generateCode,
  hashCode,
  isExpired,
  normalizePhone,
  verifyCode as verifyOtp,
} from "../lib/otp";
import { sendLoginCode } from "../lib/registrationBot";
import { authRateLimit, hit, phoneKey, reset, PHONE_FAIL_LIMIT, PHONE_BLOCK_MS } from "../middleware/rateLimit";

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

export async function getUserIdFromToken(token: string): Promise<string | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, now)))
    .limit(1);
  return rows[0]?.userId ?? null;
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
    const sessionExpiry = sessionExpiresAt();
    await db.insert(sessionsTable).values({ token, userId: id, expiresAt: sessionExpiry });
    syncSessionUpsert({ token, userId: id, expiresAt: sessionExpiry });
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
    const phone = normalizePhone(req.body?.phone);
    const password = req.body?.password;
    if (!phone || typeof password !== "string" || password === "") {
      await genericFail();
      return;
    }

    // بلاک per-phone بعد از ۵ ورود ناموفق در ۱۵ دقیقه.
    const blocked = await hit(phoneKey(phone), PHONE_FAIL_LIMIT, PHONE_BLOCK_MS);
    if (!blocked.allowed) {
      res.status(429).json({
        error: "Too many attempts. Please try again later.",
        code: "rate_limited",
        retryAfterSeconds: blocked.retryAfterSeconds,
      });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      await genericFail();
      return;
    }
    if (user.status === "banned" || user.status === "suspended") {
      res.status(403).json({ error: "Account suspended" });
      return;
    }

    // حساب‌های ساخته‌شده پیش از این فیچر تلگرام ندارند و نمی‌توانند کد بگیرند.
    // نه اجازه‌ی عبور بدون عامل دوم، نه قفل‌شدن: یک وضعیت مشخص برمی‌گردد که UI
    // آن را به صفحه‌ی «حسابت باید به تلگرام وصل شود» با لینک عمیق تبدیل می‌کند،
    // و همان ماشین فاز ۳ را با purpose = "link" دوباره استفاده می‌کند.
    if (!user.telegramId) {
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

    await reset(phoneKey(phone));

    const code = generateCode();
    const challengeId = crypto.randomUUID();
    await db.insert(loginChallengesTable).values({
      id: challengeId,
      userId: user.id,
      codeHash: hashCode(code),
      codeExpiresAt: codeExpiry(),
    });
    await sendLoginCode(user.telegramId, code, null);

    logger.info({ userId: user.id }, "Login challenge issued");
    res.json({
      challengeId,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      // اشاره‌ی ماسک‌شده به مقصد، نه خودِ مقصد.
      destinationHint: user.telegramUsername
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

    await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));
    const token = generateToken(user.id);
    const loginSessionExpiry = sessionExpiresAt();
    await db.insert(sessionsTable).values({ token, userId: user.id, expiresAt: loginSessionExpiry });
    syncSessionUpsert({ token, userId: user.id, expiresAt: loginSessionExpiry });

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, user.id));

    logger.info({ userId: user.id }, "Login completed");
    res.json({ user: toAuthUser(user, botCount), token });
  } catch (err) {
    logger.error({ err }, "Login verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/logout
router.post("/auth/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token)).catch(() => {});
    syncSessionDelete(token);
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

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// V2: send a reset code through the PLATFORM bot (TELEGRAM_BOT_TOKEN) to the
// user's linked telegramId. Password recovery is a site-level account action,
// so it must not go through any tenant's bot token.

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    // Generic response used whether or not the account exists (anti-enumeration).
    const genericMessage =
      "اگر این ایمیل ثبت شده باشد و حساب تلگرام متصل داشته باشد، کد بازیابی از طریق تلگرام ارسال می‌شود.";

    const [user] = await db.select().from(usersTable).where(emailEquals(email)).limit(1);
    if (!user) {
      res.json({ message: genericMessage });
      return;
    }
    if (!user.telegramId) {
      // Honest, per the plan: there is no email channel, so recovery needs Telegram.
      res.status(400).json({
        error: "برای بازیابی رمز، ابتدا باید حساب تلگرام خود را وصل کنید",
        code: "no_telegram",
      });
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      res.status(503).json({ error: "Password recovery is not configured on this server" });
      return;
    }

    // Same generator/pattern as the per-bot admin code (8 hex chars, short-lived).
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.update(usersTable)
      .set({ resetCodeHash: hashCode(code), resetCodeExpiresAt: expiresAt })
      .where(eq(usersTable.id, user.id));

    await sendTelegramMessage(
      botToken,
      user.telegramId,
      `🔐 <b>کد بازیابی رمز IRForge</b>\n\n` +
        `کد شما: <code>${code}</code>\n` +
        `این کد تا ۱۵ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.`
    );

    res.json({ message: genericMessage });
  } catch (err) {
    logger.error({ err }, "Forgot password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      res.status(400).json({ error: "email, code and newPassword are required" });
      return;
    }
    if (String(newPassword).length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(emailEquals(email)).limit(1);
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

export default router;
