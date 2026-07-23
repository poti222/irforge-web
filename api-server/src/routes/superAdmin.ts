/**
 * routes/superAdmin.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX [Group 4]: Super Admin Code
 *
 * Super Admin Code یک کد ثابت در env (SUPER_ADMIN_CODE) است.
 * با وارد کردنش، role کاربر به super_admin تغییر می‌کند و
 * route /super-admin در frontend باز می‌شود.
 *
 * نکته امنیتی: این کد باید طولانی و تصادفی باشد (مثلاً 32 کاراکتر hex).
 * هرگز hardcode نکن — فقط از env بخون.
 *
 * Route های این فایل را در routes/index.ts اضافه کن:
 *   import superAdminRouter from "./superAdmin";
 *   app.use("/api", superAdminRouter);
 */

import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { syncUserUpsert } from "../lib/sheetsSync";

const router = Router();

// ─── POST /api/auth/super-admin-code ─────────────────────────────────────────
// کاربر وارد می‌کنه، role می‌شه super_admin

router.post("/auth/super-admin-code", requireAuth, async (req: any, res) => {
  try {
    const superAdminCode = process.env.SUPER_ADMIN_CODE;
    if (!superAdminCode) {
      res.status(503).json({ error: "Super admin code is not configured" });
      return;
    }

    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: "Code is required" });
      return;
    }

    // مقایسه امن با timingSafeEqual (جلوگیری از timing attack)
    const expected = Buffer.from(superAdminCode);
    const received = Buffer.from(String(code));
    let match = false;
    if (expected.length === received.length) {
      const crypto = await import("crypto");
      match = crypto.timingSafeEqual(expected, received);
    }

    if (!match) {
      // تأخیر عمدی برای جلوگیری از brute force
      await new Promise((r) => setTimeout(r, 800));
      res.status(401).json({ error: "Invalid code" });
      return;
    }

    // آپدیت role به super_admin
    const [updated] = await db
      .update(usersTable)
      .set({ role: "super_admin" })
      .where(eq(usersTable.id, req.userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    syncUserUpsert({
      id: updated.id, name: updated.name, email: updated.email,
      role: updated.role, plan: updated.plan, status: updated.status,
      bio: updated.bio, telegramUsername: updated.telegramUsername,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    });

    logger.info({ userId: req.userId }, "User elevated to super_admin");

    res.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        plan: updated.plan,
      },
    });
  } catch (err) {
    logger.error({ err }, "Super admin code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/revoke-super-admin ───────────────────────────────────────
// برگشت به role عادی (برای تست)

router.post("/auth/revoke-super-admin", requireAuth, async (req: any, res) => {
  try {
    const [updated] = await db
      .update(usersTable)
      .set({ role: "user" })
      .where(eq(usersTable.id, req.userId))
      .returning();

    res.json({ success: true, role: updated?.role });
  } catch (err) {
    logger.error({ err }, "Revoke super admin error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
