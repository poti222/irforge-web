import { useEffect, lazy, Suspense } from "react";
import { consumePostAuthTarget } from "@/lib/post-auth";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation, useParams } from "wouter";
import { navigate } from "wouter/use-browser-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
// هر تغییر مسیر، صفحه را از بالا نشان می‌دهد — نگاه کن به دو ظرف اسکرولِ
// جدا که آن فایل توضیح می‌دهد.
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import NotFound from "@/pages/not-found";

// Public, prerendered pages: kept as static imports so SSG (scripts/ssg.mjs)
// can render them directly and the first paint of a marketing page doesn't
// wait on a network round-trip for its own chunk.
import Landing from "@/pages/landing";
import Docs from "@/pages/docs";
import LearnHub from "@/pages/learn";
import LearnTelegramBotToken from "@/pages/learn/telegram-bot-token";
import LearnHowToMake from "@/pages/learn/how-to-make-a-telegram-bot";
import LearnShopBot from "@/pages/learn/telegram-shop-bot";
import LearnSupportBot from "@/pages/learn/telegram-support-bot";
import LearnWithoutCoding from "@/pages/learn/telegram-bot-without-coding";
import LearnGoogleSheets from "@/pages/learn/telegram-bot-google-sheets";
import LearnBotCost from "@/pages/learn/telegram-bot-cost";
import LearnBuyTelegramBot from "@/pages/learn/buy-telegram-bot";
import LearnTelegramBookingBot from "@/pages/learn/telegram-booking-bot";
import LearnTelegramGiveawayBot from "@/pages/learn/telegram-giveaway-bot";
import LearnTelegramSurveyQuizBot from "@/pages/learn/telegram-survey-quiz-bot";
import LearnTelegramBotCardPayment from "@/pages/learn/telegram-bot-card-payment";
import LearnTelegramBotWallet from "@/pages/learn/telegram-bot-wallet";
import LearnTelegramBotCrmScheduledMessages from "@/pages/learn/telegram-bot-crm-scheduled-messages";
import LearnBotFather from "@/pages/learn/botfather-commands";
import LearnWebhook from "@/pages/learn/telegram-bot-webhook-vs-polling";
import LearnWhatIs from "@/pages/learn/what-is-a-telegram-bot";
import LearnChooseBuilder from "@/pages/learn/choose-a-telegram-bot-builder";
import LearnMenuButtons from "@/pages/learn/telegram-bot-menu-buttons";
import LearnBroadcast from "@/pages/learn/telegram-bot-broadcast";
import About from "@/pages/about";
import SchoolManagement from "@/pages/school-management";
import Pricing from "@/pages/pricing";

/**
 * NOTE [perf]: everything below used to be a static import too, which meant
 * every one of these ~25 authenticated/admin pages shipped in the SAME JS
 * bundle as the homepage — a visitor landing on "/" was downloading the
 * wallet, admin, and database page code before they'd even logged in. That's
 * the main reason mobile Performance scored ~30 points below Desktop on
 * PageSpeed Insights (mobile CPUs pay for parsing/executing all of that JS
 * up front; desktop CPUs mostly hide it).
 *
 * React.lazy() + Suspense (see <Router/> below) makes each of these its own
 * chunk, fetched only when a visitor actually navigates to that route. None
 * of these are public/prerendered routes, so this has zero effect on SSG.
 */
const Login = lazy(() => import("@/pages/login"));
const Register = lazy(() => import("@/pages/register"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const AuthTelegram = lazy(() => import("@/pages/auth-telegram"));
const AuthGoogleCallback = lazy(() => import("@/pages/auth-google-callback"));
const AuthGithubCallback = lazy(() => import("@/pages/auth-github-callback"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const CompleteProfile = lazy(() => import("@/pages/complete-profile"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Bots = lazy(() => import("@/pages/bots"));
const BuyBot = lazy(() => import("@/pages/buy-bot"));
const BuyBotDetail = lazy(() => import("@/pages/buy-bot-detail"));
const Checkout = lazy(() => import("@/pages/checkout"));
const BotWorkspace = lazy(() => import("@/pages/bot-workspace"));
const TutorialPage = lazy(() => import("@/pages/tutorial"));
const Marketplace = lazy(() => import("@/pages/marketplace"));
const PluginDetail = lazy(() => import("@/pages/plugin-detail"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Tickets = lazy(() => import("@/pages/tickets"));
const WalletPage = lazy(() => import("@/pages/wallet"));
const Plans = lazy(() => import("@/pages/plans"));
const Profile = lazy(() => import("@/pages/profile"));
const Admin = lazy(() => import("@/pages/admin"));

// بخش "/schools" فاز ۱
const SchoolsEntry = lazy(() => import("@/pages/schools/index"));
const SchoolsAdminHome = lazy(() => import("@/pages/schools/admin/index"));
const SchoolsStudentHome = lazy(() => import("@/pages/schools/student/index"));
const SchoolsRoleHome = lazy(() => import("@/pages/schools/role-home"));
const SchoolContentSubjects = lazy(() => import("@/pages/schools/content-subjects"));
const SchoolContentSubject = lazy(() => import("@/pages/schools/content-subject"));
const SchoolContentLessonHub = lazy(() => import("@/pages/schools/content-lesson-hub"));
const SchoolContentLesson = lazy(() => import("@/pages/schools/content-lesson"));
const SchoolContentStudy = lazy(() => import("@/pages/schools/content-study"));
const SchoolContentDetail = lazy(() => import("@/pages/schools/content-detail"));
const SchoolsStub = lazy(() => import("@/pages/schools/stub"));
const SchoolClassSelection = lazy(() => import("@/pages/schools/class-selection"));
const SchoolShell = lazy(() => import("@/components/layout/SchoolShell"));
// بخش "/schools" فاز ۲
const SchoolMembersPage = lazy(() => import("@/pages/schools/admin/members"));
const SchoolClassesPage = lazy(() => import("@/pages/schools/admin/classes"));
const SchoolClassDetailPage = lazy(() => import("@/pages/schools/admin/class-detail"));
const SchoolProgramsPage = lazy(() => import("@/pages/schools/admin/programs"));
const ParentLinkPage = lazy(() => import("@/pages/schools/parent/link"));
const SchoolTimetablePage = lazy(() => import("@/pages/schools/timetable"));
const SchoolAnnouncementsPage = lazy(() => import("@/pages/schools/announcements"));
const TeacherClassesPage = lazy(() => import("@/pages/schools/teacher/classes"));
const CounselorStudentsPage = lazy(() => import("@/pages/schools/counselor/students"));
const ParentChildrenPage = lazy(() => import("@/pages/schools/parent/children"));
// بخش "/schools" فاز ۳
const TeacherTodayPage = lazy(() => import("@/pages/schools/teacher/today"));
const TeacherAssignmentsPage = lazy(() => import("@/pages/schools/teacher/assignments"));
const StudentAssignmentsPage = lazy(() => import("@/pages/schools/student/assignments"));
// بخش "/schools" فاز ۴ — گزارش/برنامه/چتِ مشاور، بانکِ سؤال، آزمون
const CounselorReportsPage = lazy(() => import("@/pages/schools/counselor/reports"));
const CounselorSchedulePage = lazy(() => import("@/pages/schools/counselor/schedule"));
const CounselorChatPage = lazy(() => import("@/pages/schools/counselor/chat"));
const StudentCounselorPage = lazy(() => import("@/pages/schools/student/counselor"));
const TeacherQuestionsPage = lazy(() => import("@/pages/schools/teacher/questions"));
const TeacherExamsPage = lazy(() => import("@/pages/schools/teacher/exams"));
const StudentExamsPage = lazy(() => import("@/pages/schools/student/exams"));
// بخش "/schools" فاز ۵ — ارتباط با مدیر/معلم، فازِ عمقِ والد
const AdminMessagesPage = lazy(() => import("@/pages/schools/admin/messages"));
const TeacherMessagesPage = lazy(() => import("@/pages/schools/teacher/messages"));
const StudentAdminChatPage = lazy(() => import("@/pages/schools/student/admin-chat"));
const StudentTeacherChatPage = lazy(() => import("@/pages/schools/student/teacher-chat"));
const ParentReportsPage = lazy(() => import("@/pages/schools/parent/reports"));
// بخش "/schools" فاز ۶ — حضور و غیاب، نمره‌نامه، اخطار/هشدارِ دانش‌آموز
const TeacherAttendancePage = lazy(() => import("@/pages/schools/teacher/attendance"));
const TeacherGradebookPage = lazy(() => import("@/pages/schools/teacher/gradebook"));
const StudentAttendancePage = lazy(() => import("@/pages/schools/student/attendance"));
const StudentGradesPage = lazy(() => import("@/pages/schools/student/grades"));
const SchoolAlertsPage = lazy(() => import("@/pages/schools/admin/alerts"));
// بخش "/schools" فاز ۹ — تاریخچه‌ی رخدادهایِ مدیریتی
const SchoolAuditLogPage = lazy(() => import("@/pages/schools/admin/audit-log"));

const AdminPendingPayments = lazy(() => import("@/pages/admin-pending-payments"));
const AdminSheetPool = lazy(() => import("@/pages/admin-sheet-pool"));
const AdminSchoolBotPool = lazy(() => import("@/pages/admin-school-bot-pool"));
const AdminCutoverFlags = lazy(() => import("@/pages/admin-cutover-flags"));
const AdminSheetsImport = lazy(() => import("@/pages/admin-sheets-import"));
const Support = lazy(() => import("@/pages/support"));
const Notifications = lazy(() => import("@/pages/notifications"));
const Updates = lazy(() => import("@/pages/updates"));
const AdminUsers = lazy(() => import("@/pages/admin-users"));
const Super = lazy(() => import("@/pages/super"));
const AdminUserDetail = lazy(() => import("@/pages/admin-user-detail"));
const UpdateDetail = lazy(() => import("@/pages/update-detail"));
const NotificationDetail = lazy(() => import("@/pages/notification-detail"));
const DatabasePage = lazy(() => import("@/pages/database"));

// NOTE [perf]: sidebar/header/support-FAB chrome is dashboard-only, but a
// static import here put it in the graph every page — including the
// anonymous landing view — has to fetch. Lazy, same as every page below.
// See DashboardShell.tsx.
const DashboardShell = lazy(() => import("@/components/layout/DashboardShell"));
import { Spinner } from "@/components/ui/spinner";
import ErrorBoundary from "@/components/error-boundary";
import { readStoredLang, useLanguage } from "@/hooks/use-language";
import { DEFAULT_LANG, type Lang } from "@/lib/i18n";
import { langHref, langPrefix, splitLangPrefix } from "@/lib/lang-routing";

// exported so the prerender entry can seed it (logged-out) before rendering
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly = false, superAdminOnly = false, ...rest }: { component: any, adminOnly?: boolean, superAdminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // Mandatory Profile Completion & Identity System — applies to every
  // authenticated route regardless of how the user signed in (email/phone/
  // Telegram/Google/GitHub), and takes priority over the admin/super-admin
  // checks below: an admin with an incomplete profile still gets sent here
  // first. /complete-profile itself is a separate, unguarded-by-this route
  // (see AuthOnlyRoute below) so this never loops.
  if (!user.profileComplete) {
    return <Redirect to="/complete-profile" />;
  }

  if (adminOnly && user.role !== "admin" && user.role !== "super_admin") {
    return <Redirect to="/dashboard" />;
  }

  if (superAdminOnly && user.role !== "super_admin") {
    return <Redirect to="/dashboard" />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <DashboardShell routeKey={location}>
        <Component {...rest} />
      </DashboardShell>
    </Suspense>
  );
}

/**
 * SchoolProtectedRoute — دقیقاً معادلِ `ProtectedRoute`، اما به‌جایِ
 * `DashboardShell` از `SchoolShell` استفاده می‌کند (سایدبارِ نقش‌محورِ بخشِ
 * "/schools"). دروازه‌ی هویتِ سراسری (لاگین + ویزاردِ تکمیلِ پروفایل) اینجا
 * هم دست‌نخورده اعمال می‌شود — SchoolShell فقط *بعد* از آن، دروازه‌ی جداگانه‌ی
 * «پروفایلِ مدرسه‌ای کامل است؟» را اضافه می‌کند (خودِ SchoolShell این را چک
 * می‌کند و در صورتِ ناقص‌بودن به /schools ریدایرکت می‌کند).
 */
function SchoolProtectedRoute({ component: Component, ...rest }: { component: any; role?: string }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (!user.profileComplete) {
    return <Redirect to="/complete-profile" />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <SchoolShell key={location}>
        <Component {...rest} />
      </SchoolShell>
    </Suspense>
  );
}

/**
 * IRFORGE_PRODUCTS_SECTION_PROMPT Phase 3 — `/buy-bot/:tierId` → `/products/:tierId`,
 * param preserved. wouter's `Redirect to=` doesn't interpolate params itself,
 * so this reads `:tierId` and builds the destination by hand.
 */
function BuyBotTierRedirect() {
  const { tierId } = useParams<{ tierId: string }>();
  return <Redirect to={`/products/${tierId}`} replace />;
}

/**
 * برای خودِ /complete-profile: نیاز به لاگین دارد، ولی عمداً کاملیِ پروفایل
 * را چک نمی‌کند — وگرنه ProtectedRoute همین صفحه را به خودش ریدایرکت
 * می‌کرد. و عمداً DashboardShell (سایدبار/هدر داشبورد) هم ندارد: این یک
 * ویزارد متمرکز است، شبیه login/register، نه یک صفحه‌ی داخل داشبورد.
 */
function AuthOnlyRoute({ component: Component, ...rest }: { component: any }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Component {...rest} />
    </Suspense>
  );
}

/**
 * SuperOnlyRoute — مثلِ `AuthOnlyRoute`، اما فقط super_admin، و بدونِ هیچ
 * شلی: pages/super.tsx خودش شلِ مینیمالِ خودش (فرمِ رمز یا داشبورد) را
 * می‌سازد. دروازه‌ی هویتِ واقعیِ سراسری اینجا همچنان اجراست — فقط
 * DashboardShell/پروفایل‌کامل‌بودن را نمی‌خواهد، چون /super خودش یک صفحه‌ی
 * مستقل است، نه یک تبِ دیگرِ زیرِ ناوبریِ dashboard.
 */
function SuperOnlyRoute({ component: Component, ...rest }: { component: any }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (user.role !== "super_admin") {
    return <Redirect to="/dashboard" />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Component {...rest} />
    </Suspense>
  );
}

function PublicOnlyRoute({ component: Component, ...rest }: { component: any }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (user) {
    return <Redirect to={consumePostAuthTarget()} />;
  }

  return <Component {...rest} />;
}

/** Fallback shown only while a lazy route's own chunk is being fetched —
 * public/prerendered routes never hit this since they're static imports. */
function RouteFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Spinner size="lg" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/docs" component={Docs} />
      {/* Public and prerendered per language: it's linked from checkout but
          also has to be readable (and indexable) by someone who hasn't signed
          up yet — getting the token is a prerequisite to buying. */}
      {/* Public content hub. Every article slug stays English in all five
          languages; the router `base` supplies the language prefix. */}
      <Route path="/learn" component={LearnHub} />
      <Route path="/learn/telegram-bot-token" component={LearnTelegramBotToken} />
      <Route path="/learn/how-to-make-a-telegram-bot" component={LearnHowToMake} />
      <Route path="/learn/telegram-shop-bot" component={LearnShopBot} />
      <Route path="/learn/telegram-support-bot" component={LearnSupportBot} />
      <Route path="/learn/telegram-bot-without-coding" component={LearnWithoutCoding} />
      <Route path="/learn/telegram-bot-google-sheets" component={LearnGoogleSheets} />
      <Route path="/learn/telegram-bot-cost" component={LearnBotCost} />
      <Route path="/learn/buy-telegram-bot" component={LearnBuyTelegramBot} />
      <Route path="/learn/telegram-booking-bot" component={LearnTelegramBookingBot} />
      <Route path="/learn/telegram-giveaway-bot" component={LearnTelegramGiveawayBot} />
      <Route path="/learn/telegram-survey-quiz-bot" component={LearnTelegramSurveyQuizBot} />
      <Route path="/learn/telegram-bot-card-payment" component={LearnTelegramBotCardPayment} />
      <Route path="/learn/telegram-bot-wallet" component={LearnTelegramBotWallet} />
      <Route path="/learn/telegram-bot-crm-scheduled-messages" component={LearnTelegramBotCrmScheduledMessages} />
      <Route path="/learn/botfather-commands" component={LearnBotFather} />
      <Route path="/learn/telegram-bot-webhook-vs-polling" component={LearnWebhook} />
      <Route path="/learn/what-is-a-telegram-bot" component={LearnWhatIs} />
      <Route path="/learn/choose-a-telegram-bot-builder" component={LearnChooseBuilder} />
      <Route path="/learn/telegram-bot-menu-buttons" component={LearnMenuButtons} />
      <Route path="/learn/telegram-bot-broadcast" component={LearnBroadcast} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/about" component={About} />
      <Route path="/school-management" component={SchoolManagement} />
      {/* The guide used to live at /learn/bot-token and that URL was public and
          prerendered, so it must not simply 404. wouter can only redirect once
          the SPA has booted — a real 301 has to be configured at the host.
          See SEO.md. */}
      <Route path="/learn/bot-token">
        <Redirect to="/learn/telegram-bot-token" replace />
      </Route>
      <Route path="/login"><PublicOnlyRoute component={Login} /></Route>
      <Route path="/register"><PublicOnlyRoute component={Register} /></Route>
      {/*
          مقصد دکمه‌ی «داشبورد» داخل پیام بات. عمداً `PublicOnlyRoute` نیست:
          آن، کاربرِ از قبل لاگین را به داشبورد می‌فرستاد و تیکت هرگز مصرف
          نمی‌شد — که یعنی اگر مرورگر نشستِ حساب دیگری داشته باشد، کاربر با
          حساب اشتباه بالا می‌آمد. صفحه خودش تیکت را می‌سوزاند و نشست را
          جایگزین می‌کند.
      */}
      <Route path="/auth/telegram" component={AuthTelegram} />
      <Route path="/auth/google/callback" component={AuthGoogleCallback} />
      <Route path="/auth/github/callback" component={AuthGithubCallback} />
      <Route path="/forgot-password"><PublicOnlyRoute component={ForgotPassword} /></Route>
      <Route path="/reset-password"><PublicOnlyRoute component={ResetPassword} /></Route>
      
      <Route path="/complete-profile"><AuthOnlyRoute component={CompleteProfile} /></Route>
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/bots"><ProtectedRoute component={Bots} /></Route>
      <Route path="/products"><ProtectedRoute component={BuyBot} /></Route>
      <Route path="/products/:tierId"><ProtectedRoute component={BuyBotDetail} /></Route>
      {/* IRFORGE_PRODUCTS_SECTION_PROMPT Phase 3 — "Buy Bot" renamed to
          "Products"/محصولات; these keep any existing /buy-bot bookmark or
          internal link working via a client-side redirect rather than a 404. */}
      <Route path="/buy-bot"><Redirect to="/products" replace /></Route>
      <Route path="/buy-bot/:tierId"><BuyBotTierRedirect /></Route>
      {/* Must come before /bots/:botId so "cart" isn't parsed as a bot id */}
      <Route path="/bots/cart"><ProtectedRoute component={Checkout} /></Route>
      <Route path="/bots/:botId"><ProtectedRoute component={BotWorkspace} /></Route>
      <Route path="/tutorials/:section"><ProtectedRoute component={TutorialPage} /></Route>
      <Route path="/marketplace"><ProtectedRoute component={Marketplace} /></Route>
      <Route path="/marketplace/:pluginId"><ProtectedRoute component={PluginDetail} /></Route>
      <Route path="/invoices"><ProtectedRoute component={Invoices} /></Route>
      <Route path="/tickets"><ProtectedRoute component={Tickets} /></Route>
      <Route path="/wallet"><ProtectedRoute component={WalletPage} /></Route>
      <Route path="/plans"><ProtectedRoute component={Plans} /></Route>
      <Route path="/support"><ProtectedRoute component={Support} /></Route>
      <Route path="/notifications"><ProtectedRoute component={Notifications} /></Route>
      <Route path="/notifications/:id"><ProtectedRoute component={NotificationDetail} /></Route>
      {/* «/updates» باید قبل از «/updates/:id» بیاید وگرنه wouter مسیر لیست
          را هم با پارامتر تطبیق می‌دهد. */}
      <Route path="/updates"><ProtectedRoute component={Updates} /></Route>
      <Route path="/updates/:id"><ProtectedRoute component={UpdateDetail} /></Route>
      <Route path="/database"><ProtectedRoute component={DatabasePage} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>

      {/* بخش "/schools" فاز ۱ — نقطه‌ی ورود (آنبوردینگ یا ریدایرکت به نقش)
          هنوز نقشی معلوم نیست، پس هنوز از SchoolShell استفاده نمی‌کند. */}
      <Route path="/schools"><ProtectedRoute component={SchoolsEntry} /></Route>
      <Route path="/schools/class-selection"><SchoolProtectedRoute component={SchoolClassSelection} /></Route>
      <Route path="/schools/admin"><SchoolProtectedRoute component={SchoolsAdminHome} /></Route>
      <Route path="/schools/student"><SchoolProtectedRoute component={SchoolsStudentHome} /></Route>
      <Route path="/schools/teacher"><SchoolProtectedRoute component={SchoolsRoleHome} role="teacher" /></Route>
      <Route path="/schools/counselor"><SchoolProtectedRoute component={SchoolsRoleHome} role="counselor" /></Route>
      <Route path="/schools/deputy"><SchoolProtectedRoute component={SchoolsRoleHome} role="deputy" /></Route>
      <Route path="/schools/deputy-discipline"><SchoolProtectedRoute component={SchoolsRoleHome} role="deputy-discipline" /></Route>
      <Route path="/schools/parent"><SchoolProtectedRoute component={SchoolsRoleHome} role="parent" /></Route>
      {/* «درس‌ها»: هاب ← موضوع ← درس ← نوع. ترتیبِ Route مهم است: مسیرهایِ جدید باید *قبل از*
          `/schools/content/:type/:id` (جزئیاتِ آیتم) بیایند، وگرنه «lesson»/«subject» به‌جایِ type گرفته می‌شود. */}
      <Route path="/schools/content"><SchoolProtectedRoute component={SchoolContentSubjects} /></Route>
      <Route path="/schools/content/subject/:subjectId"><SchoolProtectedRoute component={SchoolContentSubject} /></Route>
      <Route path="/schools/content/lesson/:lessonId/:type"><SchoolProtectedRoute component={SchoolContentLesson} /></Route>
      <Route path="/schools/content/lesson/:lessonId"><SchoolProtectedRoute component={SchoolContentLessonHub} /></Route>
      <Route path="/schools/content/study/:type/:lessonId/:section"><SchoolProtectedRoute component={SchoolContentStudy} /></Route>
      {/* آدرس‌هایِ قدیمی (بوکمارک/لینک) — با replace تا دکمه‌یِ برگشتِ مرورگر به همین آدرسِ قدیمی برنگردد و حلقه نشود. */}
      <Route path="/schools/content/:type/lesson/:lessonId">{(p: any) => <Redirect to={`/schools/content/lesson/${p.lessonId}/${p.type}`} replace />}</Route>
      <Route path="/schools/content/:type/:id"><SchoolProtectedRoute component={SchoolContentDetail} /></Route>
      <Route path="/schools/content/:type"><Redirect to="/schools/content" replace /></Route>
      {/* بخش "/schools" فاز ۲ — مدیریتِ اعضا/کلاس‌ها/برنامه‌ها/اعلامیه‌ها + صفحاتِ واقعیِ معلم/مشاور/والد */}
      <Route path="/schools/admin/members"><SchoolProtectedRoute component={SchoolMembersPage} /></Route>
      <Route path="/schools/admin/classes"><SchoolProtectedRoute component={SchoolClassesPage} /></Route>
      <Route path="/schools/admin/classes/:id"><SchoolProtectedRoute component={SchoolClassDetailPage} /></Route>
      <Route path="/schools/admin/programs"><SchoolProtectedRoute component={SchoolProgramsPage} /></Route>
      <Route path="/schools/parent/link"><SchoolProtectedRoute component={ParentLinkPage} /></Route>
      <Route path="/schools/timetable"><SchoolProtectedRoute component={SchoolTimetablePage} /></Route>
      <Route path="/schools/announcements"><SchoolProtectedRoute component={SchoolAnnouncementsPage} /></Route>
      <Route path="/schools/teacher/classes"><SchoolProtectedRoute component={TeacherClassesPage} /></Route>
      <Route path="/schools/counselor/students"><SchoolProtectedRoute component={CounselorStudentsPage} /></Route>
      <Route path="/schools/parent/children"><SchoolProtectedRoute component={ParentChildrenPage} /></Route>
      {/* بخش "/schools" فاز ۳ — امروز/تکالیفِ معلم، تکالیفِ دانش‌آموز */}
      <Route path="/schools/teacher/today"><SchoolProtectedRoute component={TeacherTodayPage} /></Route>
      <Route path="/schools/teacher/assignments"><SchoolProtectedRoute component={TeacherAssignmentsPage} /></Route>
      <Route path="/schools/student/assignments"><SchoolProtectedRoute component={StudentAssignmentsPage} /></Route>
      {/* بخش "/schools" فاز ۴ — گزارش/برنامه/چتِ مشاور، بانکِ سؤال، آزمون */}
      <Route path="/schools/counselor/reports"><SchoolProtectedRoute component={CounselorReportsPage} /></Route>
      <Route path="/schools/counselor/schedule"><SchoolProtectedRoute component={CounselorSchedulePage} /></Route>
      <Route path="/schools/counselor/chat"><SchoolProtectedRoute component={CounselorChatPage} /></Route>
      <Route path="/schools/student/counselor"><SchoolProtectedRoute component={StudentCounselorPage} /></Route>
      <Route path="/schools/teacher/questions"><SchoolProtectedRoute component={TeacherQuestionsPage} /></Route>
      <Route path="/schools/teacher/exams"><SchoolProtectedRoute component={TeacherExamsPage} /></Route>
      <Route path="/schools/student/exams"><SchoolProtectedRoute component={StudentExamsPage} /></Route>
      {/* بخش "/schools" فاز ۵ — ارتباط با مدیر/معلم، عمقِ والد (گزارش‌ها) */}
      <Route path="/schools/admin/messages"><SchoolProtectedRoute component={AdminMessagesPage} /></Route>
      <Route path="/schools/teacher/messages"><SchoolProtectedRoute component={TeacherMessagesPage} /></Route>
      <Route path="/schools/student/admin-chat"><SchoolProtectedRoute component={StudentAdminChatPage} /></Route>
      <Route path="/schools/student/teacher-chat"><SchoolProtectedRoute component={StudentTeacherChatPage} /></Route>
      <Route path="/schools/parent/reports"><SchoolProtectedRoute component={ParentReportsPage} /></Route>
      {/* بخش "/schools" فاز ۶ — حضور و غیاب، نمره‌نامه، اخطار/هشدارِ دانش‌آموز */}
      <Route path="/schools/teacher/attendance"><SchoolProtectedRoute component={TeacherAttendancePage} /></Route>
      <Route path="/schools/teacher/gradebook"><SchoolProtectedRoute component={TeacherGradebookPage} /></Route>
      <Route path="/schools/student/attendance"><SchoolProtectedRoute component={StudentAttendancePage} /></Route>
      <Route path="/schools/student/grades"><SchoolProtectedRoute component={StudentGradesPage} /></Route>
      <Route path="/schools/admin/alerts"><SchoolProtectedRoute component={SchoolAlertsPage} /></Route>
      {/* بخش "/schools" فاز ۹ — تاریخچه‌ی رخدادهایِ مدیریتی */}
      <Route path="/schools/admin/audit-log"><SchoolProtectedRoute component={SchoolAuditLogPage} /></Route>
      <Route path="/schools/stub/:key"><SchoolProtectedRoute component={SchoolsStub} /></Route>

      <Route path="/admin"><ProtectedRoute component={Admin} adminOnly /></Route>
      {/* super_admin only — این صفحه می‌تواند نقش عوض کند، و ادمینی که بتواند
          به خودش super_admin بدهد عملاً super_admin است. */}
      <Route path="/admin/users"><ProtectedRoute component={AdminUsers} superAdminOnly /></Route>
      <Route path="/admin/users/:id"><ProtectedRoute component={AdminUserDetail} superAdminOnly /></Route>
      <Route path="/admin/pending-payments"><ProtectedRoute component={AdminPendingPayments} superAdminOnly /></Route>
      <Route path="/admin/sheet-pool"><ProtectedRoute component={AdminSheetPool} superAdminOnly /></Route>
      <Route path="/admin/school-bot-pool"><ProtectedRoute component={AdminSchoolBotPool} superAdminOnly /></Route>
      <Route path="/admin/cutover-flags"><ProtectedRoute component={AdminCutoverFlags} superAdminOnly /></Route>
      <Route path="/admin/sheets-import"><ProtectedRoute component={AdminSheetsImport} superAdminOnly /></Route>
      <Route path="/super"><SuperOnlyRoute component={Super} /></Route>

      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

/**
 * Keeps the URL and the render language in agreement, in both directions:
 *
 *  - `/fa/...` is not a canonical URL (Persian lives at the root), so rewrite
 *    it to the unprefixed form — one page, one URL.
 *  - An unprefixed URL always renders the root language. If the visitor has
 *    previously chosen another one, send them to that language's URL instead
 *    of quietly rendering it at the wrong path. Crawlers have no
 *    localStorage, so they never take this branch and always get Persian at
 *    `/` — which is exactly what the canonical claims.
 *
 * Both use `replace`, so neither adds a history entry to get stuck on.
 */
function useCanonicalLangPath(setLang: (lang: Lang) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { search, hash } = window.location;
    const { lang, path } = splitLangPrefix(window.location.pathname);

    if (lang === DEFAULT_LANG) {
      // same language, different path — a plain navigation is enough
      navigate(langHref(DEFAULT_LANG, path) + search + hash, { replace: true });
      return;
    }
    if (!lang) {
      const stored = readStoredLang();
      if (stored && stored !== DEFAULT_LANG) {
        // Must go through setLang, not navigate: the language drives the
        // router base, so moving the URL to /en/ without committing the
        // language would leave base="" against a prefixed URL and match
        // nothing — a 404 on the visitor's own homepage.
        setLang(stored);
      }
    }
    // mount-only on purpose: this reconciles the entry URL, and setLang owns
    // every later change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function App({ ssrPath }: { ssrPath?: string } = {}) {
  const { lang, setLang } = useLanguage();
  useCanonicalLangPath(setLang);

  // Everything below the router lives under the language prefix, so every
  // existing <Link href="/docs"> keeps the visitor in their language without
  // a single call site changing. App routes come along for the ride
  // (/en/dashboard) — robots.txt disallows both the bare and prefixed forms.
  const base = import.meta.env.BASE_URL.replace(/\/$/, "") + langPrefix(lang);

  // IRFORGE_PROMPT_V3 Phase 46 — light is the default for a first-time
  // visitor, not dark. `enableSystem` is off on purpose: the only theme
  // control in the app is ThemeToggleButton's two-state sun/moon toggle
  // (see hooks/use-theme-sweep.ts) — there is no "match my OS" option
  // anywhere in the UI, so leaving it on would just let a visitor's OS
  // dark-mode setting silently override this default on their very first
  // visit, which is exactly what this phase exists to stop. A theme a
  // visitor explicitly picks via the toggle is unaffected either way:
  // next-themes persists it to localStorage (key "theme") and that
  // stored choice always wins over defaultTheme on every later visit.
  return (
    // IRFORGE_PROMPT_V3 Phase 50 — motion system. `reducedMotion="user"`
    // makes every `motion.*` element in the app check prefers-reduced-motion
    // once, here, instead of each component remembering to call
    // useReducedMotion() itself. Before this, that check only actually
    // happened on the landing page and inside MotionButton/MotionCard — every
    // other framer-motion usage (docs.tsx's page transitions, the admin
    // tables' row stagger, support.tsx's infinitely-looping robot bounce,
    // brand-home's logo spring, ...) ran full motion regardless of the
    // visitor's OS setting. This doesn't replace the landing page's own
    // manual `reduce` checks — those drive imperative scroll-linked values
    // (useTransform/useMotionValueEvent) that no top-level policy can reach —
    // but it closes the gap for every plain `animate`/`whileHover`/
    // `whileInView` usage everywhere else, for free.
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <WouterRouter base={base} ssrPath={ssrPath}>
                <AuthProvider>
                  <CartProvider>
                    <ScrollToTop />
                    <Router />
                  </CartProvider>
                </AuthProvider>
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
