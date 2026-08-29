import { useState } from "react";
import { useSearch } from "wouter";
import type { QueryKey } from "@tanstack/react-query";
import {
  getAdminGetStatsQueryKey,
  getAdminListUsersQueryKey,
  getListPlansQueryKey,
  getListAnnouncementsQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/hooks/use-language";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AllBotsTable, ADMIN_BOTS_KEY } from "@/components/admin/AllBotsTable";
import { PaymentApprovals, WALLET_KEY } from "@/components/admin/PaymentApprovals";
import { UsersTable } from "@/components/admin/UsersTable";
import { PlansManager, ADMIN_PLANS_KEY } from "@/components/admin/PlansManager";
import { ExchangeRateSettings } from "@/components/admin/ExchangeRateSettings";
import { AnnouncementsManager } from "@/components/admin/AnnouncementsManager";
import { UpdatesManager, ADMIN_UPDATES_KEY } from "@/components/admin/UpdatesManager";
import { PendingRegistrations, PENDING_REGISTRATIONS_KEY } from "@/components/admin/PendingRegistrations";
import { DiscountsManager } from "@/components/admin/DiscountsManager";
import { SupportLinksSettings, ADMIN_SUPPORT_LINKS_KEY } from "@/components/admin/SupportLinksSettings";
import { CurrencyDisplaySettings, ADMIN_CURRENCY_DISPLAY_KEY } from "@/components/admin/CurrencyDisplaySettings";
import { CaptchaSettings, ADMIN_CAPTCHA_KEY } from "@/components/admin/CaptchaSettings";
import { PluginReleaseNotesManager, ADMIN_PLUGIN_RELEASE_NOTES_KEY } from "@/components/admin/PluginReleaseNotesManager";
import { LayoutDashboard, CreditCard, Users, Megaphone, Bot, Package, Percent, Sparkles, UserPlus, LifeBuoy, Blocks } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";

// Each tab's query keys, so the refresh control invalidates exactly what the
// active tab renders. The tab components export their own keys where they have
// local ones, so this map references them rather than restating the literals.
const TAB_KEYS: Record<string, QueryKey[]> = {
  overview: [getAdminGetStatsQueryKey()],
  bots: [ADMIN_BOTS_KEY],
  users: [getAdminListUsersQueryKey()],
  payments: [WALLET_KEY],
  plans: [ADMIN_PLANS_KEY, getListPlansQueryKey()],
  announcements: [getListAnnouncementsQueryKey()],
  updates: [ADMIN_UPDATES_KEY],
  pluginReleaseNotes: [ADMIN_PLUGIN_RELEASE_NOTES_KEY],
  pending: [PENDING_REGISTRATIONS_KEY],
  discounts: [["admin-discounts"]],
  settings: [ADMIN_SUPPORT_LINKS_KEY, ADMIN_CURRENCY_DISPLAY_KEY, ADMIN_CAPTCHA_KEY],
};

export default function Admin() {
  usePrivatePageTitle(useT("pageTitles").admin);
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { user } = useAuth();
  // یک اعلان («فیشِ در انتظار تأیید»، «واریزِ در انتظار») باید بتواند مستقیم
  // روی تبِ درست این صفحه باز شود — قبل‌تر `tab` فقط useState محلی بود و هر
  // لینکی به /admin همیشه روی «نمای کلی» می‌افتاد. مقدارِ نامعتبر/ناموجودِ
  // پارامتر به همان پیش‌فرض برمی‌گردد، نه یک تب خالی.
  const initialTab = new URLSearchParams(useSearch()).get("tab");
  const [tab, setTab] = useState(initialTab && initialTab in TAB_KEYS ? initialTab : "overview");
  // R6 RBAC: all-bots, payments and plan management stay super_admin-only —
  // their APIs are requireSuperAdmin server-side, so showing the tabs to a
  // plain admin would just render a 403.
  //
  // Overview is different: /admin/stats is requireAdmin, so a plain admin can
  // legitimately load it. They get the panel without the revenue figures,
  // which remain super_admin information (see AdminOverview showRevenue).
  const isSuperAdmin = user?.role === "super_admin";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {fa ? "پنل مدیریت" : "Admin panel"}
          </h1>
          <p className="text-muted-foreground">
            {isSuperAdmin
              ? (fa ? "کنترل کامل پلتفرم" : "Full platform control")
              : (fa ? "نمای کلی، کاربران و اعلان‌ها" : "Overview, users and announcements")}
          </p>
        </div>
        <RefreshButton
          className="ms-auto shrink-0"
          queryKeys={TAB_KEYS[tab] ?? []}
          label={fa ? "به‌روزرسانی" : "Refresh"}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview"><LayoutDashboard className="me-2 h-4 w-4" /> {fa ? "نمای کلی" : "Overview"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="bots"><Bot className="me-2 h-4 w-4" /> {fa ? "همه ربات‌ها" : "All Bots"}</TabsTrigger>}
          <TabsTrigger value="users"><Users className="me-2 h-4 w-4" /> {fa ? "کاربران" : "Users"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="payments"><CreditCard className="me-2 h-4 w-4" /> {fa ? "پرداخت‌ها" : "Payments"}</TabsTrigger>}
          {isSuperAdmin && <TabsTrigger value="plans"><Package className="me-2 h-4 w-4" /> {fa ? "پلن‌ها" : "Plans"}</TabsTrigger>}
          <TabsTrigger value="announcements"><Megaphone className="me-2 h-4 w-4" /> {fa ? "اعلان‌ها" : "Announcements"}</TabsTrigger>
          <TabsTrigger value="updates"><Sparkles className="me-2 h-4 w-4" /> {fa ? "آپدیت‌ها" : "Updates"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="pluginReleaseNotes"><Blocks className="me-2 h-4 w-4" /> {fa ? "یادداشتِ پلاگین‌ها" : "Plugin notes"}</TabsTrigger>}
          <TabsTrigger value="pending"><UserPlus className="me-2 h-4 w-4" /> {fa ? "ثبت‌نام‌های ناتمام" : "Pending signups"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="discounts"><Percent className="me-2 h-4 w-4" /> {fa ? "تخفیف‌ها" : "Discounts"}</TabsTrigger>}
          {isSuperAdmin && <TabsTrigger value="settings"><LifeBuoy className="me-2 h-4 w-4" /> {fa ? "تنظیمات سایت" : "Site settings"}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview"><AdminOverview showRevenue={isSuperAdmin} /></TabsContent>
        {isSuperAdmin && <TabsContent value="bots"><AllBotsTable /></TabsContent>}
        <TabsContent value="users"><UsersTable /></TabsContent>
        {isSuperAdmin && <TabsContent value="payments"><PaymentApprovals /></TabsContent>}
        {isSuperAdmin && (
          <TabsContent value="plans" className="space-y-4">
            <ExchangeRateSettings />
            <PlansManager />
          </TabsContent>
        )}
        <TabsContent value="announcements"><AnnouncementsManager /></TabsContent>
        {/* مثل اعلان‌ها برای admin و super_admin هر دو باز است (روت‌های سرور requireAdmin هستند). */}
        <TabsContent value="updates"><UpdatesManager /></TabsContent>
        {isSuperAdmin && <TabsContent value="pluginReleaseNotes"><PluginReleaseNotesManager /></TabsContent>}
        <TabsContent value="pending"><PendingRegistrations /></TabsContent>
        {isSuperAdmin && <TabsContent value="discounts"><DiscountsManager /></TabsContent>}
        {isSuperAdmin && (
          <TabsContent value="settings" className="space-y-4">
            <SupportLinksSettings />
            <CurrencyDisplaySettings />
            <CaptchaSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
