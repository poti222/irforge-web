/**
 * routes/superAdminUsers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * مدیریت کاربران برای super_admin: فهرست، جزئیات، ویرایش هویت، تنظیم رمز
 * تازه، قطع اتصال تلگرام (بازیابی فاز ۸)، جعل هویت و تاریخچه‌ی ممیزی.
 *
 * ── درباره‌ی «دیدن رمز کاربر» ────────────────────────────────────────────────
 * چنین چیزی اینجا وجود ندارد و نباید ساخته شود. رمزها به‌صورت هش bcrypt ذخیره
 * می‌شوند؛ این یک تبدیل **عمداً یک‌طرفه** است و مرحله‌ی «رمزگشایی» ندارد.
 * خواندن رمز ذخیره‌شده یعنی ذخیره‌ی برگشت‌پذیر، و آن یعنی:
 *
 *   - یک نشتِ دیتابیس، رمز خامِ همه‌ی مشتریان را لو می‌دهد — و چون مردم رمز
 *     تکراری استفاده می‌کنند، ایمیل و حساب بانکی‌شان را هم.
 *   - هیچ‌وقت نمی‌شد به کاربر گفت رمزش خصوصی است، چون نبود.
 *   - هر ادعای «ادمین سفارشم را عوض کرد / کیف پولم را خالی کرد» بی‌پاسخ
 *     می‌ماند، چون کارکنان *می‌توانستند* به‌جای هرکسی وارد شوند.
 *
 * نیازِ واقعیِ پشت آن درخواست دو چیز است و هر دو اینجا هست: super_admin
 * می‌تواند رمز تازه **بگذارد**، و می‌تواند با یک نشستِ کاملاً ممیزی‌شده
 * **جعل هویت** کند تا ببیند کاربر چه می‌بیند — بدون اینکه هیچ‌وقت به
 * اعتبارنامه‌اش دست بزند.
 *
 * **هیچ پاسخی در این فایل رمز یا هش رمز برنمی‌گرداند.**
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  usersTable,
  sessionsTable,
  botsTable,
  ticketsTable,
  adminAuditLogTable,
} from "@workspace/db";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normaliseEmail, emailEquals } from "../lib/email";
import { requireSuperAdmin } from "./auth";
import { hashPassword } from "../lib/password";
import { writeAudit } from "../lib/audit";
import { sendTelegramMessage } from "../lib/telegram";
import { syncSessionDelete } from "../lib/sheetsSync";

const router = Router();

/** حداکثر عمر نشستِ جعل هویت. */
const IMPERSONATION_TTL_MS = 30 * 60 * 1000;
const PASSWORD_MIN = 8;

/**
 * شکل عمومی کاربر برای پنل ادمین.
 * `passwordHash` عمداً هرگز انتخاب نمی‌شود — نه اینکه بعداً حذف شود.
 */
function publicUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    phoneVerified: u.phoneVerified,
    role: u.role,
    status: u.status,
    plan: u.plan,
    avatar: u.avatar,
    telegramId: u.telegramId,
    telegramUsername: u.telegramUsername,
    telegramFirstName: u.telegramFirstName,
    telegramLastName: u.telegramLastName,
    profileComplete: u.profileComplete,
    createdAt: u.createdAt.toISOString(),
    lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
  };
}

function typedReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 5) {
    throw new ValidationError("A written reason is required (at least 5 characters)");
  }
  return value.trim().slice(0, 500);
}

class ValidationError extends Error {}

// ─── GET /api/superadmin/users ───────────────────────────────────────────────
router.get("/superadmin/users", requireSuperAdmin, async (req: any, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 25));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const role = typeof req.query.role === "string" ? req.query.role : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";

    const filters: any[] = [];
    if (search) {
      const like = `%${search}%`;
      filters.push(
        or(
          ilike(usersTable.name, like),
          ilike(usersTable.email, like),
          ilike(usersTable.phone, like),
          ilike(usersTable.telegramUsername, like),
        ),
      );
    }
    if (role) filters.push(eq(usersTable.role, role));
    if (status) filters.push(eq(usersTable.status, status));
    const where = filters.length ? and(...filters) : undefined;

    const rows = await db
      .select()
      .from(usersTable)
      .where(where)
      .orderBy(desc(usersTable.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(where);

    // تعداد بات هر کاربر با یک کوئری گروهی، نه n کوئری.
    const counts = new Map<string, number>();
    if (rows.length) {
      const botRows = await db
        .select({ userId: botsTable.userId, n: sql<number>`count(*)::int` })
        .from(botsTable)
        .groupBy(botsTable.userId);
      for (const b of botRows) counts.set(b.userId, Number(b.n));
    }

    res.json({
      items: rows.map((u) => ({ ...publicUser(u), botCount: counts.get(u.id) ?? 0 })),
      page,
      perPage,
      total,
    });
  } catch (err) {
    logger.error({ err }, "superadmin list users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/superadmin/users/:id ───────────────────────────────────────────
router.get("/superadmin/users/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [{ value: botCount }] = await db
      .select({ value: count() })
      .from(botsTable)
      .where(eq(botsTable.userId, user.id));
    const [{ value: ticketCount }] = await db
      .select({ value: count() })
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, user.id));
    const [{ value: sessionCount }] = await db
      .select({ value: count() })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, user.id));

    res.json({
      user: publicUser(user),
      activity: { botCount, ticketCount, sessionCount },
    });
  } catch (err) {
    logger.error({ err }, "superadmin get user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/superadmin/users/:id/audit ─────────────────────────────────────
// لاگی که کسی نتواند بخواندش تزئین است.
router.get("/superadmin/users/:id/audit", requireSuperAdmin, async (req: any, res) => {
  try {
    const rows = await db
      .select()
      .from(adminAuditLogTable)
      .where(eq(adminAuditLogTable.targetUserId, req.params.id))
      .orderBy(desc(adminAuditLogTable.createdAt))
      .limit(100);

    const actorIds = [...new Set(rows.map((r) => r.actorUserId))];
    const actors = actorIds.length
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(or(...actorIds.map((id) => eq(usersTable.id, id))))
      : [];
    const byId = new Map(actors.map((a) => [a.id, a]));

    res.json(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        reason: r.reason,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
        actor: byId.get(r.actorUserId) ?? { id: r.actorUserId, name: null, email: null },
      })),
    );
  } catch (err) {
    logger.error({ err }, "superadmin audit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/superadmin/users/:id ─────────────────────────────────────────
// هویت: نام، ایمیل، شماره. تغییر ایمیل یا شماره فلگ تأییدِ متناظر را پاک
// می‌کند — ویرایشِ ادمین تأیید نیست.
router.patch("/superadmin/users/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    if (typeof req.body?.name === "string" && req.body.name.trim() !== "") {
      patch.name = req.body.name.trim().slice(0, 160);
      changed.push("name");
    }
    if (typeof req.body?.email === "string" && req.body.email.trim() !== "") {
      const email = normaliseEmail(req.body.email);
      if (email !== normaliseEmail(user.email)) {
        const [taken] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(emailEquals(email))
          .limit(1);
        if (taken) {
          res.status(409).json({ error: "That email belongs to another user" });
          return;
        }
        patch.email = email;
        changed.push("email");
      }
    }
    if (typeof req.body?.phone === "string") {
      const phone = req.body.phone.trim() || null;
      if (phone !== user.phone) {
        patch.phone = phone;
        // ادمین شماره را تأیید نکرده، فقط تایپش کرده.
        patch.phoneVerified = false;
        changed.push("phone");
      }
    }

    if (changed.length === 0) {
      res.json({ user: publicUser(user) });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, user.id))
      .returning();

    await writeAudit({
      actorUserId: req.userId,
      action: "identity_updated",
      targetUserId: user.id,
      reason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null,
      metadata: { fields: changed },
    });

    res.json({ user: publicUser(updated) });
  } catch (err) {
    logger.error({ err }, "superadmin patch user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/superadmin/users/:id/password ─────────────────────────────────
// رمز تازه می‌گذارد. رمز هیچ‌جا برگردانده نمی‌شود.
router.post("/superadmin/users/:id/password", requireSuperAdmin, async (req: any, res) => {
  try {
    const reason = typedReason(req.body?.reason);
    const password = req.body?.password;
    if (typeof password !== "string" || password.length < PASSWORD_MIN) {
      res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN} characters` });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(usersTable.id, user.id));

    // هر نشست فعال باطل می‌شود: رمز عوض شده و نشست‌های قدیمی نباید زنده بمانند.
    const killed = await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.userId, user.id))
      .returning({ token: sessionsTable.token });
    for (const s of killed) syncSessionDelete(s.token);

    await writeAudit({
      actorUserId: req.userId,
      action: "password_set",
      targetUserId: user.id,
      reason,
      metadata: { sessionsRevoked: killed.length },
    });

    // این اطلاع‌رسانی اختیاری نیست: تغییر رمزی که صاحب حساب از آن خبر ندارد،
    // از دید او با یک نفوذ فرقی ندارد.
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken && user.telegramId) {
      await sendTelegramMessage(
        botToken,
        user.telegramId,
        "🔐 <b>رمز عبور حساب شما توسط مدیر تغییر کرد</b>\n\n" +
          "همه‌ی نشست‌های فعال بسته شدند. اگر این تغییر را انتظار نداشتید، فوراً با پشتیبانی تماس بگیرید.",
      ).catch(() => {});
    }

    logger.info({ actor: req.userId, target: user.id }, "Admin set user password");
    res.json({ ok: true, sessionsRevoked: killed.length });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "superadmin set password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/superadmin/users/:id/telegram-reset ───────────────────────────
// بازیابی فاز ۸: اتصال تلگرام را پاک می‌کند تا کاربر بتواند حساب تازه‌ای وصل کند.
//
// ⚠️ هرگز self-service نیست. اگر کاربرِ خارج‌شده می‌توانست خودش اتصال تلگرامش را
// پاک کند، مهاجمی که رمز را دزدیده راهی برای **حذف کاملِ عامل دوم** داشت.
router.post("/superadmin/users/:id/telegram-reset", requireSuperAdmin, async (req: any, res) => {
  try {
    const reason = typedReason(req.body?.reason);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await db
      .update(usersTable)
      .set({
        telegramId: null,
        telegramUsername: null,
        telegramFirstName: null,
        telegramLastName: null,
        telegramPhotoFileId: null,
        telegramPhotoUrl: null,
      })
      .where(eq(usersTable.id, user.id));

    await writeAudit({
      actorUserId: req.userId,
      action: "telegram_reset",
      targetUserId: user.id,
      reason,
      metadata: { previousTelegramUsername: user.telegramUsername },
    });

    logger.info({ actor: req.userId, target: user.id }, "Admin reset user Telegram link");
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "superadmin telegram-reset error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/superadmin/users/:id/role ─────────────────────────────────────
router.post("/superadmin/users/:id/role", requireSuperAdmin, async (req: any, res) => {
  try {
    const role = req.body?.role;
    if (!["user", "admin", "super_admin"].includes(role)) {
      res.status(400).json({ error: "Unknown role" });
      return;
    }
    const reason = typedReason(req.body?.reason);

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ role })
      .where(eq(usersTable.id, user.id))
      .returning();

    await writeAudit({
      actorUserId: req.userId,
      action: "role_changed",
      targetUserId: user.id,
      reason,
      metadata: { from: user.role, to: role },
    });

    res.json({ user: publicUser(updated) });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "superadmin role error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/superadmin/users/:id/revoke-sessions ──────────────────────────
router.post("/superadmin/users/:id/revoke-sessions", requireSuperAdmin, async (req: any, res) => {
  try {
    const reason = typedReason(req.body?.reason);
    const killed = await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.userId, req.params.id))
      .returning({ token: sessionsTable.token });
    for (const s of killed) syncSessionDelete(s.token);

    await writeAudit({
      actorUserId: req.userId,
      action: "sessions_revoked",
      targetUserId: req.params.id,
      reason,
      metadata: { count: killed.length },
    });

    res.json({ ok: true, revoked: killed.length });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "superadmin revoke-sessions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/superadmin/users/:id/impersonate ──────────────────────────────
// نشست کوتاه‌مدت و صریحاً برچسب‌خورده. جعل هویت برای **دیدن** است، نه انجام
// دادن: اقدامات مخرب در میدل‌ور مسدود می‌شوند (ببینید middleware/impersonation).
router.post("/superadmin/users/:id/impersonate", requireSuperAdmin, async (req: any, res) => {
  try {
    const reason = typedReason(req.body?.reason);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // پیشوند `imp_` نشست را در همان نگاه اول قابل تشخیص می‌کند، و میدل‌ور
    // احراز هویت از روی همین پیشوند حالت جعل هویت را می‌فهمد.
    const token = `imp_${req.userId}_${crypto.randomBytes(24).toString("hex")}`;
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);
    await db.insert(sessionsTable).values({ token, userId: user.id, expiresAt });

    await writeAudit({
      actorUserId: req.userId,
      action: "impersonation_started",
      targetUserId: user.id,
      reason,
      metadata: { expiresAt: expiresAt.toISOString() },
    });

    logger.warn({ actor: req.userId, target: user.id }, "Impersonation session issued");
    res.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: publicUser(user),
      impersonated: true,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "superadmin impersonate error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
