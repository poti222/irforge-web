import type { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SupportFab } from "@/components/layout/support-fab";
import { HeaderControls } from "@/components/layout/header-controls";
import ErrorBoundary from "@/components/error-boundary";

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
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <HeaderControls />
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <ErrorBoundary inline key={routeKey}>
            {children}
          </ErrorBoundary>
        </main>
        <SupportFab />
      </SidebarInset>
    </SidebarProvider>
  );
}
