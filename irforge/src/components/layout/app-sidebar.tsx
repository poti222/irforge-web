import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
  useSidebar,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import {
  Bot,
  LayoutDashboard,
  Store,
  Palette,
  CreditCard,
  Settings,
  ShieldAlert,
  Users,
  LogOut,
  Moon,
  Sun,
  Languages,
  ClipboardList,
  Database,
  ShoppingBag,
  Receipt,
  LifeBuoy,
  Wallet,
  Headset,
  Globe,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { getDisplayAvatar } from "@/lib/avatar";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { isRtlLang } from "@/lib/i18n";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { setTheme, theme } = useTheme();
  const { lang, toggleLang } = useLanguage();
  const nav = useT("common");
  const { isMobile, setOpenMobile } = useSidebar();

  if (!user) return null;

  const avatarSrc = getDisplayAvatar(user);
  const isDark = theme === "dark";

  // On phones the sidebar is a slide-over sheet. Tapping a nav item should
  // navigate AND close the sheet so the selected page is revealed.
  const closeMobileMenu = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    // In RTL (Persian) the sidebar belongs on the right: shadcn's spacer gap
    // follows the RTL flex order (right) while a `left` sidebar stays pinned
    // left-0, which slides page content under it. side="right" realigns them.
    <Sidebar side={isRtlLang(lang) ? "right" : "left"} variant="inset" collapsible="icon">
      <SidebarHeader className="flex h-16 items-center justify-center border-b border-sidebar-border px-4 py-0 group-data-[collapsible=icon]:px-0">
        <div className="flex w-full items-center justify-center gap-2 overflow-hidden group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
          <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-5" />
          </div>
          <span className="truncate font-semibold text-lg tracking-tight group-data-[collapsible=icon]:hidden">
            IrForge
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="pt-4">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/dashboard"} tooltip={nav.dashboard}>
                  <Link href="/dashboard" data-testid="nav-dashboard" onClick={closeMobileMenu}>
                    <LayoutDashboard />
                    <span>{nav.dashboard}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/buy-bot")} tooltip={nav.buyBot}>
                  <Link href="/buy-bot" data-testid="nav-buy-bot" onClick={closeMobileMenu}>
                    <ShoppingBag />
                    <span>{nav.buyBot}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/bots")} tooltip={nav.myBots}>
                  <Link href="/bots" data-testid="nav-bots" onClick={closeMobileMenu}>
                    <Bot />
                    <span>{nav.myBots}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/invoices"} tooltip={nav.myInvoices}>
                  <Link href="/invoices" data-testid="nav-invoices" onClick={closeMobileMenu}>
                    <Receipt />
                    <span>{nav.myInvoices}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/support"} tooltip={nav.support}>
                  <Link href="/support" data-testid="nav-support" onClick={closeMobileMenu}>
                    <Headset />
                    <span>{nav.support}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/tickets"} tooltip={nav.tickets}>
                  <Link href="/tickets" data-testid="nav-tickets" onClick={closeMobileMenu}>
                    <LifeBuoy />
                    <span>{nav.tickets}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/wallet"} tooltip={nav.myWallet}>
                  <Link href="/wallet" data-testid="nav-wallet" onClick={closeMobileMenu}>
                    <Wallet />
                    <span>{nav.myWallet}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/marketplace"} tooltip={nav.marketplace}>
                  <Link href="/marketplace" data-testid="nav-marketplace" onClick={closeMobileMenu}>
                    <Store />
                    <span>{nav.marketplace}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/database"} tooltip={nav.database}>
                  <Link href="/database" data-testid="nav-database" onClick={closeMobileMenu}>
                    <Database />
                    <span>{nav.database}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/language"} tooltip={nav.botLanguage}>
                  <Link href="/language" data-testid="nav-language" onClick={closeMobileMenu}>
                    <Globe />
                    <span>{nav.botLanguage}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/themes"} tooltip={nav.themeBuilder}>
                  <Link href="/themes" data-testid="nav-themes" onClick={closeMobileMenu}>
                    <Palette />
                    <span>{nav.themeBuilder}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/plans"} tooltip={nav.plans}>
                  <Link href="/plans" data-testid="nav-plans" onClick={closeMobileMenu}>
                    <CreditCard />
                    <span>{nav.plans}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(user.role === "admin" || user.role === "super_admin") && (
          <SidebarGroup>
            <div className="px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
              {nav.admin}
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin"} tooltip={nav.adminPanel}>
                    <Link href="/admin" data-testid="nav-admin" onClick={closeMobileMenu}>
                      <ShieldAlert />
                      <span>{nav.adminPanel}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/users"} tooltip={nav.manageUsers}>
                    <Link href="/admin/users" data-testid="nav-admin-users" onClick={closeMobileMenu}>
                      <Users />
                      <span>{nav.manageUsers}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {user.role === "super_admin" && (
          <SidebarGroup>
            <div className="px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
              {nav.superAdmin}
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/pending-payments"} tooltip={nav.pendingPayments}>
                    <Link href="/admin/pending-payments" data-testid="nav-pending-payments" onClick={closeMobileMenu}>
                      <ClipboardList />
                      <span>{nav.pendingPayments}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin/sheet-pool"} tooltip={nav.sheetPool}>
                    <Link href="/admin/sheet-pool" data-testid="nav-sheet-pool" onClick={closeMobileMenu}>
                      <Database />
                      <span>{nav.sheetPool}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 group-data-[collapsible=icon]:p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex w-full items-center gap-3 cursor-pointer overflow-hidden rounded-md p-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0">
              <Avatar className="size-8 shrink-0 rounded-md border border-sidebar-border bg-background">
                <AvatarImage src={avatarSrc} />
                <AvatarFallback className="rounded-md bg-primary/10 text-primary">
                  {user.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">{user.name}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">{user.email}</span>
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side={isMobile ? "top" : "right"}
            className="w-56"
            sideOffset={8}
          >
            <div className="flex items-center gap-2 p-2">
              <Avatar className="size-8 rounded-md">
                <AvatarImage src={avatarSrc} />
                <AvatarFallback className="rounded-md bg-primary/10 text-primary">
                  {user.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{user.name}</span>
                <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase w-fit">
                  {user.plan}
                </Badge>
              </div>
            </div>

            <div className="h-px bg-border my-1" />

            <DropdownMenuItem asChild>
              <Link
                href="/profile"
                className="flex w-full cursor-pointer items-center"
                onClick={closeMobileMenu}
              >
                <Settings className="me-2 size-4" />
                <span>{nav.profileSettings}</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
              {isDark ? <Sun className="me-2 size-4" /> : <Moon className="me-2 size-4" />}
              <span>{nav.toggleTheme}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={toggleLang}>
              <Languages className="me-2 size-4" />
              <span>{nav.changeLanguage}</span>
            </DropdownMenuItem>

            <div className="h-px bg-border my-1" />

            <DropdownMenuItem
              onClick={logout}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <LogOut className="me-2 size-4" />
              <span>{nav.logout}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
