import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import dashboardRouter from "./dashboard.js";
import botsRouter from "./bots.js";
import marketplaceRouter from "./marketplace.js";
import plansRouter from "./plans.js";
import productsRouter from "./products.js";
import themesRouter from "./themes.js";
import adminRouter from "./admin.js";
import sheetsRouter from "./sheets.js";
import ticketsRouter from "./tickets.js";
import botTicketsRouter from "./botTickets.js";
import walletRouter from "./wallet.js";
import databaseRouter from "./database.js";
// IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۱ — سوییچِ سوپرادمین
// برایِ Sheets/Postgresِ هر entity، به‌جایِ SQLِ دستی.
import cutoverFlagsRouter from "./cutoverFlags.js";
// IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۲ — مهاجرتِ واقعیِ
// دیتای یک بات از Sheets به Postgres (کنارِ دکمه‌های Cutover Flags بالا).
import sheetsImportRouter from "./sheetsImport.js";
// FIX [Group 4]: Super Admin Code routes
import superAdminRouter from "./superAdmin.js";
// G8: اتصال با ربات (webhook دریافت آپدیت از تلگرام)
import telegramWebhookRouter from "./telegramWebhook.js";
import uploadSessionsRouter from "./uploadSessions.js";
// سیستم اعلان‌های جدید سایت (تریال و آینده)
import notificationsRouter from "./notifications.js";
// Phase 9: کدهای تخفیف
import discountsRouter from "./discounts.js";
// آپدیت‌های سایت (تغییرات و امکانات جدید + مودال یک‌باره روی داشبورد)
import updatesRouter from "./updates.js";
// ثبت‌نام پنج‌مرحله‌ای با تأیید شماره از طریق تلگرام
import registrationRouter from "./registration.js";
// دروازه‌ی اجباریِ تکمیل هویت — PATCH /auth/complete-profile
import completeProfileRouter from "./completeProfile.js";
// مدیریت کاربران توسط super_admin (بازیابی، رمز، نقش، جعل هویت، ممیزی)
import superAdminUsersRouter from "./superAdminUsers.js";
// عیب‌یابیِ دسترسیِ Sheets برای super_admin (pg-migration checkpoint، آیتم ۲)
import superAdminDiagnosticsRouter from "./superAdminDiagnostics.js";
// دسترسی مهمان (توکن جدا، پیش‌فرض-رد)
import guestRouter from "./guest.js";
// مهاجرت پنل ادمین بات به سایت — تنظیمات بات روی تب `bot_settings` شیت تننت
import botSettingsRouter from "./botSettings.js";
import botPanelsRouter from "./botPanels.js";
import botMediaRouter from "./botMedia.js";
import uploadsRouter from "./uploads.js";
import schoolEnrollmentRouter from "./schoolEnrollment.js";
import botFormsRouter from "./botForms.js";
import botCommandsRouter from "./botCommands.js";
import botAdminsRouter from "./botAdmins.js";
import botUsersRouter from "./botUsers.js";
import botBroadcastRouter from "./botBroadcast.js";
import botOrdersRouter from "./botOrders.js";
import botPluginsRouter from "./botPlugins.js";
// داده‌ی پلاگین‌های تازه (باشگاه، رزرو، اشتراک، قرعه‌کشی، نظرسنجی، دریپ، CRM)
// روی یک لایه‌ی CRUD عمومی — نگاه کن lib/pluginCollections.ts
import botPluginDataRouter from "./botPluginData.js";
// لایسنس پلاگین‌ها: نمای حساب‌محور + انتقال بین بات‌ها
import pluginLicencesRouter from "./pluginLicences.js";
// یادداشتِ انتشارِ هر نسخه‌ی پلاگین — نگاه کن lib/marketplaceSync.ts هم
import pluginReleaseNotesRouter from "./pluginReleaseNotes.js";
import botObjectsRouter from "./botObjects.js";
import botRelationsRouter from "./botRelations.js";
import botWorkflowsRouter from "./botWorkflows.js";
import botLanguageRouter from "./botLanguage.js";
import botBackupRouter from "./botBackup.js";
import botSupportTicketsRouter from "./botSupportTickets.js";
import botHealthRouter from "./botHealth.js";
import botSubscriptionRouter from "./botSubscription.js";
import internalTicketNotifyRouter from "./internalTicketNotify.js";
import bookingRouter from "./booking.js";
import botFormsProRouter from "./botFormsPro.js";
import addressesRouter from "./addresses.js";
import gameServersRouter from "./gameServers.js";
import dripRouter from "./drip.js";
import crmRouter from "./crm.js";
import surveyRouter from "./survey.js";
import giveawayRouter from "./giveaway.js";
import supportLinksRouter from "./supportLinks.js";
import currencyDisplayRouter from "./currencyDisplay.js";
import exchangeRateRouter from "./exchangeRate.js";
import captchaRouter from "./captcha.js";
import loyaltySettingsRouter from "./loyaltySettings.js";
import catalogRouter from "./catalog.js";
import botWalletRouter from "./botWallet.js";
import translatePostRouter from "./translatePost.js";
import postboxRouter from "./postbox.js";
import walletTopupRouter from "./walletTopup.js";
import walletTopupSmsWebhookRouter from "./walletTopupSmsWebhook.js";
import paymentSmsWebhookRouter from "./paymentSmsWebhook.js";
import internalBotPaymentsRouter from "./internalBotPayments.js";
import botPaymentChannelsRouter from "./botPaymentChannels.js";
import adminCardAutoConfirmRouter from "./adminCardAutoConfirm.js";
import guidedFlowRouter from "./guidedFlow.js";
// بخش "/schools" فاز ۱ — پروفایلِ مدرسه‌ای، کدهای معرف، مدیریتِ مدرسه
import schoolsRouter from "./schools.js";
// بخش "/schools" فاز ۱ — لغت‌نامه/جزوه/کتاب/فرمول
import schoolContentRouter from "./schoolContent.js";
// بخش "/schools" فاز ۲ — کلاس‌ها/برنامه‌ها/اعلامیه‌ها/مشاور/والد
import schoolClassesRouter from "./schoolClasses.js";
import schoolProgramsRouter from "./schoolPrograms.js";
import schoolAnnouncementsRouter from "./schoolAnnouncements.js";
import schoolCounselorRouter from "./schoolCounselor.js";
import schoolGuardianshipsRouter from "./schoolGuardianships.js";
// بخش "/schools" فاز ۳ — تکالیفِ معلم/ارسالِ دانش‌آموز
import schoolAssignmentsRouter from "./schoolAssignments.js";
// بخش "/schools" فاز ۴ — گزارش/برنامه/چتِ مشاور، بانکِ سؤال، آزمون
import schoolCounselorReportsRouter from "./schoolCounselorReports.js";
import schoolQuestionsRouter from "./schoolQuestions.js";
import schoolExamsRouter from "./schoolExams.js";
// بخش "/schools" فاز ۵ — ارتباط با مدیر/معلم
import schoolAdminMessagesRouter from "./schoolAdminMessages.js";
import schoolTeacherMessagesRouter from "./schoolTeacherMessages.js";
// بخش "/schools" فاز ۶ — حضور و غیاب، نمره‌نامه‌ی ترکیبی، اخطار/هشدارِ دانش‌آموز
import schoolAttendanceRouter from "./schoolAttendance.js";
import schoolGradebookRouter from "./schoolGradebook.js";
import schoolStudentAlertsRouter from "./schoolStudentAlerts.js";
// بخش "/schools" فاز ۷ — استخرِ توکنِ بات (سوپرادمین) + خریدِ باتِ اطلاع‌رسانیِ مدرسه + اتصالِ تلگرام
import schoolBotPoolRouter from "./schoolBotPool.js";
import schoolBotsRouter from "./schoolBots.js";
import schoolBotWebhookRouter from "./schoolBotWebhook.js";
import schoolNotificationsRouter from "./schoolNotificationTriggers.js";
// بخش "/schools" فاز ۹ — وضعیتِ خوانده‌شدنِ رشته‌ها + لاگِ رخدادهایِ مدیریتی
import schoolMessageReadStateRouter from "./schoolMessageReadState.js";
import schoolAuditLogRouter from "./schoolAuditLog.js";
// تخصیصِ معلم↔درس (کنترلِ دسترسیِ موضوعی به کتابخانه‌ی محتوا)
import schoolTeacherSubjectsRouter from "./schoolTeacherSubjects.js";
// لایه‌یِ «درس» رویِ کتابخانه‌ی محتوا
import schoolContentLessonsRouter from "./schoolContentLessons.js";
import schoolSubjectsRouter from "./schoolSubjects.js";
import schoolTimetableRouter from "./schoolTimetable.js";
import schoolGuardianRequestsRouter from "./schoolGuardianRequests.js";
import schoolWalletRouter from "./schoolWallet.js";
import schoolWalletTopupRouter from "./schoolWalletTopup.js";
// حالتِ مطالعه/فلش‌کارت — پیشرفتِ سرور-محورِ هر دانش‌آموز رویِ آیتم‌های محتوا
import schoolContentProgressRouter from "./schoolContentProgress.js";
// `/super` — گیتِ رمزِ دوم + داشبوردِ یکجایِ سوپرادمین + هویت‌های آزمایشی
import superGateRouter from "./superGate.js";
import superDashboardRouter from "./superDashboard.js";
import testIdentitiesRouter from "./testIdentities.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(dashboardRouter);
router.use(botsRouter);
router.use(marketplaceRouter);
router.use(plansRouter);
router.use(productsRouter);
router.use(themesRouter);
router.use(adminRouter);
router.use(sheetsRouter);
router.use(ticketsRouter);
router.use(botTicketsRouter);
router.use(walletRouter);
router.use(walletTopupRouter);
router.use(walletTopupSmsWebhookRouter);
router.use(paymentSmsWebhookRouter);
router.use(internalBotPaymentsRouter);
router.use(botPaymentChannelsRouter);
router.use(adminCardAutoConfirmRouter);
router.use(databaseRouter);
router.use(cutoverFlagsRouter);
router.use(sheetsImportRouter);
// FIX [Group 4]
router.use(superAdminRouter);
// G8
router.use(telegramWebhookRouter);
router.use(uploadSessionsRouter);
router.use(notificationsRouter);
router.use(discountsRouter);
router.use(updatesRouter);
router.use(registrationRouter);
router.use(completeProfileRouter);
router.use(superAdminUsersRouter);
router.use(superAdminDiagnosticsRouter);
router.use(guestRouter);
// باید بعد از botsRouter بیاید: مسیرهای اینجا زیرمسیرهای /bots/:botId هستند و
// نباید یک روت عمومی‌تر در bots.ts زودتر آن‌ها را ببلعد.
router.use(botSettingsRouter);
router.use(botPanelsRouter);
router.use(botMediaRouter);
router.use(uploadsRouter);
router.use(schoolEnrollmentRouter);
router.use(botFormsRouter);
router.use(botCommandsRouter);
router.use(botAdminsRouter);
router.use(botUsersRouter);
router.use(botBroadcastRouter);
router.use(botOrdersRouter);
router.use(botPluginsRouter);
router.use(botPluginDataRouter);
// باید قبل از botsRouter نباشد؛ مسیرهایش زیر /plugin-licences است و تعارضی ندارد.
router.use(pluginLicencesRouter);
router.use(pluginReleaseNotesRouter);
router.use(botObjectsRouter);
router.use(botRelationsRouter);
router.use(botWorkflowsRouter);
router.use(botLanguageRouter);
router.use(botBackupRouter);
router.use(botSupportTicketsRouter);
router.use(botHealthRouter);
router.use(botSubscriptionRouter);
router.use(internalTicketNotifyRouter);
router.use(bookingRouter);
router.use(botFormsProRouter);
router.use(addressesRouter);
router.use(gameServersRouter);
router.use(dripRouter);
router.use(crmRouter);
router.use(surveyRouter);
router.use(giveawayRouter);
router.use(supportLinksRouter);
router.use(currencyDisplayRouter);
router.use(exchangeRateRouter);
router.use(captchaRouter);
router.use(loyaltySettingsRouter);
router.use(catalogRouter);
router.use(botWalletRouter);
router.use(translatePostRouter);
router.use(postboxRouter);
router.use(guidedFlowRouter);
router.use(schoolsRouter);
router.use(schoolContentRouter);
router.use(schoolClassesRouter);
router.use(schoolProgramsRouter);
router.use(schoolAnnouncementsRouter);
router.use(schoolCounselorRouter);
router.use(schoolGuardianshipsRouter);
router.use(schoolAssignmentsRouter);
router.use(schoolCounselorReportsRouter);
router.use(schoolQuestionsRouter);
router.use(schoolExamsRouter);
router.use(schoolAdminMessagesRouter);
router.use(schoolTeacherMessagesRouter);
router.use(schoolAttendanceRouter);
router.use(schoolGradebookRouter);
router.use(schoolStudentAlertsRouter);
router.use(schoolBotPoolRouter);
router.use(schoolBotsRouter);
router.use(schoolBotWebhookRouter);
router.use(schoolNotificationsRouter);
router.use(schoolMessageReadStateRouter);
router.use(schoolAuditLogRouter);
router.use(schoolTeacherSubjectsRouter);
router.use(schoolContentLessonsRouter);
router.use(schoolSubjectsRouter);
router.use(schoolTimetableRouter);
router.use(schoolGuardianRequestsRouter);
router.use(schoolWalletRouter);
router.use(schoolWalletTopupRouter);
router.use(schoolContentProgressRouter);
router.use(superGateRouter);
router.use(superDashboardRouter);
router.use(testIdentitiesRouter);

export default router;
