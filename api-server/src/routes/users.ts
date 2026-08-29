import { logger } from "../lib/logger";
import { normaliseEmail, emailEquals } from "../lib/email";
import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { requireAuth } from "./auth";
import { syncUserUpsert } from "../lib/sheetsSync";
import { hashPassword, verifyPassword } from "../lib/password";
import { getTelegramFilePath } from "../lib/telegram";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH /api/users/profile
router.patch("/users/profile", requireAuth, async (req: any, res) => {
  try {
    const { name, avatar, bio, telegramUsername, email } = req.body;
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (bio !== undefined) updateData.bio = bio;
    if (telegramUsername !== undefined) updateData.telegramUsername = telegramUsername;
    // Z8: email is editable, with format + uniqueness checks.
    if (email !== undefined) {
      const normalized = normaliseEmail(email);
      if (!EMAIL_RE.test(normalized)) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }
      const [clash] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(emailEquals(normalized), ne(usersTable.id, req.userId)))
        .limit(1);
      if (clash) {
        res.status(409).json({ error: "This email is already in use" });
        return;
      }
      updateData.email = normalized;
    }
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, req.userId)).returning();
    syncUserUpsert({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, plan: updated.plan, status: updated.status, bio: updated.bio, telegramUsername: updated.telegramUsername, createdAt: updated.createdAt, updatedAt: updated.updatedAt });
    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      avatar: updated.avatar,
      role: updated.role,
      plan: updated.plan,
      botCount: 0,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Update profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * تنظیمات تحویل اعلان.
 *
 * عمداً یک endpoint جدا از `PATCH /users/profile` است و نه یک فیلد دیگر در
 * آن: شکل پاسخ پروفایل در `@workspace/api-spec` تعریف شده و کلاینتِ تولیدشده
 * از رویش ساخته می‌شود؛ افزودن فیلد به آن یعنی دست‌زدن به قرارداد API برای
 * چیزی که فقط یک سوئیچ در صفحه‌ی پروفایل است.
 */
router.get("/users/notification-prefs", requireAuth, async (req: any, res) => {
  try {
    const [user] = await db
      .select({ notifyTelegram: usersTable.notifyTelegram, telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // `telegramLinked` را هم برمی‌گردانیم چون سوئیچ بدون اتصال تلگرام بی‌معناست
    // و فرانت باید بتواند به‌جای یک کلید بی‌اثر، دلیلش را نشان دهد.
    res.json({ notifyTelegram: user.notifyTelegram, telegramLinked: Boolean(user.telegramId) });
  } catch (err) {
    logger.error({ err }, "Get notification prefs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/notification-prefs", requireAuth, async (req: any, res) => {
  try {
    const { notifyTelegram } = req.body;
    if (typeof notifyTelegram !== "boolean") {
      res.status(400).json({ error: "notifyTelegram must be a boolean" });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ notifyTelegram })
      .where(eq(usersTable.id, req.userId))
      .returning({ notifyTelegram: usersTable.notifyTelegram, telegramId: usersTable.telegramId });
    res.json({ notifyTelegram: updated.notifyTelegram, telegramLinked: Boolean(updated.telegramId) });
  } catch (err) {
    logger.error({ err }, "Update notification prefs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * فاز ۱۱ (identityverificationspec.md): بستنِ بنرِ پیشنهادِ تریالِ داشبورد.
 * یک سوئیچِ یک‌باره است، پس مثلِ notification-prefs بالا endpointی جدا از
 * PATCH /users/profile — نه فیلدی روی همان.
 */
router.post("/users/trial-offer-dismissed", requireAuth, async (req: any, res) => {
  try {
    await db.update(usersTable).set({ hasSeenTrialOffer: true }).where(eq(usersTable.id, req.userId));
    res.json({ hasSeenTrialOffer: true });
  } catch (err) {
    logger.error({ err }, "Dismiss trial offer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/users/password
router.patch("/users/password", requireAuth, async (req: any, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Current and new password are required" });
      return;
    }
    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    const user = users[0];
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    await db.update(usersTable).set({ passwordHash: await hashPassword(newPassword) }).where(eq(usersTable.id, req.userId));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Change password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:id/telegram-photo
// G8: عکس پروفایلی که از طریق «اتصال با ربات» گرفته شده فقط یک file_id تلگرامه،
// نه یک URL عمومی. این روت با TELEGRAM_BOT_TOKEN فایل رو از تلگرام می‌گیره و
// خودش بایت‌ها رو serve می‌کنه — هرگز URL واقعی تلگرام (که توکن بات توش هست)
// رو ریدایرکت یا لو نمی‌ده. بدون auth چون از تگ <img> صدا زده می‌شه (نمی‌تونه
// هدر Authorization بفرسته)، دقیقاً مثل هر آواتار عمومی دیگه‌ای توی اپ.
router.get("/users/:id/telegram-photo", async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      res.status(404).end();
      return;
    }
    const [user] = await db
      .select({ fileId: usersTable.telegramPhotoFileId })
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!user?.fileId) {
      res.status(404).end();
      return;
    }

    const filePath = await getTelegramFilePath(botToken, user.fileId);
    if (!filePath) {
      res.status(404).end();
      return;
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileRes.ok || !fileRes.body) {
      res.status(502).end();
      return;
    }

    res.set("Content-Type", fileRes.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "private, max-age=3600");
    const buf = Buffer.from(await fileRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    logger.error({ err }, "Telegram photo proxy error");
    res.status(500).end();
  }
});

export default router;
