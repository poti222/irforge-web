import { useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
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
import LearnBotFather from "@/pages/learn/botfather-commands";
import LearnWebhook from "@/pages/learn/telegram-bot-webhook-vs-polling";
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
const Marketplace = lazy(() => import("@/pages/marketplace"));
const PluginDetail = lazy(() => import("@/pages/plugin-detail"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Tickets = lazy(() => import("@/pages/tickets"));
const WalletPage = lazy(() => import("@/pages/wallet"));
const Plans = lazy(() => import("@/pages/plans"));
const Profile = lazy(() => import("@/pages/profile"));
const Admin = lazy(() => import("@/pages/admin"));

const AdminPendingPayments = lazy(() => import("@/pages/admin-pending-payments"));
const AdminSheetPool = lazy(() => import("@/pages/admin-sheet-pool"));
const Support = lazy(() => import("@/pages/support"));
const Notifications = lazy(() => import("@/pages/notifications"));
const Updates = lazy(() => import("@/pages/updates"));
const AdminUsers = lazy(() => import("@/pages/admin-users"));
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
    return <Redirect to="/dashboard" />;
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
      <Route path="/learn/botfather-commands" component={LearnBotFather} />
      <Route path="/learn/telegram-bot-webhook-vs-polling" component={LearnWebhook} />
      <Route path="/pricing" component={Pricing} />
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
      <Route path="/buy-bot"><ProtectedRoute component={BuyBot} /></Route>
      <Route path="/buy-bot/:tierId"><ProtectedRoute component={BuyBotDetail} /></Route>
      {/* Must come before /bots/:botId so "cart" isn't parsed as a bot id */}
      <Route path="/bots/cart"><ProtectedRoute component={Checkout} /></Route>
      <Route path="/bots/:botId"><ProtectedRoute component={BotWorkspace} /></Route>
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
      
      <Route path="/admin"><ProtectedRoute component={Admin} adminOnly /></Route>
      {/* super_admin only — این صفحه می‌تواند نقش عوض کند، و ادمینی که بتواند
          به خودش super_admin بدهد عملاً super_admin است. */}
      <Route path="/admin/users"><ProtectedRoute component={AdminUsers} superAdminOnly /></Route>
      <Route path="/admin/users/:id"><ProtectedRoute component={AdminUserDetail} superAdminOnly /></Route>
      <Route path="/admin/pending-payments"><ProtectedRoute component={AdminPendingPayments} superAdminOnly /></Route>
      <Route path="/admin/sheet-pool"><ProtectedRoute component={AdminSheetPool} superAdminOnly /></Route>

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
