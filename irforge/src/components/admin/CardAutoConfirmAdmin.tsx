/**
 * CardAutoConfirmAdmin.tsx — «کارت‌به‌کارت خودکار» در پنلِ مدیریت (فقط سوپرادمین) — IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸/۹.
 *
 * یک‌جا ببین و مدیریت کن: نمای کلی و مواردِ نیازمندِ توجه، کانال‌های خودِ سایت (شارژ کیف‌پولِ IrForge)، کانال‌های همه‌ی بات‌ها،
 * درخواست‌های پرداخت (تأیید/ردِ دستی)، صندوقِ پیامک (تخصیصِ دستی)، و لاگِ تفصیلی. هیچ راز/شماره‌کارتِ کامل/متنِ خامِ پیامکی اینجا
 * نمی‌آید: کارت همیشه ماسک (`6037-****-****-1234`)، متنِ پیامک با ماسکِ ارقامِ بلند، و کلیدِ وبهوک فقط یک‌بار هنگامِ ساخت/چرخش.
 * زمان‌ها به وقتِ ایران.
 */
import { useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, BookOpen, CheckCircle2, CircleDashed, Loader2, Play, Power, RefreshCcw, ScrollText, ShieldAlert, Smartphone, XCircle,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { CardAutoConfirmSection } from "@/components/bots/settings/CardAutoConfirmSection";
import { PLATFORM_SCOPE } from "@/components/bots/settings/cardChannelsApi";
import {
  CARD_ADMIN_KEY, useAdminChannels, useAdminEvents, useAdminRequests, useAdminSms, useAssignSms, useCardOverview, useDecide,
  useRequestDetail, useRequestReceipt, useRunMigration, useSetChannelActive, useSweepNow,
  type AdminChannel, type AdminEvent, type AdminRequest, type AdminSms, type Health,
} from "./cardAdminApi";

export { CARD_ADMIN_KEY };

const ALL = "__all__";

function useFa() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const tr = (f: string, e: string) => (fa ? f : e);
  const time = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(fa ? "fa-IR" : "en-US", { timeZone: "Asia/Tehran" }); } catch { return String(iso); }
  };
  const num = (n: number | null | undefined) => (n ?? 0).toLocaleString(fa ? "fa-IR" : "en-US");
  return { fa, tr, time, num };
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  queued: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
  awaiting_review: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  expired: "bg-muted text-muted-foreground",
  canceled: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  matched: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  unmatched: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  ambiguous: "bg-destructive/15 text-destructive border-destructive/30",
  ignored: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: string }) {
  const { fa } = useFa();
  const L: Record<string, [string, string]> = {
    pending: ["در انتظار پرداخت", "Pending"], queued: ["در صف", "Queued"], awaiting_review: ["منتظر بررسی فیش", "Awaiting review"],
    confirmed: ["تأیید شد", "Confirmed"], expired: ["منقضی", "Expired"], canceled: ["لغو", "Canceled"], rejected: ["ردشده", "Rejected"],
    matched: ["وصل‌شده", "Matched"], unmatched: ["بدون درخواست", "Unmatched"], ambiguous: ["مبهم", "Ambiguous"], ignored: ["نادیده", "Ignored"],
  };
  const l = L[status];
  return <Badge variant="outline" className={`whitespace-nowrap font-normal ${STATUS_STYLE[status] ?? ""}`}>{l ? l[fa ? 0 : 1] : status}</Badge>;
}

const KIND_LABEL: Record<string, [string, string]> = {
  card_manual: ["کارت‌به‌کارت", "Card"], fixed_link: ["لینکِ مبلغ‌ثابت", "Fixed link"], open_link: ["لینکِ مبلغ‌باز", "Open link"],
};

function HealthBadge({ h }: { h: Health }) {
  const { tr, num } = useFa();
  if (h.status === "never") return <Badge variant="outline" className="font-normal">{tr("هنوز پیامکی نیامده", "No SMS yet")}</Badge>;
  return h.status === "ok"
    ? <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/15 font-normal text-emerald-700 dark:text-emerald-400">{tr("گوشی متصل", "Phone online")}</Badge>
    : <Badge variant="outline" className="border-destructive/30 bg-destructive/15 font-normal text-destructive">{tr(`ساکت ${num(Math.floor(h.hoursSince))} ساعت`, `Silent ${Math.floor(h.hoursSince)}h`)}</Badge>;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "bad" | "good" }) {
  const c = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-lg border bg-card p-3" data-testid="stat">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${c}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

// ─── نمای کلی ───────────────────────────────────────────────────────────────

function OverviewTab({ onGo }: { onGo: (tab: string) => void }) {
  const { tr, time, num } = useFa();
  const { toast } = useToast();
  const ov = useCardOverview();
  const sweep = useSweepNow();
  const migrate = useRunMigration();
  const env = useQuery({
    queryKey: [...CARD_ADMIN_KEY, "platform-env"],
    queryFn: () => customFetch<{ channels: AdminChannel[]; legacyWebhookEnabled: boolean; publicUrlConfigured: boolean }>("/api/admin/card-autoconfirm/platform-channels"),
  });
  const [migrationMd, setMigrationMd] = useState<string | null>(null);

  if (ov.isLoading || !ov.data) return <div className="h-48 animate-pulse rounded-md bg-muted" />;
  const d = ov.data;
  const a = d.attention;
  const problems = a.staleReviews + a.stuckEffects + a.ambiguousSms + a.unmatchedDepositsRecent + d.channels.silent;

  const plat = env.data?.channels ?? [];
  const activePlat = plat.filter((c) => c.active);
  const steps: { done: boolean; warn?: boolean; title: string; hint: string }[] = [
    { done: plat.length > 0, title: tr("کانالِ شارژِ کیف‌پولِ سایت ساخته شده", "Platform channel created"),
      hint: tr("تبِ «کانال‌های خودِ سایت» ← افزودنِ کانال (کارت یا لینکِ پرداخت).", "“Site channels” tab → add a channel (card or payment link).") },
    { done: activePlat.length > 0, title: tr("کانال فعال است", "Channel is active"), hint: tr("کانالِ غیرفعال در صفحه‌ی کیف‌پول دیده نمی‌شود.", "An inactive channel is hidden from the wallet page.") },
    { done: activePlat.some((c) => c.health.status !== "never"), title: tr("گوشی پیامکی فرستاده است", "The phone has sent an SMS"),
      hint: tr("MacroDroid را با آدرسِ وبهوک و کلیدِ کانال تنظیم کنید و یک واریزِ کوچک بزنید.", "Configure MacroDroid with the channel webhook + key, then make a small deposit.") },
    { done: activePlat.length > 0 && activePlat.every((c) => c.health.status === "ok"), warn: activePlat.some((c) => c.health.status === "stale"),
      title: tr("گوشی هم‌اکنون متصل است", "The phone is currently online"), hint: tr("اگر بیش از ۱۲ ساعت پیامک نیاید «ساکت» می‌شود.", "It turns “silent” after 12 hours without SMS.") },
    { done: env.data ? !env.data.legacyWebhookEnabled : false, warn: env.data?.legacyWebhookEnabled,
      title: tr("آدرسِ قدیمیِ وبهوک خاموش است", "Legacy webhook URL is off"),
      hint: tr("بعد از تنظیمِ گوشی روی آدرسِ جدید، متغیرِ SMS_WEBHOOK_SECRET را از env حذف کنید.", "Once the phone uses the new URL, remove the SMS_WEBHOOK_SECRET env var.") },
  ];

  return (
    <div className="space-y-6">
      {problems === 0 && a.problemEvents24h === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> {tr("همه‌چیز عادی است؛ موردی نیازمندِ توجه نیست.", "All good — nothing needs attention.")}
        </div>
      ) : (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-amber-500" /> {tr("نیازمندِ توجه", "Needs attention")}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {[
              [a.staleReviews, tr("فیشِ بیش از ۶ ساعت بی‌جواب", "Receipts waiting > 6h"), "requests"],
              [a.ambiguousSms, tr("پیامکِ مبهم (چند درخواست هم‌خوان)", "Ambiguous SMS"), "sms"],
              [a.unmatchedDepositsRecent, tr("واریزِ بدونِ درخواستِ هم‌مبلغ (۲۴ ساعت)", "Deposits with no matching request (24h)"), "sms"],
              [a.stuckEffects, tr("اثرِ تأییدِ گیرکرده (بات)", "Stuck confirmation effects (bots)"), "requests"],
              [d.channels.silent, tr("کانالِ فعال با گوشیِ ساکت", "Active channels with a silent phone"), "channels"],
              [a.problemEvents24h, tr("هشدار/خطا در لاگ (۲۴ ساعت)", "Warnings/errors in the log (24h)"), "log"],
            ].filter(([n]) => Number(n) > 0).map(([n, label, tab]) => (
              <button key={String(label)} type="button" onClick={() => onGo(String(tab))}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-start text-sm hover:bg-muted">
                <span>{String(label)}</span><Badge variant="destructive">{num(Number(n))}</Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("پرداختِ باز — سایت", "Open — site")} value={num(d.open.platform.pending + d.open.platform.queued + d.open.platform.awaitingReview)}
          hint={tr(`${num(d.open.platform.awaitingReview)} فیش منتظر`, `${d.open.platform.awaitingReview} receipts waiting`)} />
        <Stat label={tr("پرداختِ باز — بات‌ها", "Open — bots")} value={num(d.open.bot.pending + d.open.bot.queued + d.open.bot.awaitingReview)}
          hint={tr(`${num(d.open.bot.awaitingReview)} فیش منتظر`, `${d.open.bot.awaitingReview} receipts waiting`)} />
        <Stat label={tr("تأییدشده — ۲۴ ساعت", "Confirmed — 24h")} value={num(d.last24h.confirmed)} tone="good"
          hint={tr(`${num(d.last24h.confirmedBySms)} خودکار · ${num(d.last24h.confirmedByAdmin)} دستی`, `${d.last24h.confirmedBySms} auto · ${d.last24h.confirmedByAdmin} manual`)} />
        <Stat label={tr("مبلغِ تأییدشده — ۲۴ ساعت (تومان)", "Confirmed amount — 24h (Toman)")} value={num(d.last24h.confirmedAmountToman)}
          hint={tr(`۷ روز: ${num(d.last7d.confirmedAmountToman)}`, `7d: ${num(d.last7d.confirmedAmountToman)}`)} />
        <Stat label={tr("پیامکِ ۲۴ ساعت", "SMS — 24h")} value={num(d.sms24h.total)} hint={tr(`${num(d.sms24h.matched)} وصل‌شده · ${num(d.sms24h.ignored)} نادیده`, `${d.sms24h.matched} matched · ${d.sms24h.ignored} ignored`)} />
        <Stat label={tr("منقضی/ردشده/لغو — ۲۴ ساعت", "Expired/rejected/canceled — 24h")} value={num(d.last24h.expired + d.last24h.rejected + d.last24h.canceled)} />
        <Stat label={tr("کانالِ فعال", "Active channels")} value={`${num(d.channels.active)} / ${num(d.channels.total)}`} hint={tr(`${num(d.channels.platform)} سایت · ${num(d.channels.bot)} بات`, `${d.channels.platform} site · ${d.channels.bot} bots`)} />
        <Stat label={tr("گوشیِ ساکت", "Silent phones")} value={num(d.channels.silent)} tone={d.channels.silent ? "bad" : undefined} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="size-4" /> {tr("راه‌اندازی برایِ خودِ سایت (شارژ کیف‌پولِ IrForge)", "Setup for your own site (IrForge wallet top-up)")}</CardTitle>
          <CardDescription>{tr("پنج قدمِ کوتاه؛ هر قدم خودکار از وضعیتِ واقعی خوانده می‌شود.", "Five short steps, each read from the real state.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm" data-testid="setup-step">
              {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : s.warn ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <div><p className={s.done ? "" : "font-medium"}>{s.title}</p>{!s.done && <p className="text-xs text-muted-foreground">{s.hint}</p>}</div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" onClick={() => onGo("platform")}>{tr("کانال‌های خودِ سایت", "Site channels")}</Button>
            <Button size="sm" variant="outline" asChild><Link href="/tutorials/cardpay"><BookOpen className="me-1.5 size-4" /> {tr("آموزشِ کامل با عکس", "Full illustrated tutorial")}</Link></Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{tr("جاروب و مهاجرت", "Sweeper & migration")}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="font-medium">{tr("Sweeper (هر دقیقه)", "Sweeper (every minute)")}</p>
              {d.sweeper ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr("آخرین اجرا: ", "Last run: ")}{time(d.sweeper.at)} — {tr(`${num(d.sweeper.expired)} منقضی، ${num(d.sweeper.promoted)} ارتقایِ صف`, `${d.sweeper.expired} expired, ${d.sweeper.promoted} promoted`)}
                  {d.sweeper.errors.length > 0 && <span className="text-destructive"> — {d.sweeper.errors.length} {tr("خطا", "errors")}</span>}
                </p>
              ) : <p className="mt-1 text-xs text-muted-foreground">{tr("از آخرین راه‌اندازیِ سرور هنوز گزارشی ثبت نشده (اگر کاری نبوده طبیعی است).", "No report since the last server start (normal when idle).")}</p>}
              <Button size="sm" variant="outline" className="mt-2" disabled={sweep.isPending}
                onClick={() => sweep.mutate(undefined, { onSuccess: (r) => toast({ title: tr("جاروب انجام شد", "Sweep done"), description: tr(`${r.report.expired} منقضی`, `${r.report.expired} expired`) }), onError: (e: any) => toast({ variant: "destructive", title: e?.message }) })}>
                {sweep.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Play className="me-1.5 size-4" />}{tr("اجرای فوری", "Run now")}
              </Button>
            </div>
            <div className="rounded-md border p-3">
              <p className="font-medium">{tr("مهاجرتِ شارژِ قدیمی", "Legacy top-up migration")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {d.legacyMigration ? `${d.legacyMigration.ok ? "✅" : "❌"} ${time(d.legacyMigration.at)} — ${d.legacyMigration.message}` : tr("گزارشی ثبت نشده (چیزی برایِ مهاجرت نبوده یا هنوز اجرا نشده).", "No report (nothing to migrate or not run yet).")}
              </p>
              <Button size="sm" variant="outline" className="mt-2" disabled={migrate.isPending}
                onClick={() => migrate.mutate({ dryRun: true }, { onSuccess: (r) => setMigrationMd(r.markdown), onError: (e: any) => toast({ variant: "destructive", title: e?.message }) })}>
                {migrate.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <ScrollText className="me-1.5 size-4" />}{tr("گزارشِ مهاجرت (dry-run)", "Migration report (dry-run)")}
              </Button>
            </div>
          </div>
          {migrationMd && <pre dir="auto" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{migrationMd}</pre>}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── کانال‌های خودِ سایت ────────────────────────────────────────────────────

function PlatformTab() {
  const { tr } = useFa();
  const env = useQuery({
    queryKey: [...CARD_ADMIN_KEY, "platform-env"],
    queryFn: () => customFetch<{ legacyWebhookEnabled: boolean }>("/api/admin/card-autoconfirm/platform-channels"),
  });
  return (
    <div className="space-y-4">
      {env.data?.legacyWebhookEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid="legacy-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>{tr(
            "آدرسِ قدیمیِ وبهوک (/internal/wallet-topup/sms-webhook با SMS_WEBHOOK_SECRET) هنوز روشن است تا گوشیِ فعلی‌تان قطع نشود؛ پیامک‌هایش به همین کانال‌ها می‌رسد. بعد از اینکه آدرسِ جدید و کلیدِ تازه را روی گوشی گذاشتید، SMS_WEBHOOK_SECRET را از env حذف کنید.",
            "The legacy webhook URL (/internal/wallet-topup/sms-webhook with SMS_WEBHOOK_SECRET) is still enabled so your current phone keeps working; it feeds these channels. Once the phone uses the new URL and key, remove SMS_WEBHOOK_SECRET from the env.")}</span>
        </div>
      )}
      <CardAutoConfirmSection
        botId={PLATFORM_SCOPE}
        title={tr("کانال‌های شارژ کیف‌پولِ خودِ IrForge", "IrForge wallet top-up channels")}
        description={tr("مشتریِ سایت با یک مبلغِ یکتا به کارت/لینکِ شما واریز می‌کند؛ گوشیِ شما پیامکِ بانک را می‌فرستد و کیف‌پولِ او خودکار شارژ می‌شود. اگر چند کانالِ فعال بسازید، کاربر حسابِ مقصد را انتخاب می‌کند.",
          "Site customers pay a unique amount to your card/link; your phone forwards the bank SMS and their wallet is credited automatically. With several active channels the user picks the destination.")}
      />
    </div>
  );
}

// ─── همه‌ی کانال‌ها ─────────────────────────────────────────────────────────

function ChannelsTab() {
  const { fa, tr, time, num } = useFa();
  const { toast } = useToast();
  const [scope, setScope] = useState(ALL);
  const [q, setQ] = useState("");
  const [silent, setSilent] = useState(false);
  const list = useAdminChannels({ scope: scope === ALL ? undefined : scope, q: q || undefined, silent });
  const toggle = useSetChannelActive();
  const [target, setTarget] = useState<AdminChannel | null>(null);
  const [reason, setReason] = useState("");

  const rows = list.data?.channels ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-56" placeholder={tr("جستجو: بات، ایمیل، نام صاحب، شناسه…", "Search: bot, email, holder, id…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr("همه‌ی دامنه‌ها", "All scopes")}</SelectItem>
            <SelectItem value="platform">{tr("خودِ سایت", "Site")}</SelectItem>
            <SelectItem value="bot">{tr("بات‌ها", "Bots")}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant={silent ? "default" : "outline"} onClick={() => setSilent((v) => !v)}>{tr("فقط گوشیِ ساکت", "Silent phones only")}</Button>
      </div>
      {list.isLoading ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : rows.length === 0 ? <Empty text={tr("کانالی پیدا نشد.", "No channels found.")} /> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[820px] text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="text-start">
                {[tr("مالک", "Owner"), tr("نوع/کارت", "Kind / card"), tr("گوشی", "Phone"), tr("آخرین پیامک", "Last SMS"), tr("درخواست‌ها", "Requests"), tr("پیامکِ بی‌صاحب", "Unmatched SMS"), tr("وضعیت", "State")].map((h) => <th key={h} className="p-2 text-start font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t align-top" data-testid="channel-row">
                  <td className="p-2">
                    <p className="font-medium">{c.scope === "platform" ? tr("خودِ سایت (IrForge)", "Site (IrForge)") : c.botName ?? c.botId}</p>
                    <p className="text-muted-foreground">{c.scope === "bot" ? c.ownerEmail : "—"}</p>
                  </td>
                  <td className="p-2"><p dir="ltr" className="font-mono">{c.cardMasked ?? c.paymentUrl ?? "—"}</p><p className="text-muted-foreground">{c.holderName} {c.bankName && `· ${c.bankName}`} · {(KIND_LABEL[c.kind] ?? [c.kind, c.kind])[fa ? 0 : 1]}</p></td>
                  <td className="p-2"><HealthBadge h={c.health} /></td>
                  <td className="p-2 whitespace-nowrap">{time(c.lastSmsAt)}</td>
                  <td className="p-2">{tr(`${num(c.counts.open)} باز · ${num(c.counts.confirmed)} تأیید / ${num(c.counts.total)}`, `${c.counts.open} open · ${c.counts.confirmed} confirmed / ${c.counts.total}`)}</td>
                  <td className="p-2">{c.counts.smsUnmatched > 0 ? <Badge variant="destructive">{num(c.counts.smsUnmatched)}</Badge> : "—"}</td>
                  <td className="p-2">
                    <Button size="sm" variant={c.active ? "outline" : "default"} className="gap-1" onClick={() => { setTarget(c); setReason(""); }}>
                      <Power className="size-3.5" /> {c.active ? tr("فعال — خاموش کن", "Active — disable") : tr("غیرفعال — روشن کن", "Disabled — enable")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.active ? tr("خاموشیِ اضطراریِ کانال", "Emergency-disable channel") : tr("روشن‌کردنِ کانال", "Enable channel")}</DialogTitle>
            <DialogDescription>
              {target?.active
                ? tr("درخواستِ جدید روی این کانال ساخته نمی‌شود (درخواست‌های جاری ادامه می‌دهند). فروشنده/کاربر همچنان می‌تواند با فیش پرداخت کند. برایِ کانالِ مشکوک یا سوءاستفاده استفاده کنید.", "No new requests can be created on this channel (running ones continue). Use for suspicious or abusive channels.")
                : tr("کانال دوباره درخواستِ جدید می‌پذیرد.", "The channel accepts new requests again.")}
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder={tr("دلیل (در لاگ و ممیزی ثبت می‌شود)", "Reason (recorded in the log & audit)")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>{tr("انصراف", "Cancel")}</Button>
            <Button variant={target?.active ? "destructive" : "default"} disabled={toggle.isPending}
              onClick={() => target && toggle.mutate({ id: target.id, active: !target.active, reason: reason || undefined }, {
                onSuccess: () => { toast({ title: tr("انجام شد", "Done") }); setTarget(null); },
                onError: (e: any) => toast({ variant: "destructive", title: e?.message ?? "Error" }),
              })}>
              {toggle.isPending && <Loader2 className="me-1.5 size-4 animate-spin" />}{tr("تأیید", "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── درخواست‌ها ─────────────────────────────────────────────────────────────

function RequestDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tr, time, num } = useFa();
  const { toast } = useToast();
  const detail = useRequestDetail(id);
  const d = detail.data;
  const decide = useDecide();
  const assign = useAssignSms();
  const [showReceipt, setShowReceipt] = useState(false);
  const receipt = useRequestReceipt(id, showReceipt);
  const [reason, setReason] = useState("");
  const open = d && (d.request.status === "pending" || d.request.status === "awaiting_review");

  function run(decision: "approve" | "reject") {
    if (!id) return;
    decide.mutate({ id, decision, reason: reason || undefined }, {
      onSuccess: (r) => { toast({ title: r.decided ? (decision === "approve" ? tr("تأیید شد", "Approved") : tr("رد شد", "Rejected")) : tr("قبلاً تصمیم گرفته شده بود", "Already decided") }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.message ?? "Error" }),
    });
  }

  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => { if (!o) { setShowReceipt(false); setReason(""); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{tr("جزئیاتِ پرداخت", "Payment details")} {d && <StatusBadge status={d.request.status} />}</DialogTitle>
          <DialogDescription dir="ltr" className="font-mono text-xs">{id}</DialogDescription>
        </DialogHeader>
        {!d ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-muted-foreground">{tr("مالک", "Owner")}</dt><dd>{d.request.scope === "platform" ? `${d.request.userName ?? ""} ${d.request.userEmail ?? ""}` : `${d.request.botName ?? d.request.botId} · ${tr("مشتری", "customer")} ${d.request.userId}`}</dd>
              <dt className="text-muted-foreground">{tr("هدف", "Purpose")}</dt><dd>{d.request.purpose === "wallet_topup" ? tr("شارژ کیف‌پول", "Wallet top-up") : `${tr("سفارش", "Order")} ${d.request.orderId}`}</dd>
              <dt className="text-muted-foreground">{tr("مبلغِ درخواستی (تومان)", "Requested (Toman)")}</dt><dd>{num(d.request.baseAmountToman)}</dd>
              <dt className="text-muted-foreground">{tr("مبلغِ نهایی (ریال)", "Final (Rial)")}</dt><dd dir="ltr" className="font-mono">{d.request.finalAmountRial.toLocaleString("en-US")} <span className="text-muted-foreground">(+{d.request.suffixRial})</span></dd>
              <dt className="text-muted-foreground">{tr("کانال", "Channel")}</dt><dd dir="ltr" className="font-mono">{d.channel.cardMasked ?? d.channel.kind} <span className="text-muted-foreground">{d.channel.holderName}</span></dd>
              <dt className="text-muted-foreground">{tr("ساخته‌شده", "Created")}</dt><dd>{time(d.request.createdAt)}</dd>
              <dt className="text-muted-foreground">{tr("مهلت", "Expires")}</dt><dd>{time(d.request.expiresAt)}</dd>
              {d.request.confirmedAt && (<><dt className="text-muted-foreground">{tr("تأیید", "Confirmed")}</dt><dd>{time(d.request.confirmedAt)} — {d.request.confirmedBy === "sms" ? tr("خودکار با پیامک", "auto (SMS)") : `${tr("ادمین", "admin")} ${d.request.confirmedByAdminId ?? ""}`}</dd></>)}
              {d.request.scope === "bot" && d.request.status === "confirmed" && (<><dt className="text-muted-foreground">{tr("اثرِ بات", "Bot effect")}</dt><dd>{d.request.effect}</dd></>)}
              {d.request.rejectReason && (<><dt className="text-muted-foreground">{tr("دلیلِ رد", "Reject reason")}</dt><dd>{d.request.rejectReason}</dd></>)}
            </dl>

            {d.request.hasReceipt && (
              <div className="space-y-2">
                <Button size="sm" variant="outline" onClick={() => setShowReceipt((v) => !v)}>{showReceipt ? tr("پنهان‌کردنِ فیش", "Hide receipt") : tr("نمایشِ فیش", "Show receipt")}</Button>
                {showReceipt && (receipt.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" />
                  : receipt.data?.kind === "image" && receipt.data.value ? <img src={receipt.data.value} alt="receipt" className="max-h-80 rounded-md border object-contain" />
                    : <p className="text-xs text-muted-foreground">{tr("فیشِ این پرداخت در تلگرام است (file_id) و در وب نمایش داده نمی‌شود؛ از پیامِ ادمینِ بات ببینید.", "This receipt lives in Telegram (file_id) and is not shown on the web; see the bot admin message.")}</p>)}
              </div>
            )}

            {open && d.candidateSms.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3" data-testid="candidates">
                <p className="text-xs font-medium">{tr("پیامکِ هم‌مبلغِ بدونِ درخواست (تخصیصِ دستی)", "Unmatched SMS with the exact amount (manual assignment)")}</p>
                {d.candidateSms.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>{time(s.receivedAt)} · {s.sender} · {num(s.amountToman)} {tr("تومان", "Toman")}</span>
                    <Button size="sm" disabled={assign.isPending} onClick={() => assign.mutate({ smsId: s.id, requestId: d.request.id }, {
                      onSuccess: () => toast({ title: tr("پیامک تخصیص و پرداخت تأیید شد", "SMS assigned & payment confirmed") }),
                      onError: (e: any) => toast({ variant: "destructive", title: e?.message ?? "Error" }),
                    })}>{tr("تخصیص و تأیید", "Assign & confirm")}</Button>
                  </div>
                ))}
              </div>
            )}

            {open && (
              <div className="space-y-2 rounded-md border p-3">
                <Textarea placeholder={tr("دلیلِ رد (اختیاری؛ به کاربر نشان داده می‌شود)", "Reject reason (optional; shown to the user)")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={decide.isPending} onClick={() => run("approve")}>{decide.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <CheckCircle2 className="me-1.5 size-4" />}{tr("تأیید دستی", "Approve")}</Button>
                  <Button size="sm" variant="destructive" disabled={decide.isPending} onClick={() => run("reject")}><XCircle className="me-1.5 size-4" />{tr("رد", "Reject")}</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{tr("اولین تصمیم برنده است؛ اگر همزمان پیامکِ بانک یا ادمینِ دیگر تصمیم بگیرد این کار اثری نمی‌گذارد. تأییدِ کیف‌پولِ سایت همان لحظه شارژ می‌کند؛ تأییدِ بات را خودِ بات اعمال می‌کند.", "First decision wins; if the bank SMS or another admin decides first this has no effect. Site wallet approvals credit instantly; bot approvals are applied by the bot.")}</p>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium">{tr("خط زمانی", "Timeline")}</p>
              {d.events.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                <ol className="space-y-1 text-xs">
                  {d.events.map((e) => <li key={e.id} className="flex gap-2"><span className="whitespace-nowrap text-muted-foreground">{time(e.at)}</span><span>{e.message || e.kind}</span></li>)}
                </ol>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestsTab() {
  const { tr, time, num } = useFa();
  const [scope, setScope] = useState(ALL);
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const list = useAdminRequests({ scope: scope === ALL ? undefined : scope, status: status === ALL ? undefined : status, q: q || undefined });
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = list.data?.requests ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-64" placeholder={tr("جستجو: مبلغِ نهایی، ایمیل، نام، بات، سفارش…", "Search: final amount, email, name, bot, order…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr("همه‌ی دامنه‌ها", "All scopes")}</SelectItem>
            <SelectItem value="platform">{tr("خودِ سایت", "Site")}</SelectItem>
            <SelectItem value="bot">{tr("بات‌ها", "Bots")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{tr("بازها (صف/پرداخت/فیش)", "Open")}</SelectItem>
            <SelectItem value="awaiting_review">{tr("منتظر بررسی فیش", "Awaiting review")}</SelectItem>
            <SelectItem value="pending">{tr("در انتظار پرداخت", "Pending")}</SelectItem>
            <SelectItem value="confirmed">{tr("تأییدشده", "Confirmed")}</SelectItem>
            <SelectItem value="expired">{tr("منقضی", "Expired")}</SelectItem>
            <SelectItem value="rejected">{tr("ردشده", "Rejected")}</SelectItem>
            <SelectItem value="canceled">{tr("لغوشده", "Canceled")}</SelectItem>
            <SelectItem value={ALL}>{tr("همه", "All")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : rows.length === 0 ? <Empty text={tr("درخواستی پیدا نشد.", "No requests found.")} /> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>{[tr("زمان", "Time"), tr("مالک", "Owner"), tr("هدف", "Purpose"), tr("مبلغ (تومان)", "Amount"), tr("مبلغ نهایی (ریال)", "Final (Rial)"), tr("وضعیت", "Status"), ""].map((h, i) => <th key={i} className="p-2 text-start font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: AdminRequest) => (
                <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpenId(r.id)} data-testid="request-row">
                  <td className="p-2 whitespace-nowrap">{time(r.createdAt)}</td>
                  <td className="p-2"><p>{r.scope === "platform" ? (r.userName ?? r.userId) : (r.botName ?? r.botId)}</p><p className="text-muted-foreground">{r.scope === "platform" ? r.userEmail : `${tr("مشتری", "customer")} ${r.userId}`}</p></td>
                  <td className="p-2">{r.purpose === "wallet_topup" ? tr("شارژ کیف‌پول", "Top-up") : `${tr("سفارش", "Order")} ${r.orderId}`}</td>
                  <td className="p-2">{num(r.baseAmountToman)}</td>
                  <td className="p-2 font-mono" dir="ltr">{r.finalAmountRial.toLocaleString("en-US")}</td>
                  <td className="p-2"><StatusBadge status={r.status} />{r.hasReceipt && <span className="ms-1" title="receipt">🧾</span>}</td>
                  <td className="p-2 text-muted-foreground">{r.legacy ? tr("قدیمی", "legacy") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RequestDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ─── پیامک‌ها ───────────────────────────────────────────────────────────────

function AssignDialog({ sms, onClose }: { sms: AdminSms | null; onClose: () => void }) {
  const { tr, time, num } = useFa();
  const { toast } = useToast();
  const list = useAdminRequests({ channelId: sms?.channelId, status: "open", q: sms?.amountRial ? String(sms.amountRial) : undefined });
  const assign = useAssignSms();
  const rows = (list.data?.requests ?? []).filter((r) => r.finalAmountRial === sms?.amountRial);
  return (
    <Dialog open={Boolean(sms)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("تخصیصِ دستیِ پیامک به یک درخواست", "Assign SMS to a request")}</DialogTitle>
          <DialogDescription>{tr("فقط درخواستِ بازِ همین کانال با مبلغِ نهایی دقیقاً برابرِ پیامک قابل‌انتخاب است. با تخصیص، پرداخت تأیید می‌شود (اثرِ مالی یک‌بار).", "Only open requests on this channel whose final amount exactly equals the SMS are listed. Assigning confirms the payment (financial effect once).")}</DialogDescription>
        </DialogHeader>
        {sms && <p className="text-xs">{time(sms.receivedAt)} · {sms.sender} · <b>{(sms.amountRial ?? 0).toLocaleString("en-US")}</b> {tr("ریال", "Rial")}</p>}
        {list.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : rows.length === 0 ? <Empty text={tr("درخواستِ بازِ هم‌مبلغی نیست.", "No matching open request.")} /> : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
                <span>{r.scope === "platform" ? (r.userName ?? r.userId) : (r.botName ?? r.botId)} · {num(r.baseAmountToman)} · <StatusBadge status={r.status} /></span>
                <Button size="sm" disabled={assign.isPending} onClick={() => sms && assign.mutate({ smsId: sms.id, requestId: r.id }, {
                  onSuccess: () => { toast({ title: tr("تخصیص و تأیید شد", "Assigned & confirmed") }); onClose(); },
                  onError: (e: any) => toast({ variant: "destructive", title: e?.message ?? "Error" }),
                })}>{tr("تخصیص و تأیید", "Assign & confirm")}</Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SmsTab() {
  const { tr, time, num } = useFa();
  const [scope, setScope] = useState(ALL);
  const [status, setStatus] = useState("attention");
  const list = useAdminSms({ scope: scope === ALL ? undefined : scope, status: status === ALL ? undefined : status });
  const [target, setTarget] = useState<AdminSms | null>(null);
  const rows = list.data?.sms ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr("همه‌ی دامنه‌ها", "All scopes")}</SelectItem>
            <SelectItem value="platform">{tr("خودِ سایت", "Site")}</SelectItem>
            <SelectItem value="bot">{tr("بات‌ها", "Bots")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="attention">{tr("واریزِ بدونِ درخواست / مبهم", "Unmatched / ambiguous deposits")}</SelectItem>
            <SelectItem value="matched">{tr("وصل‌شده", "Matched")}</SelectItem>
            <SelectItem value="ignored">{tr("نادیده (برداشت/فرستنده‌ی غیرمجاز)", "Ignored")}</SelectItem>
            <SelectItem value={ALL}>{tr("همه", "All")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{tr("متنِ پیامک با ماسکِ ارقامِ بلند نمایش داده می‌شود.", "SMS text is shown with long digit runs masked.")}</span>
      </div>
      {list.isLoading ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : rows.length === 0 ? <Empty text={tr("پیامکی پیدا نشد.", "No SMS found.")} /> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[820px] text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>{[tr("زمان (وقت ایران)", "Time (Iran)"), tr("کانال", "Channel"), tr("فرستنده", "Sender"), tr("مبلغ (تومان)", "Amount"), tr("وضعیت", "Status"), tr("متن", "Text"), ""].map((h, i) => <th key={i} className="p-2 text-start font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t align-top" data-testid="sms-row">
                  <td className="p-2 whitespace-nowrap">{time(s.receivedAt)}</td>
                  <td className="p-2">{s.scope === "platform" ? tr("سایت", "Site") : (s.botName ?? s.botId)}</td>
                  <td className="p-2">{s.sender}{s.isTest && <Badge variant="outline" className="ms-1 font-normal">{tr("آزمایشی", "test")}</Badge>}</td>
                  <td className="p-2">{s.amountToman === null ? "—" : num(s.amountToman)}</td>
                  <td className="p-2"><StatusBadge status={s.status} /></td>
                  <td className="max-w-xs p-2 text-muted-foreground"><span className="line-clamp-2">{s.preview}</span></td>
                  <td className="p-2">{(s.status === "unmatched" || s.status === "ambiguous") && s.parsedOk && s.direction === "deposit" && <Button size="sm" variant="outline" onClick={() => setTarget(s)}>{tr("تخصیص", "Assign")}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AssignDialog sms={target} onClose={() => setTarget(null)} />
    </div>
  );
}

// ─── لاگ ────────────────────────────────────────────────────────────────────

function LogTab() {
  const { tr, time } = useFa();
  const [level, setLevel] = useState("problems");
  const [scope, setScope] = useState(ALL);
  const [kind, setKind] = useState("");
  const list = useAdminEvents({ level: level === ALL ? undefined : level, scope: scope === ALL ? undefined : scope, kind: kind || undefined });
  const rows = list.data?.events ?? [];
  const color = useMemo(() => ({ info: "text-muted-foreground", warn: "text-amber-600 dark:text-amber-400", error: "text-destructive" } as const), []);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="problems">{tr("فقط هشدار و خطا", "Warnings & errors")}</SelectItem>
            <SelectItem value={ALL}>{tr("همه‌ی رویدادها", "All events")}</SelectItem>
            <SelectItem value="error">{tr("فقط خطا", "Errors only")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr("همه‌ی دامنه‌ها", "All scopes")}</SelectItem>
            <SelectItem value="platform">{tr("خودِ سایت", "Site")}</SelectItem>
            <SelectItem value="bot">{tr("بات‌ها", "Bots")}</SelectItem>
          </SelectContent>
        </Select>
        <Input className="max-w-52" dir="ltr" placeholder="kind (sms_received, confirmed_by_sms…)" value={kind} onChange={(e) => setKind(e.target.value.trim())} />
      </div>
      <p className="text-xs text-muted-foreground">{tr("این لاگ هرگز متنِ خامِ پیامک، شماره‌کارتِ کامل یا کلید ندارد؛ ۹۰ روز نگه داشته می‌شود.", "This log never contains raw SMS text, full card numbers or keys; kept for 90 days.")}</p>
      {list.isLoading ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : rows.length === 0 ? <Empty text={tr("رویدادی نیست.", "No events.")} /> : (
        <ul className="divide-y rounded-md border text-xs" data-testid="event-list">
          {rows.map((e: AdminEvent) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 p-2">
              <span className="whitespace-nowrap text-muted-foreground">{time(e.at)}</span>
              <span className={`font-mono ${color[e.level]}`} dir="ltr">{e.kind}</span>
              <span className="min-w-0 flex-1">{e.message}</span>
              <span className="text-muted-foreground" dir="ltr">{[e.scope, e.botId, e.actor].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── ریشه ───────────────────────────────────────────────────────────────────

export function CardAutoConfirmAdmin() {
  const { tr } = useFa();
  const [tab, setTab] = useState("overview");
  return (
    <div className="space-y-4" data-testid="card-admin">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><RefreshCcw className="size-4" /> {tr("کارت‌به‌کارت خودکار — مدیریت", "Automatic card-to-card — management")}</h2>
          <p className="text-xs text-muted-foreground">{tr("شارژ کیف‌پولِ سایت و فروشِ بات‌ها؛ تأیید با پیامکِ بانک. همه‌ی زمان‌ها به وقتِ ایران.", "Site wallet top-ups and bot sales; confirmed by bank SMS. All times in Iran time.")}</p>
        </div>
        <Button size="sm" variant="outline" asChild><Link href="/tutorials/cardpay"><BookOpen className="me-1.5 size-4" /> {tr("آموزشِ کامل", "Full tutorial")}</Link></Button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">{tr("نمای کلی", "Overview")}</TabsTrigger>
          <TabsTrigger value="platform">{tr("کانال‌های خودِ سایت", "Site channels")}</TabsTrigger>
          <TabsTrigger value="channels">{tr("همه‌ی کانال‌ها", "All channels")}</TabsTrigger>
          <TabsTrigger value="requests">{tr("درخواست‌ها", "Requests")}</TabsTrigger>
          <TabsTrigger value="sms">{tr("پیامک‌ها", "SMS inbox")}</TabsTrigger>
          <TabsTrigger value="log">{tr("لاگ", "Log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab onGo={setTab} /></TabsContent>
        <TabsContent value="platform"><PlatformTab /></TabsContent>
        <TabsContent value="channels"><ChannelsTab /></TabsContent>
        <TabsContent value="requests"><RequestsTab /></TabsContent>
        <TabsContent value="sms"><SmsTab /></TabsContent>
        <TabsContent value="log"><LogTab /></TabsContent>
      </Tabs>
    </div>
  );
}
