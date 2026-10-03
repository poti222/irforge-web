export * from "./users";
export * from "./bots";
export * from "./commands";
export * from "./marketplace";
export * from "./plans";
export * from "./themes";
export * from "./activity";
export * from "./sessions";
// GROUP 2 MIGRATION: جداول جدید
export * from "./payments";
export * from "./sheetPool";
// Z4: سیستم تیکت
export * from "./tickets";
// Z5: کیف پول
export * from "./wallet";
// اتصال تلگرام از طریق بات (لینک عمیق /start <token>)
export * from "./telegramLinkTokens";
// سیستم اعلان‌های جدید (تریال و آینده)
export * from "./notifications";
// آپدیت‌های سایت (تغییرات و امکانات جدید + مودال یک‌باره)
export * from "./updates";
// ثبت‌نام/ورود دومرحله‌ای، محدودسازی نرخ، مهمان، لاگ ممیزی
export * from "./auth";
// Phase 9: کدهای تخفیف — دیگر جدول Postgres ندارد؛ داده‌ی کدهای تخفیف کامل
// در Google Sheets نگه‌داری می‌شود (ببینید api-server/src/lib/discountStore.ts).
// تنظیمات سطح پلتفرم (آدرس کیف پول تتر، شماره کارت، …)
export * from "./platformSettings";
// «با بات بفرست» — جلسه‌ی کوتاه‌عمر ضبط محتوا از داخل تلگرام
export * from "./uploadSessions";
// دسترسی مدیریتِ واگذارشده به یک بات (با کد ادمین)
export * from "./botManagers";
// نرخ دلار به ریال، مرجعِ صورتحساب (فاز ۱۰ identityverificationspec.md)
export * from "./exchangeRates";
// محصولاتِ سطحِ پلتفرم (بات، اکانت مجازی، کارت مجازی، API، حسابیار، مدرسه)
export * from "./products";
// بخش "/schools" فاز ۱ — مدرسه‌ها، کدهای معرف، پروفایلِ مدرسه‌ایِ کاربر
export * from "./schools";
// بخش "/schools" فاز ۱ — لغت‌نامه/جزوه/کتاب/فرمول
export * from "./schoolContent";
// بخش "/schools" فاز ۲ — کلاس‌ها، برنامه‌ها، اعلامیه‌ها، یادداشتِ مشاور،
// پیوندِ والد↔دانش‌آموز، چندمدرسه‌ایِ مدیر
export * from "./schoolClasses";
export * from "./schoolPrograms";
export * from "./schoolAnnouncements";
export * from "./schoolCounselorNotes";
export * from "./schoolGuardianships";
export * from "./schoolAdmins";
// بخش "/schools" فاز ۳ — تکالیفِ معلم/ارسالِ دانش‌آموز
export * from "./schoolAssignments";
// بخش "/schools" فاز ۴ — گزارش/برنامه/چتِ مشاور، بانکِ سؤال، آزمون
export * from "./schoolCounselorReports";
export * from "./schoolCounselorMessages";
export * from "./schoolQuestions";
export * from "./schoolExams";
// بخش "/schools" فاز ۵ — ارتباط با مدیر/معلم (بندِ ۱)
export * from "./schoolAdminMessages";
export * from "./schoolTeacherMessages";
// بخش "/schools" فاز ۶ — حضور و غیاب، اخطار/هشدارِ دانش‌آموز
export * from "./schoolAttendance";
export * from "./schoolStudentAlerts";
// بخش "/schools" فاز ۷ — استخرِ توکنِ بات + باتِ اطلاع‌رسانیِ هر مدرسه
export * from "./schoolBots";
// بخش "/schools" فاز ۹ — وضعیتِ خوانده‌شدنِ رشته‌ها + لاگِ رخدادهایِ مدیریتی
export * from "./schoolMessageReadState";
export * from "./schoolAuditLog";
// تخصیصِ معلم↔درس (کنترلِ دسترسیِ موضوعی به کتابخانه‌ی محتوا)
export * from "./schoolTeacherSubjects";
// لایه‌یِ «درس» رویِ کتابخانه‌ی محتوا — گروه‌بندیِ آیتم‌های لغت‌نامه/شعر/جزوه/... داخلِ یک درسِ واحد
export * from "./schoolContentLessons";
