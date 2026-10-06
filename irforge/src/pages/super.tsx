import { Suspense, lazy, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bot, Blocks, CreditCard, Database, FileUp, FlaskConical, LayoutDashboard, LifeBuoy, Loader2, Megaphone, Package, Percent,
  School, ScrollText, Settings, ShieldCheck, ShoppingBag, Smartphone, Sparkles, ToggleRight, UserPlus, Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { HeaderControls } from "@/components/layout/header-controls";
import ErrorBoundary from "@/components/error-boundary";
import { SuperOverview } from "@/components/super/SuperOverview";
import { SuperSchools } from "@/components/super/SuperSchools";
import { SuperAudit } from "@/components/super/SuperAudit";
import { SUPER_GROUPS_META, SUPER_TAB_META, isSuperTab, readInitialTab, type SuperTabId } from "@/components/super/superTabs";

/**
 * pages/super.tsx — `/super`: مرکزِ مدیریتِ کاملِ پلتفرم برایِ سوپرادمین، پشتِ یک دروازه‌یِ **عاملِ دومِ** مستقل.
 *
 * هر چیزی که یک ادمین/سوپرادمین لازم دارد این‌جا یک تب دارد و در گروه‌هایِ منوی کنار دسته‌بندی شده: نمایِ کلی (با «نیازمندِ
 * توجه»)، کاربران، ربات‌ها، مدارس (مدیریتِ کامل)، مالی (فیش‌ها، کارت‌به‌کارتِ خودکار)، فروش (پلن/محصول/تخفیف)، محتوا
 * (اعلان/آپدیت)، پشتیبانی/ثبت‌نام، زیرساخت (استخرها، سوییچ Sheets/Postgres، ایمپورت)، تنظیمات و ردپا.
 *
 * عمداً داخلِ `ProtectedRoute`/`DashboardShell` نیست — شلِ مینیمالِ خودش را دارد. هویتِ واقعی هنوز لازم است: App.tsx این مسیر
 * را با `SuperOnlyRoute` می‌پوشاند (لاگینِ واقعیِ super_admin)؛ رمزِ گیت یک لایه‌یِ *اضافه* رویِ همان نشست است، نه جایگزینش.
 *
 * بیشترِ تب‌ها کامپوننت‌ها/صفحه‌هایِ *موجود* را دوباره استفاده می‌کنند (همان APIهایِ خودشان؛ بازنویسی نیست) و lazy بارگذاری
 * می‌شوند تا باز کردنِ /super همه‌یِ آن‌ها را یک‌جا نکشد. تبِ فعال در `?tab=` نگه داشته می‌شود (لینکِ مستقیم/رفرش).
 */

const named = <T extends Record<string, any>, K extends keyof T>(loader: () => Promise<T>, key: K) =>
  lazy(async () => ({ default: (await loader())[key] as ComponentType<any> }));

const AdminUsers = lazy(() => import("@/pages/admin-users"));
const AdminPendingPayments = lazy(() => import("@/pages/admin-pending-payments"));
const AdminSheetPool = lazy(() => import("@/pages/admin-sheet-pool"));
const AdminSchoolBotPool = lazy(() => import("@/pages/admin-school-bot-pool"));
const AdminCutoverFlags = lazy(() => import("@/pages/admin-cutover-flags"));
const AdminSheetsImport = lazy(() => import("@/pages/admin-sheets-import"));
const Tickets = lazy(() => import("@/pages/tickets"));
const AllBotsTable = named(() => import("@/components/admin/AllBotsTable"), "AllBotsTable");
const PaymentApprovals = named(() => import("@/components/admin/PaymentApprovals"), "PaymentApprovals");
const CardAutoConfirmAdmin = named(() => import("@/components/admin/CardAutoConfirmAdmin"), "CardAutoConfirmAdmin");
const PlansManager = named(() => import("@/components/admin/PlansManager"), "PlansManager");
const ExchangeRateSettings = named(() => import("@/components/admin/ExchangeRateSettings"), "ExchangeRateSettings");
const ProductsManager = named(() => import("@/components/admin/ProductsManager"), "ProductsManager");
const DiscountsManager = named(() => import("@/components/admin/DiscountsManager"), "DiscountsManager");
const AnnouncementsManager = named(() => import("@/components/admin/AnnouncementsManager"), "AnnouncementsManager");
const UpdatesManager = named(() => import("@/components/admin/UpdatesManager"), "UpdatesManager");
const PluginReleaseNotesManager = named(() => import("@/components/admin/PluginReleaseNotesManager"), "PluginReleaseNotesManager");
const PendingRegistrations = named(() => import("@/components/admin/PendingRegistrations"), "PendingRegistrations");
const TestIdentitiesManager = named(() => import("@/components/admin/TestIdentitiesManager"), "TestIdentitiesManager");
const SupportLinksSettings = named(() => import("@/components/admin/SupportLinksSettings"), "SupportLinksSettings");
const CurrencyDisplaySettings = named(() => import("@/components/admin/CurrencyDisplaySettings"), "CurrencyDisplaySettings");
const CaptchaSettings = named(() => import("@/components/admin/CaptchaSettings"), "CaptchaSettings");

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

// ─── تب‌ها ──────────────────────────────────────────────────────────────────

/** عنوانِ کارتِ داخلِ یک تبِ چندبخشی. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** آیکنِ هر تب (کلیدها از `SuperTabId`؛ فراموشیِ یک تب خطایِ کامپایل است). */
const TAB_ICONS: Record<SuperTabId, LucideIcon> = {
  overview: LayoutDashboard, users: Users, bots: Bot, schools: School, payments: CreditCard, cardpay: Smartphone,
  plans: Package, products: ShoppingBag, discounts: Percent, announcements: Megaphone, updates: Sparkles, pluginNotes: Blocks,
  tickets: LifeBuoy, signups: UserPlus, sheetPool: Database, schoolBotPool: Bot, cutover: ToggleRight, sheetsImport: FileUp,
  settings: Settings, audit: ScrollText,
};

/** محتوایِ هر تب؛ `go` برایِ پریدن به تبِ دیگر (مثلاً از «نیازمندِ توجه»). */
const TAB_CONTENT: Record<SuperTabId, (go: (tab: SuperTabId) => void) => ReactNode> = {
  overview: (go) => <SuperOverview onNavigate={(t) => go(t as SuperTabId)} />,
  users: () => <AdminUsers />,
  bots: () => <AllBotsTable />,
  schools: () => <SuperSchools />,
  payments: () => (
    <div className="space-y-6">
      <PaymentApprovals />
      <Section title="Pending payments / پرداخت‌های در انتظار"><AdminPendingPayments /></Section>
    </div>
  ),
  cardpay: () => <CardAutoConfirmAdmin />,
  plans: () => (<div className="space-y-4"><ExchangeRateSettings /><PlansManager /></div>),
  products: () => <ProductsManager />,
  discounts: () => <DiscountsManager />,
  announcements: () => <AnnouncementsManager />,
  updates: () => <UpdatesManager />,
  pluginNotes: () => <PluginReleaseNotesManager />,
  tickets: () => <Tickets />,
  signups: () => (
    <div className="space-y-6">
      <PendingRegistrations />
      <Section title="Test identities / هویت‌های آزمایشی"><TestIdentitiesManager /></Section>
    </div>
  ),
  sheetPool: () => <AdminSheetPool />,
  schoolBotPool: () => <AdminSchoolBotPool />,
  cutover: () => <AdminCutoverFlags />,
  sheetsImport: () => <AdminSheetsImport />,
  settings: () => (<div className="space-y-4"><SupportLinksSettings /><CurrencyDisplaySettings /><CaptchaSettings /></div>),
  audit: () => <SuperAudit />,
};

function SuperDashboard() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [tab, setTabState] = useState<SuperTabId>(() => readInitialTab(typeof window === "undefined" ? "" : window.location.search));
  const currentMeta = SUPER_TAB_META.find((t) => t.id === tab) ?? SUPER_TAB_META[0];

  function setTab(next: string) {
    if (!isSuperTab(next)) return;
    setTabState(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
      window.scrollTo({ top: 0 });
    } catch { /* محیطِ بدونِ history — فقط لینکِ مستقیم کار نمی‌کند */ }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center gap-3 border-b px-4">
        <ShieldCheck className="size-5 text-primary" />
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-none" dir="ltr">/super</h1>
          <p className="text-xs text-muted-foreground">{fa ? "مدیریتِ کاملِ پلتفرم، مدارس و ربات‌ها — یک‌جا" : "Full platform, schools & bots management — in one place"}</p>
        </div>
        <div className="ms-auto"><HeaderControls /></div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 p-4 md:grid-cols-[15rem_minmax(0,1fr)] md:p-6">
        {/* موبایل: انتخابگر؛ دسکتاپ: منویِ گروه‌بندی‌شده */}
        <div className="md:hidden">
          <Select value={tab} onValueChange={setTab}>
            <SelectTrigger data-testid="super-tab-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUPER_GROUPS_META.map((g) => (
                <SelectGroup key={g.id}>
                  <SelectLabel>{fa ? g.fa : g.en}</SelectLabel>
                  {g.tabs.map((t) => <SelectItem key={t.id} value={t.id}>{fa ? t.fa : t.en}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav className="hidden md:block" aria-label="super sections" data-testid="super-nav">
          <div className="sticky top-4 space-y-4">
            {SUPER_GROUPS_META.map((g) => (
              <div key={g.id} className="space-y-1">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{fa ? g.fa : g.en}</p>
                {g.tabs.map((t) => {
                  const Icon = TAB_ICONS[t.id];
                  return (
                    <button
                      key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={t.id === tab ? "page" : undefined} data-testid={`super-tab-${t.id}`}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors ${t.id === tab ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-accent"}`}
                    >
                      <Icon className="size-4 shrink-0" />{fa ? t.fa : t.en}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 space-y-4" data-testid={`super-panel-${tab}`}>
          <h2 className="text-xl font-bold">{fa ? currentMeta.fa : currentMeta.en}</h2>
          {/* هر تب ErrorBoundaryِ خودش را دارد (با key = تب): خرابیِ یک بخش منو و بقیه‌یِ تب‌ها را از کار نمی‌اندازد. */}
          <ErrorBoundary inline key={tab}>
            <Suspense fallback={<div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
              {TAB_CONTENT[tab](setTab)}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
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
