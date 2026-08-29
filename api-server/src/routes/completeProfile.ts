/**
 * routes/completeProfile.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mandatory Profile Completion & Identity System — Phase 2.
 *
 * One endpoint, called repeatedly with partial bodies: the frontend wizard
 * (complete-profile.tsx) saves each field as soon as the user confirms it,
 * not all at once at the end — so a closed tab never loses progress. Every
 * field is independently optional here; at least one must be present.
 *
 * Telegram identity is deliberately absent from this body — it only ever
 * comes from the existing bot-linking flow (`/auth/telegram/link/start` +
 * webhook), never user-typed. Same for `oauthProvider`, set once at
 * account-creation and never user-editable.
 */
import { Router } from "express";
import { db, usersTable, botsTable } from "@workspace/db";
import { eq, and, ne, count } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAuth, toAuthUser } from "./auth";
import { checkProfile } from "../lib/profile";
import { normaliseEmail, emailEquals } from "../lib/email";
import { normalizePhone } from "../lib/otp";
import { hashPassword } from "../lib/password";
import { nameGenderMismatch, isFakeName } from "../lib/identityHeuristics";
import { authRateLimit } from "../middleware/rateLimit";
import { recentSmsRegisterProof } from "./registration";

const router = Router();

const NAME_MAX = 80;
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;
const TWO_FACTOR_METHODS = ["email", "sms", "telegram"] as const;

interface FieldError {
  field: string;
  error: string;
  code: string;
}

/** status: 400 for a malformed value, 409 only for a genuine uniqueness conflict. */
class FieldValidationError extends Error {
  field: string;
  code: string;
  status: 400 | 409;
  constructor(field: string, message: string, code: string, status: 400 | 409 = 400) {
    super(message);
    this.field = field;
    this.code = code;
    this.status = status;
  }
}

router.patch("/auth/complete-profile", authRateLimit("complete_profile"), requireAuth, async (req: any, res) => {
  try {
    const [current] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    if (!current) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    const hasField = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    if (!["name", "gender", "email", "phone", "platformUsername", "password", "twoFactorEnabled", "twoFactorMethod"]
      .some(hasField)) {
      res.status(400).json({ error: "No fields provided" });
      return;
    }

    if (hasField("name")) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > NAME_MAX) {
        throw new FieldValidationError("name", "Name is required", "invalid_name");
      }
      if (isFakeName(name)) {
        throw new FieldValidationError("name", "This does not look like a real name", "fake_name");
      }
      updates.name = name;
    }

    if (hasField("gender")) {
      if (body.gender !== "male" && body.gender !== "female") {
        throw new FieldValidationError("gender", "Gender must be 'male' or 'female'", "invalid_gender");
      }
      updates.gender = body.gender;
    }

    if (hasField("email")) {
      const email = normaliseEmail(body.email);
      if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
        throw new FieldValidationError("email", "Email is not valid", "invalid_email");
      }
      const [taken] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(emailEquals(email), ne(usersTable.id, req.userId)))
        .limit(1);
      if (taken) throw new FieldValidationError("email", "Email is already taken", "email_taken", 409);
      updates.email = email;
    }

    if (hasField("phone")) {
      const phone = normalizePhone(body.phone);
      if (!phone) throw new FieldValidationError("phone", "Phone number is not valid", "invalid_phone");
      const [taken] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.phone, phone), ne(usersTable.id, req.userId)))
        .limit(1);
      if (taken) throw new FieldValidationError("phone", "Phone number is already taken", "phone_taken", 409);
      // یک عدد تایپ‌شده به‌تنهایی اثباتِ مالکیت نیست — هرکسی می‌توانست شماره‌ی
      // دیگری را اینجا بنویسد و phoneVerified=true بگیرد. همان اثباتِ
      // ثبت‌نامِ پیامکی (recentSmsRegisterProof در routes/registration.ts:
      // یک ردیفِ تازه‌مصرف‌شده‌ی smsOtpCodesTable با purpose="register" برای
      // همین شماره) لازم است — فرانت باید پیش از این PATCH، همان
      // POST /auth/otp/sms/send + POST /auth/otp/sms/verify را زده باشد.
      if (!(await recentSmsRegisterProof(phone))) {
        throw new FieldValidationError("phone", "Phone number verification was not found or has expired", "phone_not_verified");
      }
      updates.phone = phone;
      updates.phoneVerified = true;
    }

    if (hasField("platformUsername")) {
      const username = typeof body.platformUsername === "string" ? body.platformUsername.trim().toLowerCase() : "";
      if (!USERNAME_RE.test(username)) {
        throw new FieldValidationError(
          "platformUsername",
          "Username must be 3-20 characters: lowercase letters, digits, underscore",
          "invalid_username",
        );
      }
      const [taken] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.platformUsername, username), ne(usersTable.id, req.userId)))
        .limit(1);
      if (taken) {
        throw new FieldValidationError("platformUsername", "Username is already taken", "username_taken", 409);
      }
      updates.platformUsername = username;
    }

    if (hasField("password")) {
      if (typeof body.password !== "string" || body.password.length < PASSWORD_MIN) {
        throw new FieldValidationError(
          "password",
          `Password must be at least ${PASSWORD_MIN} characters`,
          "invalid_password",
        );
      }
      updates.passwordHash = await hashPassword(body.password);
    }

    if (hasField("twoFactorEnabled") || hasField("twoFactorMethod")) {
      const enabled = hasField("twoFactorEnabled") ? Boolean(body.twoFactorEnabled) : current.twoFactorEnabled;
      const method = hasField("twoFactorMethod") ? body.twoFactorMethod : current.twoFactorMethod;
      if (enabled && !TWO_FACTOR_METHODS.includes(method)) {
        throw new FieldValidationError(
          "twoFactorMethod",
          "twoFactorMethod must be one of: email, sms, telegram",
          "invalid_two_factor_method",
        );
      }
      updates.twoFactorEnabled = enabled;
      updates.twoFactorMethod = enabled ? method : null;
    }

    // Gender/name heuristic — only re-evaluated when this request actually
    // touches one of the two fields, using the effective (new-or-existing)
    // values. Re-running it on every unrelated field update (e.g. just
    // setting platformUsername) would let an admin's manual flag-clear be
    // silently undone by the next unrelated PATCH.
    if (hasField("name") || hasField("gender")) {
      const effectiveName = (updates.name as string | undefined) ?? current.name;
      const effectiveGender = (updates.gender as "male" | "female" | undefined) ?? current.gender;
      if (effectiveGender && nameGenderMismatch(effectiveName, effectiveGender)) {
        updates.flaggedForReview = true;
        updates.flagReason = "gender_mismatch";
        updates.flaggedAt = new Date();
      }
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, req.userId))
      .returning();

    // منبع حقیقتِ profile_complete همیشه checkProfile() است — این کش را با
    // آن همگام نگه می‌داریم، و اولین باری که واقعاً کامل می‌شود identityCompletedAt
    // را یک‌بار برای همیشه ثبت می‌کنیم (هرگز دوباره آپدیت نمی‌شود).
    const profile = checkProfile(updated);
    const cacheUpdates: Record<string, unknown> = {};
    if (updated.profileComplete !== profile.complete) cacheUpdates.profileComplete = profile.complete;
    if (profile.complete && !updated.identityCompletedAt) cacheUpdates.identityCompletedAt = new Date();

    let finalUser = updated;
    if (Object.keys(cacheUpdates).length > 0) {
      [finalUser] = await db
        .update(usersTable)
        .set(cacheUpdates)
        .where(eq(usersTable.id, req.userId))
        .returning();
    }

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, req.userId));

    res.json(toAuthUser(finalUser, botCount));
  } catch (err) {
    if (err instanceof FieldValidationError) {
      const body: FieldError = { field: err.field, error: err.message, code: err.code };
      res.status(err.status).json(body);
      return;
    }
    logger.error({ err }, "complete-profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
