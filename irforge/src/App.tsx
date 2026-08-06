import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
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
import Themes from "@/pages/themes";
import Plans from "@/pages/plans";
import Invoices from "@/pages/invoices";
import Tickets from "@/pages/tickets";
import WalletPage from "@/pages/wallet";
import Profile from "@/pages/profile";
import Admin from "@/pages/admin";
import AdminUsers from "@/pages/admin-users";
import AdminPendingPayments from "@/pages/admin-pending-payments";
import AdminSheetPool from "@/pages/admin-sheet-pool";
import Support from "@/pages/support";
import Language from "@/pages/language";
import DatabasePage from "@/pages/database";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SupportFab } from "@/components/layout/support-fab";
import { BrandHomeButton } from "@/components/layout/brand-home";
import { HeaderControls } from "@/components/layout/header-controls";
import { Spinner } from "@/components/ui/spinner";
import ErrorBoundary from "@/components/error-boundary";

const queryClient = new QueryClient({
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
          <div className="h-5 w-px bg-border mx-1" />
          <BrandHomeButton className="size-8" />
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
      <Route path="/themes"><ProtectedRoute component={Themes} /></Route>
      <Route path="/plans"><ProtectedRoute component={Plans} /></Route>
      <Route path="/invoices"><ProtectedRoute component={Invoices} /></Route>
      <Route path="/tickets"><ProtectedRoute component={Tickets} /></Route>
      <Route path="/wallet"><ProtectedRoute component={WalletPage} /></Route>
      <Route path="/support"><ProtectedRoute component={Support} /></Route>
      <Route path="/language"><ProtectedRoute component={Language} /></Route>
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

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
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
