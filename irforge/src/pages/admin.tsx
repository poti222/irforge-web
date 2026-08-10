import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/hooks/use-language";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AllBotsTable } from "@/components/admin/AllBotsTable";
import { PaymentApprovals } from "@/components/admin/PaymentApprovals";
import { UsersTable } from "@/components/admin/UsersTable";
import { PlansManager } from "@/components/admin/PlansManager";
import { AnnouncementsManager } from "@/components/admin/AnnouncementsManager";
import { DiscountsManager } from "@/components/admin/DiscountsManager";
import { LayoutDashboard, CreditCard, Users, Megaphone, Bot, Package, Percent } from "lucide-react";

export default function Admin() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { user } = useAuth();
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
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {fa ? "پنل مدیریت" : "Admin panel"}
        </h1>
        <p className="text-muted-foreground">
          {isSuperAdmin
            ? (fa ? "کنترل کامل پلتفرم" : "Full platform control")
            : (fa ? "نمای کلی، کاربران و اعلان‌ها" : "Overview, users and announcements")}
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview"><LayoutDashboard className="me-2 h-4 w-4" /> {fa ? "نمای کلی" : "Overview"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="bots"><Bot className="me-2 h-4 w-4" /> {fa ? "همه ربات‌ها" : "All Bots"}</TabsTrigger>}
          <TabsTrigger value="users"><Users className="me-2 h-4 w-4" /> {fa ? "کاربران" : "Users"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="payments"><CreditCard className="me-2 h-4 w-4" /> {fa ? "پرداخت‌ها" : "Payments"}</TabsTrigger>}
          {isSuperAdmin && <TabsTrigger value="plans"><Package className="me-2 h-4 w-4" /> {fa ? "پلن‌ها" : "Plans"}</TabsTrigger>}
          <TabsTrigger value="announcements"><Megaphone className="me-2 h-4 w-4" /> {fa ? "اعلان‌ها" : "Announcements"}</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="discounts"><Percent className="me-2 h-4 w-4" /> {fa ? "تخفیف‌ها" : "Discounts"}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview"><AdminOverview showRevenue={isSuperAdmin} /></TabsContent>
        {isSuperAdmin && <TabsContent value="bots"><AllBotsTable /></TabsContent>}
        <TabsContent value="users"><UsersTable /></TabsContent>
        {isSuperAdmin && <TabsContent value="payments"><PaymentApprovals /></TabsContent>}
        {isSuperAdmin && <TabsContent value="plans"><PlansManager /></TabsContent>}
        <TabsContent value="announcements"><AnnouncementsManager /></TabsContent>
        {isSuperAdmin && <TabsContent value="discounts"><DiscountsManager /></TabsContent>}
      </Tabs>
    </div>
  );
}
