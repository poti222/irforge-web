import type { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SupportFab } from "@/components/layout/support-fab";
import { HeaderControls } from "@/components/layout/header-controls";
import ErrorBoundary from "@/components/error-boundary";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/hooks/use-language";
import { Lock } from "lucide-react";

/**
 * DashboardShell.tsx — chrome around every authenticated page: sidebar,
 * header, support FAB.
 *
 * NOTE [perf]: this used to be inlined in App.tsx's ProtectedRoute, imported
 * eagerly at module scope alongside the public/prerendered pages. Vite's
 * modulepreload analysis for the entry chunk has no idea a component is only
 * reachable behind a login check — it just sees the static import — so
 * AppSidebar's dropdown/avatar Radix primitives shipped to every visitor,
 * including an anonymous landing-page view that never renders any of it
 * (Lighthouse flagged this as unused JavaScript on the landing page).
 *
 * Lazy-loading this one component — the same pattern every dashboard *page*
 * already uses — keeps it out of that graph. `ProtectedRoute` only needs it
 * once a session is confirmed, by which point the extra chunk fetch is
 * invisible; it was never going to render before that check passes anyway.
 */
export default function DashboardShell({
  children,
  routeKey,
}: {
  children: ReactNode;
  /** Per-route key so a crash on one page resets when navigating away. */
  routeKey: string;
}) {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const fa = lang === "fa";
  // تعلیق‌شده باید همه‌چیز را ببیند، فقط هیچ کاری نتواند بکند — برخلافِ
  // بن‌شده که اصلاً وارد نمی‌شود. یک <fieldset disabled> دورِ محتوای صفحه
  // همین را با یک سازوکارِ استاندارد مرورگر می‌دهد: هر button/input/select
  // داخلش خودبه‌خود غیرفعال می‌شود (همان چیزی که Button's
  // disabled:pointer-events-none هم رویش حساب می‌کند)، بدون این‌که لازم
  // باشد تک‌تکِ صدها دکمه‌ی این پنل دستی سوییچ شوند. سایدبار/ناوبری/خروج
  // بیرونِ این fieldset می‌مانند، چون کاربرِ تعلیق‌شده باید بتواند بگردد و
  // خارج شود — فقط نمی‌تواند چیزی را تغییر دهد.
  const suspended = user?.status === "suspended";

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <HeaderControls />
        </header>
        {suspended && (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            {fa
              ? "حساب شما به‌طور موقت تعلیق شده است. می‌توانید همه‌چیز را ببینید ولی امکان انجام هیچ عملی نیست."
              : "Your account is temporarily suspended. You can view everything, but no actions are available."}
          </div>
        )}
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <ErrorBoundary inline key={routeKey}>
            <fieldset disabled={suspended} className="contents border-0 p-0 m-0 min-w-0">
              {children}
            </fieldset>
          </ErrorBoundary>
        </main>
        <SupportFab />
      </SidebarInset>
    </SidebarProvider>
  );
}
