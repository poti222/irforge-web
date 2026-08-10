import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import dashboardRouter from "./dashboard.js";
import botsRouter from "./bots.js";
import marketplaceRouter from "./marketplace.js";
import plansRouter from "./plans.js";
import themesRouter from "./themes.js";
import adminRouter from "./admin.js";
import sheetsRouter from "./sheets.js";
import ticketsRouter from "./tickets.js";
import botTicketsRouter from "./botTickets.js";
import walletRouter from "./wallet.js";
import databaseRouter from "./database.js";
// FIX [Group 4]: Super Admin Code routes
import superAdminRouter from "./superAdmin.js";
// G8: اتصال با ربات (webhook دریافت آپدیت از تلگرام)
import telegramWebhookRouter from "./telegramWebhook.js";
// سیستم اعلان‌های جدید سایت (تریال و آینده)
import notificationsRouter from "./notifications.js";
// Phase 9: کدهای تخفیف
import discountsRouter from "./discounts.js";
// آپدیت‌های سایت (تغییرات و امکانات جدید + مودال یک‌باره روی داشبورد)
import updatesRouter from "./updates.js";
// ثبت‌نام پنج‌مرحله‌ای با تأیید شماره از طریق تلگرام
import registrationRouter from "./registration.js";
// مدیریت کاربران توسط super_admin (بازیابی، رمز، نقش، جعل هویت، ممیزی)
import superAdminUsersRouter from "./superAdminUsers.js";
// دسترسی مهمان (توکن جدا، پیش‌فرض-رد)
import guestRouter from "./guest.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(dashboardRouter);
router.use(botsRouter);
router.use(marketplaceRouter);
router.use(plansRouter);
router.use(themesRouter);
router.use(adminRouter);
router.use(sheetsRouter);
router.use(ticketsRouter);
router.use(botTicketsRouter);
router.use(walletRouter);
router.use(databaseRouter);
// FIX [Group 4]
router.use(superAdminRouter);
// G8
router.use(telegramWebhookRouter);
router.use(notificationsRouter);
router.use(discountsRouter);
router.use(updatesRouter);
router.use(registrationRouter);
router.use(superAdminUsersRouter);
router.use(guestRouter);

export default router;
