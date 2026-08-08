import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { navigate } from "wouter/use-browser-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import NotFound from "@/pages/not-found";

// Pages
import Landing from "@/pages/landing";
import Docs from "@/pages/docs";
import Login from "@/pages/login";
import Register from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Dashboard from "@/pages/dashboard";
import Bots from "@/pages/bots";
import BuyBot from "@/pages/buy-bot";
import BuyBotDetail from "@/pages/buy-bot-detail";
import Checkout from "@/pages/checkout";
import LearnBotToken from "@/pages/learn-bot-token";
import BotWorkspace from "@/pages/bot-workspace";
import Marketplace from "@/pages/marketplace";
import Invoices from "@/pages/invoices";
import Tickets from "@/pages/tickets";
import WalletPage from "@/pages/wallet";
import Profile from "@/pages/profile";
import Admin from "@/pages/admin";
import AdminUsers from "@/pages/admin-users";
import AdminPendingPayments from "@/pages/admin-pending-payments";
import AdminSheetPool from "@/pages/admin-sheet-pool";
import Support from "@/pages/support";
import DatabasePage from "@/pages/database";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { BrandLogo } from "@/components/layout/brand-home";
import { SupportFab } from "@/components/layout/support-fab";
import { HeaderControls } from "@/components/layout/header-controls";
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

  if (adminOnly && user.role !== "admin" && user.role !== "super_admin") {
    return <Redirect to="/dashboard" />;
  }

  if (superAdminOnly && user.role !== "super_admin") {
    return <Redirect to="/dashboard" />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          {/* Brand lockup sits right of the toggle so it's present on the
              dashboard and every signed-in page — and, more importantly, on
              mobile, where the sidebar is a closed sheet and the header would
              otherwise carry no brand at all.
              href="/" is language-aware for free: WouterRouter's `base`
              already carries the active language prefix, so this resolves to
              /en/ for an English visitor, /ar/ for Arabic, and bare / for the
              default (fa). Don't hardcode a prefix here — that would double it. */}
          <div className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          <BrandLogo href="/" size="sm" data-testid="header-brand-home" />
          <HeaderControls />
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          {/* Per-page boundary keyed by route: a crash in one page shows the
              recovery card inside the shell, and navigating away resets it. */}
          <ErrorBoundary inline key={location}>
            <Component {...rest} />
          </ErrorBoundary>
        </main>
        <SupportFab />
      </SidebarInset>
    </SidebarProvider>
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/docs" component={Docs} />
      <Route path="/login"><PublicOnlyRoute component={Login} /></Route>
      <Route path="/register"><PublicOnlyRoute component={Register} /></Route>
      <Route path="/forgot-password"><PublicOnlyRoute component={ForgotPassword} /></Route>
      <Route path="/reset-password"><PublicOnlyRoute component={ResetPassword} /></Route>
      
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/bots"><ProtectedRoute component={Bots} /></Route>
      <Route path="/buy-bot"><ProtectedRoute component={BuyBot} /></Route>
      <Route path="/buy-bot/:tierId"><ProtectedRoute component={BuyBotDetail} /></Route>
      {/* Must come before /bots/:botId so "cart" isn't parsed as a bot id */}
      <Route path="/bots/cart"><ProtectedRoute component={Checkout} /></Route>
      <Route path="/bots/:botId"><ProtectedRoute component={BotWorkspace} /></Route>
      <Route path="/learn/bot-token"><ProtectedRoute component={LearnBotToken} /></Route>
      <Route path="/marketplace"><ProtectedRoute component={Marketplace} /></Route>
      <Route path="/invoices"><ProtectedRoute component={Invoices} /></Route>
      <Route path="/tickets"><ProtectedRoute component={Tickets} /></Route>
      <Route path="/wallet"><ProtectedRoute component={WalletPage} /></Route>
      <Route path="/support"><ProtectedRoute component={Support} /></Route>
      <Route path="/database"><ProtectedRoute component={DatabasePage} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
      
      <Route path="/admin"><ProtectedRoute component={Admin} adminOnly /></Route>
      <Route path="/admin/users"><ProtectedRoute component={AdminUsers} adminOnly /></Route>
      <Route path="/admin/pending-payments"><ProtectedRoute component={AdminPendingPayments} superAdminOnly /></Route>
      <Route path="/admin/sheet-pool"><ProtectedRoute component={AdminSheetPool} superAdminOnly /></Route>

      <Route component={NotFound} />
    </Switch>
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

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={base} ssrPath={ssrPath}>
              <AuthProvider>
                <CartProvider>
                  <Router />
                </CartProvider>
              </AuthProvider>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
