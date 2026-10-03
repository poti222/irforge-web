import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Bot, ShoppingBag, Database, Wrench, School, FlaskConical, Loader2, ShieldCheck, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { AllBotsTable } from "@/components/admin/AllBotsTable";
import { ProductsManager } from "@/components/admin/ProductsManager";
import { TestIdentitiesManager } from "@/components/admin/TestIdentitiesManager";
import { HeaderControls } from "@/components/layout/header-controls";
import AdminSheetPool from "@/pages/admin-sheet-pool";
import AdminSchoolBotPool from "@/pages/admin-school-bot-pool";
import AdminCutoverFlags from "@/pages/admin-cutover-flags";
import AdminSheetsImport from "@/pages/admin-sheets-import";
import AdminPendingPayments from "@/pages/admin-pending-payments";
import AdminUsers from "@/pages/admin-users";
import { SuperSchoolsManager } from "@/components/admin/SuperSchoolsManager";

/**
 * pages/super.tsx — `/super`: صفحه‌ی یکجایِ سوپرادمین برایِ همه‌چیزِ
 * «بات/مدرسه»، پشتِ یک دروازه‌یِ **عاملِ دومِ** مستقل.
 *
 * عمداً داخلِ `ProtectedRoute`/`DashboardShell` نیست — یک شلِ مینیمالِ خودش
 * دارد، چون این صفحه خودش قرار است «همه‌چیز» باشد، نه یک تبِ دیگرِ زیرِ
 * ناوبریِ عادی. هویتِ واقعی هنوز لازم است: App.tsx این مسیر را با
 * `SuperOnlyRoute` می‌پوشاند (معادلِ `AuthOnlyRoute` + چکِ role=super_admin)
 * — رمزِ گیت اینجا رویِ *آن* نشستِ واقعی سوار می‌شود، جایگزینش نیست.
 *
 * بیشترِ تب‌ها کامپوننت‌هایِ *موجودِ* همین کدبیس را دوباره استفاده می‌کنند
 * (AllBotsTable، ProductsManager، خودِ صفحه‌هایِ pages/admin-sheet-pool.tsx و
 * غیره — هرکدام از قبل یک export default بدونِ props هستند، پس مستقیم
 * به‌عنوانِ محتوایِ یک تب import می‌شوند، نه بازنویسی).
 */

type GateState = "checking" | "locked" | "unlocked";

function useSuperGateStatus() {
  return useQuery({
    queryKey: ["super-gate", "status"],
    queryFn: async () => {
      try {
        await customFetch("/api/super-gate/status", { credentials: "include" as any });
        return true;
      } catch {
        return false;
      }
    },
    retry: false,
  });
}

function SuperGateForm({ onUnlocked }: { onUnlocked: () => void }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await customFetch("/api/super-gate/unlock", {
        method: "POST",
        credentials: "include" as any,
        body: JSON.stringify({ password }),
      });
      onUnlocked();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "رمز نادرست" : "Wrong password",
        description: e?.data?.error ?? e?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle>{fa ? "ورود به /super" : "Enter /super"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "این یک لایه‌ی رمزِ اضافه رویِ حسابِ سوپرادمینِ شماست؛ شما باید از قبل با همان حساب لاگین کرده باشید."
              : "This is an extra password layer on top of your super-admin login; you must already be logged in with that account."}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="super-gate-password">{fa ? "رمز" : "Password"}</Label>
              <PasswordInput
                id="super-gate-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                dir="ltr"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !password}>
              {busy ? <Loader2 className="me-1.5 size-4 animate-spin" /> : null}
              {fa ? "ورود" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SuperDashboard() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [tab, setTab] = useState("bots");

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center gap-3 border-b px-4">
        <ShieldCheck className="size-5 text-primary" />
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-none">/super</h1>
          <p className="text-xs text-muted-foreground">{fa ? "همه‌چیزِ بات و مدرسه، یک‌جا" : "Everything bots & schools, in one place"}</p>
        </div>
        <div className="ms-auto">
          <HeaderControls />
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="bots"><Bot className="me-2 size-4" /> {fa ? "همه ربات‌ها" : "All Bots"}</TabsTrigger>
            <TabsTrigger value="products"><ShoppingBag className="me-2 size-4" /> {fa ? "محصولات" : "Products"}</TabsTrigger>
            <TabsTrigger value="sheetPool"><Database className="me-2 size-4" /> {fa ? "استخر شیت" : "Sheet Pool"}</TabsTrigger>
            <TabsTrigger value="schoolBotPool"><Bot className="me-2 size-4" /> {fa ? "استخر بات مدرسه" : "School Bot Pool"}</TabsTrigger>
            <TabsTrigger value="schools"><School className="me-2 size-4" /> {fa ? "مدارس" : "Schools"}</TabsTrigger>
            <TabsTrigger value="testIdentities"><FlaskConical className="me-2 size-4" /> {fa ? "هویت‌های آزمایشی" : "Test Identities"}</TabsTrigger>
            <TabsTrigger value="more"><Wrench className="me-2 size-4" /> {fa ? "سایر ابزارها" : "More tools"}</TabsTrigger>
          </TabsList>

          <TabsContent value="bots"><AllBotsTable /></TabsContent>
          <TabsContent value="products"><ProductsManager /></TabsContent>
          <TabsContent value="sheetPool"><AdminSheetPool /></TabsContent>
          <TabsContent value="schoolBotPool"><AdminSchoolBotPool /></TabsContent>
          <TabsContent value="schools"><SuperSchoolsManager /></TabsContent>
          <TabsContent value="testIdentities"><TestIdentitiesManager /></TabsContent>
          <TabsContent value="more" className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {fa
                ? "هرچیزِ دیگرِ مربوط به ادمین/سوپرادمین که از قبل صفحه‌ی خودش را دارد — همین‌جا جمع شده تا لازم نباشد آدرس‌ها را از جای دیگر پیدا کنی."
                : "Everything else admin/super-admin related that already has its own page — gathered here so you don't have to look up the URLs elsewhere."}
            </p>
            <Card>
              <CardHeader><CardTitle className="text-base">{fa ? "کاربرانِ پلتفرم (همه)" : "Platform users (all)"}</CardTitle></CardHeader>
              <CardContent><AdminUsers /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{fa ? "پرداخت‌های در انتظار" : "Pending payments"}</CardTitle></CardHeader>
              <CardContent><AdminPendingPayments /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{fa ? "سوییچ Sheets/Postgres" : "Sheets/Postgres cutover"}</CardTitle></CardHeader>
              <CardContent><AdminCutoverFlags /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{fa ? "ایمپورتِ Sheets" : "Sheets import"}</CardTitle></CardHeader>
              <CardContent><AdminSheetsImport /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{fa ? "پنلِ کاملِ ادمین (قدیمی)" : "Full admin panel (legacy)"}</CardTitle></CardHeader>
              <CardContent>
                <a href="/admin" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  {fa ? "باز کردنِ /admin — پلن‌ها، تخفیف‌ها، تنظیماتِ سایت، اعلان‌ها و..." : "Open /admin — plans, discounts, site settings, announcements, etc."}
                  <ExternalLink className="size-3.5" />
                </a>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function Super() {
  usePrivatePageTitle("/super");
  const { user } = useAuth();
  const { data: unlocked, isLoading, refetch } = useSuperGateStatus();

  if (!user || user.role !== "super_admin") {
    return null; // SuperOnlyRoute در App.tsx قبل از این ریدایرکت می‌کند؛ این فقط یک محافظِ دوم است.
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!unlocked) {
    return <SuperGateForm onUnlocked={() => refetch()} />;
  }

  return <SuperDashboard />;
}
