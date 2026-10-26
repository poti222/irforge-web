import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Loader2, Copy, Check, Plus, Trash2, Pencil, FlaskConical, KeyRound, Bot, UserRound, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/forge-ui/PageHeader";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import {
  createSmsForwardAccount, createSmsForwardRule, deleteSmsForwardAccount, deleteSmsForwardBot, deleteSmsForwardRule,
  deleteSmsForwardUserbot, getSmsForwardOverview, rotateSmsForwardSecret, setSmsForwardBot, setSmsForwardEnabled,
  smsForwardUserbotSendCode, smsForwardUserbotVerify, testSmsForwardRule, updateSmsForwardRule,
  type SmsForwardAccount, type SmsForwardLogRow, type SmsForwardRule, type SmsForwardVia,
} from "@/lib/sms-forward-api";

/**
 * pages/sms-forward.tsx — «ارسال پیامک به تلگرام».
 *
 * برنامه‌ی پیامک‌خوانِ گوشی (مثل MacroDroid) هر پیامکِ انتخاب‌شده را به **یک** آدرسِ وبهوک می‌فرستد؛ اینجا
 * مشخص می‌کنید هر پیامک (بر اساسِ فرستنده/کلمه) به کدام چتِ تلگرام و از کدام مسیر (بات / اکانتِ شخصی) برسد.
 * فعلاً فقط سوپرادمین؛ همه‌چیز per-user است تا بعداً برای همه باز شود.
 */

type T = (fa: string, en: string) => string;

function useCopy(t: T) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy(key: string, value: string) {
      void navigator.clipboard?.writeText(value).then(() => {
        setCopied(key);
        toast({ title: t("کپی شد", "Copied") });
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      }).catch(() => {});
    },
  };
}

function errText(e: unknown, t: T): string {
  return e instanceof Error && e.message ? e.message : t("خطای ناشناخته", "Unknown error");
}

function timeAgo(iso: string | null, t: T): string {
  if (!iso) return t("هنوز پیامکی نرسیده", "No SMS received yet");
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return t("لحظاتی پیش", "just now");
  if (s < 3600) return t(`${Math.floor(s / 60)} دقیقه پیش`, `${Math.floor(s / 60)} min ago`);
  if (s < 86400) return t(`${Math.floor(s / 3600)} ساعت پیش`, `${Math.floor(s / 3600)} h ago`);
  return new Date(iso).toLocaleString();
}

const VIA_LABEL = (t: T): Record<SmsForwardVia, string> => ({
  bot: t("بات", "Bot"),
  userbot: t("اکانتِ شخصی", "Personal account"),
  both: t("هر دو (اول اکانت، بعد بات)", "Both (account first, bot as fallback)"),
});

export default function SmsForward() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t: T = (a, b) => (fa ? a : b);
  const { toast } = useToast();
  const qc = useQueryClient();
  usePrivatePageTitle(t("ارسال پیامک به تلگرام", "SMS to Telegram"));

  const { data, isLoading } = useQuery({ queryKey: ["sms-forward"], queryFn: getSmsForwardOverview, refetchInterval: 10_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sms-forward"] });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errText(e, t), variant: "destructive" });

  // secret فقط یک‌بار (بعد از ساخت/چرخش) نمایش داده می‌شود؛ هرگز از سرور دوباره خوانده نمی‌شود.
  const [secret, setSecret] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createSmsForwardAccount,
    onSuccess: (r) => { setSecret(r.secret); refresh(); },
    onError: fail(t("ساخت وبهوک انجام نشد", "Couldn't create the webhook")),
  });

  const account = data?.account ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        icon={<Send />}
        eyebrow={t("اتوماسیون پیامک", "SMS automation")}
        title={t("ارسال پیامک به تلگرام", "SMS to Telegram")}
        description={t(
          "پیامک‌هایی که برنامه‌ی گوشی‌تان می‌فرستد، عیناً به هر چتِ تلگرامی که تعیین می‌کنید ارسال می‌شود — از طریق بات یا اکانتِ خودتان.",
          "SMS messages your phone app sends here are forwarded as-is to any Telegram chat you choose — via a bot or your own account.",
        )}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : !account ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("از اینجا شروع کنید", "Start here")}</CardTitle>
            <CardDescription>
              {t(
                "هر اکانت فقط یک آدرسِ وبهوک دارد؛ آن را یک‌بار در برنامه‌ی گوشی می‌گذارید و مقصدها را همین‌جا با قانون تعیین می‌کنید.",
                "Each account gets exactly one webhook URL. Put it in your phone app once, then route messages to destinations with rules here.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="smsfwd-create">
              {create.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <KeyRound className="me-2 size-4" />}
              {t("ساخت وبهوک", "Create webhook")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <WebhookCard account={account} secret={secret} setSecret={setSecret} t={t} refresh={refresh} fail={fail} />
          <SendersCard account={account} t={t} refresh={refresh} fail={fail} />
          <RulesCard account={account} rules={data?.rules ?? []} t={t} refresh={refresh} fail={fail} />
          <LogCard log={data?.log ?? []} t={t} />
        </>
      )}
    </div>
  );
}

// ─── وبهوک ──────────────────────────────────────────────────────────────────

type Common = { t: T; refresh: () => void; fail: (title: string) => (e: unknown) => void };

function WebhookCard({ account, secret, setSecret, t, refresh, fail }: Common & { account: SmsForwardAccount; secret: string | null; setSecret: (s: string | null) => void }) {
  const { copied, copy } = useCopy(t);
  const url = `${window.location.origin}${account.webhookPath}`;

  const toggle = useMutation({ mutationFn: (v: boolean) => setSmsForwardEnabled(v), onSuccess: refresh, onError: fail(t("تغییر وضعیت انجام نشد", "Couldn't change status")) });
  const rotate = useMutation({
    mutationFn: rotateSmsForwardSecret,
    onSuccess: (r) => { setSecret(r.secret); refresh(); },
    onError: fail(t("چرخش کلید انجام نشد", "Couldn't rotate the key")),
  });
  const remove = useMutation({
    mutationFn: deleteSmsForwardAccount,
    onSuccess: () => { setSecret(null); refresh(); },
    onError: fail(t("حذف انجام نشد", "Couldn't delete")),
  });

  const Row = ({ k, label, value }: { k: string; label: string; value: string }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-left text-xs">{value}</code>
        <Button type="button" variant="outline" size="icon" onClick={() => copy(k, value)} aria-label={t("کپی", "Copy")}>
          {copied === k ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t("وبهوک", "Webhook")}</CardTitle>
          <CardDescription>{t("آخرین پیامک:", "Last SMS:")} {timeAgo(account.lastReceivedAt, t)}</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>{account.enabled ? t("فعال", "Enabled") : t("غیرفعال", "Disabled")}</span>
          <Switch checked={account.enabled} onCheckedChange={(v) => toggle.mutate(v)} disabled={toggle.isPending} data-testid="smsfwd-enabled" />
        </label>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row k="url" label={t("آدرس (URL)", "URL")} value={url} />

        {secret ? (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium"><TriangleAlert className="size-4 text-amber-500" />{t("کلید فقط همین یک‌بار نمایش داده می‌شود — الان کپی کنید.", "This key is shown only once — copy it now.")}</p>
            <Row k="secret" label={t("کلید (هدر X-Sms-Secret)", "Key (X-Sms-Secret header)")} value={secret} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>{t("کپی کردم، پنهان کن", "I copied it, hide")}</Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("کلید برای امنیت فقط هش‌شده ذخیره می‌شود و دوباره نمایش داده نمی‌شود. گم کردید؟ کلید را بچرخانید.", "The key is stored hashed only and can't be shown again. Lost it? Rotate the key.")}</p>
        )}

        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("تنظیم برنامه‌ی گوشی (MacroDroid و مشابه)", "Phone app setup (MacroDroid and similar)")}</summary>
          <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-muted-foreground">
            <li>{t("اکشن «HTTP Request»: متد POST، آدرسِ بالا.", "Action “HTTP Request”: method POST, the URL above.")}</li>
            <li>{t("Content-Type: text/plain و بدنه = متنِ پیامک (در MacroDroid: {sms_message}).", "Content-Type: text/plain and body = the SMS text (MacroDroid: {sms_message}).")}</li>
            <li dir="ltr" className="text-left">Header <code>X-Sms-Secret: &lt;key&gt;</code></li>
            <li dir="ltr" className="text-left">{t("اختیاری:", "Optional:")} <code>X-Sms-Sender: {"{sms_sender}"}</code></li>
            <li>{t("پیامک‌هایی که می‌خواهید بروند را در تریگرِ ماکرو انتخاب کنید؛ هر چه برسد، قانون‌های پایین تصمیم می‌گیرند به کجا برود.", "Pick which SMS to send in the macro trigger; whatever arrives is routed by the rules below.")}</li>
          </ol>
        </details>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={rotate.isPending}
            onClick={() => { if (window.confirm(t("کلیدِ فعلی همین لحظه از کار می‌افتد و باید در برنامه‌ی گوشی عوض شود. ادامه؟", "The current key stops working immediately and must be updated in the phone app. Continue?"))) rotate.mutate(); }}>
            {rotate.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <RefreshCw className="me-2 size-4" />}{t("چرخش کلید", "Rotate key")}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={remove.isPending}
            onClick={() => { if (window.confirm(t("وبهوک، قانون‌ها، مسیرهای ارسال و لاگ حذف می‌شوند. ادامه؟", "The webhook, rules, senders and log will be deleted. Continue?"))) remove.mutate(); }}>
            <Trash2 className="me-2 size-4" />{t("حذفِ همه", "Delete everything")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── مسیرهای ارسال ──────────────────────────────────────────────────────────

function SendersCard({ account, t, refresh, fail }: Common & { account: SmsForwardAccount }) {
  const configured = account.bot.configured || account.userbot.configured;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("مسیر ارسال", "Sending method")}</CardTitle>
        <CardDescription>
          {t("پیام از کجا فرستاده شود؟ هر دو را می‌توانید وصل کنید؛ حداقل یکی لازم است.", "Where should messages be sent from? You can connect both; at least one is required.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured && (
          <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm"><TriangleAlert className="size-4 text-amber-500" />{t("هنوز هیچ مسیری وصل نیست؛ بدونِ آن پیامی ارسال نمی‌شود.", "No sender connected yet — nothing will be sent.")}</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <BotPanel account={account} t={t} refresh={refresh} fail={fail} />
          <UserbotPanel account={account} t={t} refresh={refresh} fail={fail} />
        </div>
      </CardContent>
    </Card>
  );
}

function BotPanel({ account, t, refresh, fail }: Common & { account: SmsForwardAccount }) {
  const [token, setToken] = useState("");
  const save = useMutation({ mutationFn: () => setSmsForwardBot(token.trim()), onSuccess: () => { setToken(""); refresh(); }, onError: fail(t("ذخیره‌ی بات انجام نشد", "Couldn't save the bot")) });
  const remove = useMutation({ mutationFn: deleteSmsForwardBot, onSuccess: refresh, onError: fail(t("حذف بات انجام نشد", "Couldn't remove the bot")) });
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2 font-medium"><Bot className="size-4" />{t("بات تلگرام", "Telegram bot")}
        {account.bot.configured && <Badge variant="secondary" dir="ltr">@{account.bot.username}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">{t("توکنِ باتی را که از BotFather ساخته‌اید وارد کنید. بات باید در گروه/کانالِ مقصد عضو (کانال: ادمین) باشد، یا مقصدِ خصوصی قبلاً /start زده باشد.", "Paste the token of a bot you made with BotFather. The bot must be a member (admin for channels) of the target group/channel, or the private target must have pressed /start.")}</p>
      {account.bot.configured ? (
        <Button type="button" variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("حذفِ بات", "Remove bot")}</Button>
      ) : (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (token.trim()) save.mutate(); }}>
          <Input dir="ltr" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value)} data-testid="smsfwd-bot-token" />
          <Button type="submit" disabled={save.isPending || !token.trim()}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : t("ذخیره", "Save")}</Button>
        </form>
      )}
    </div>
  );
}

function UserbotPanel({ account, t, refresh, fail }: Common & { account: SmsForwardAccount }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [needPassword, setNeedPassword] = useState(false);

  const sendCode = useMutation({
    mutationFn: () => smsForwardUserbotSendCode(phone.trim()),
    onSuccess: () => { setStep("code"); setNeedPassword(false); setCode(""); setPassword(""); },
    onError: fail(t("ارسال کد انجام نشد", "Couldn't send the code")),
  });
  const verify = useMutation({
    mutationFn: () => smsForwardUserbotVerify(code.trim(), needPassword ? password : undefined),
    onSuccess: (r) => {
      if (r.passwordNeeded) { setNeedPassword(true); return; }
      setStep("phone"); setPhone(""); setCode(""); setPassword(""); setNeedPassword(false); refresh();
    },
    onError: fail(t("ورود انجام نشد", "Sign-in failed")),
  });
  const remove = useMutation({ mutationFn: deleteSmsForwardUserbot, onSuccess: refresh, onError: fail(t("خروج انجام نشد", "Couldn't disconnect")) });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2 font-medium"><UserRound className="size-4" />{t("اکانتِ شخصی تلگرام", "Personal Telegram account")}
        {account.userbot.configured && <Badge variant="secondary" dir="ltr">{account.userbot.label}</Badge>}
      </div>
      {!account.userbot.available ? (
        <p className="text-xs text-muted-foreground">{t("این مسیر روی سرور فعال نیست (کلیدهای TELEGRAM_API_ID و TELEGRAM_API_HASH تنظیم نشده‌اند). بات بدونِ آن کار می‌کند.", "Not enabled on this server (TELEGRAM_API_ID / TELEGRAM_API_HASH are not set). The bot method works without it.")}</p>
      ) : account.userbot.configured ? (
        <Button type="button" variant="outline" size="sm" disabled={remove.isPending} onClick={() => { if (window.confirm(t("نشستِ اکانت از تلگرام بسته می‌شود. ادامه؟", "The account session will be closed on Telegram. Continue?"))) remove.mutate(); }}>{t("قطعِ اکانت", "Disconnect account")}</Button>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("پیام از خودِ اکانتِ شما فرستاده می‌شود. ⚠️ ارسالِ انبوه/اسپم باعث محدود یا بن‌شدنِ اکانت می‌شود؛ و نشستِ ذخیره‌شده معادلِ دسترسیِ کاملِ اکانت است. اگر نگرانید، از مسیرِ بات استفاده کنید.", "Messages are sent from your own account. ⚠️ Bulk/spam sending can get an account limited or banned, and the stored session equals full account access. If unsure, use the bot method.")}</p>
          {step === "phone" ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (phone.trim()) sendCode.mutate(); }}>
              <Input dir="ltr" inputMode="tel" placeholder="+98912…" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="smsfwd-phone" />
              <Button type="submit" disabled={sendCode.isPending || !phone.trim()}>{sendCode.isPending ? <Loader2 className="size-4 animate-spin" /> : t("ارسال کد", "Send code")}</Button>
            </form>
          ) : (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) verify.mutate(); }}>
              <p className="text-xs text-muted-foreground">{t("کدِ ورود را که تلگرام برایتان فرستاد وارد کنید.", "Enter the login code Telegram sent you.")}</p>
              <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" placeholder="12345" value={code} onChange={(e) => setCode(e.target.value)} data-testid="smsfwd-code" />
              {needPassword && (
                <Input dir="ltr" type="password" autoComplete="off" placeholder={t("رمزِ دومرحله‌ای", "Two-step password")} value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={verify.isPending || !code.trim() || (needPassword && !password)}>{verify.isPending ? <Loader2 className="size-4 animate-spin" /> : t("ورود", "Sign in")}</Button>
                <Button type="button" variant="ghost" onClick={() => { setStep("phone"); setNeedPassword(false); }}>{t("بازگشت", "Back")}</Button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

// ─── قانون‌ها ───────────────────────────────────────────────────────────────

interface RuleForm { name: string; chatRef: string; via: SmsForwardVia; senders: string; keyword: string }
const emptyForm = (via: SmsForwardVia): RuleForm => ({ name: "", chatRef: "", via, senders: "", keyword: "" });

function RulesCard({ account, rules, t, refresh, fail }: Common & { account: SmsForwardAccount; rules: SmsForwardRule[] }) {
  const { toast } = useToast();
  const viaLabel = VIA_LABEL(t);
  const defaultVia: SmsForwardVia = account.bot.configured && account.userbot.configured ? "both" : account.userbot.configured ? "userbot" : "bot";
  const [editing, setEditing] = useState<SmsForwardRule | "new" | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm(defaultVia));
  const anySender = account.bot.configured || account.userbot.configured;

  const open = (r: SmsForwardRule | "new") => {
    setEditing(r);
    setForm(r === "new" ? emptyForm(defaultVia) : { name: r.name, chatRef: r.chatRef, via: r.via, senders: r.senderFilter.join(", "), keyword: r.keyword ?? "" });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, chatRef: form.chatRef, via: form.via, senderFilter: form.senders, keyword: form.keyword } as never;
      return editing === "new" || editing === null ? createSmsForwardRule(body) : updateSmsForwardRule(editing.id, body);
    },
    onSuccess: () => { setEditing(null); refresh(); },
    onError: fail(t("ذخیره‌ی قانون انجام نشد", "Couldn't save the rule")),
  });
  const toggle = useMutation({ mutationFn: (r: SmsForwardRule) => updateSmsForwardRule(r.id, { enabled: !r.enabled }), onSuccess: refresh, onError: fail(t("تغییر وضعیت انجام نشد", "Couldn't change status")) });
  const remove = useMutation({ mutationFn: (id: string) => deleteSmsForwardRule(id), onSuccess: refresh, onError: fail(t("حذف انجام نشد", "Couldn't delete")) });
  const test = useMutation({
    mutationFn: (id: string) => testSmsForwardRule(id),
    onSuccess: (r) => {
      refresh();
      toast(r.ok
        ? { title: t("پیام آزمایشی ارسال شد", "Test message sent"), description: r.via === "userbot" ? t("از اکانتِ شخصی", "via personal account") : t("از بات", "via bot") }
        : { title: t("ارسال ناموفق بود", "Sending failed"), description: r.error ?? "", variant: "destructive" });
    },
    onError: fail(t("آزمایش انجام نشد", "Test failed")),
  });

  const viaOptions: SmsForwardVia[] = (["bot", "userbot", "both"] as const).filter((v) =>
    v === "bot" ? account.bot.configured : v === "userbot" ? account.userbot.configured : anySender);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t("قانون‌ها (مقصدها)", "Rules (destinations)")}</CardTitle>
          <CardDescription>
            {t("چون فقط یک وبهوک دارید، اینجا مشخص می‌کنید هر پیامک به کجا برود. هر پیامک با همه‌ی قانون‌های مطابق ارسال می‌شود؛ فیلترِ خالی یعنی «همه».", "With a single webhook, rules decide where each SMS goes. A message is sent via every matching rule; an empty filter means “everything”.")}
          </CardDescription>
        </div>
        <Button onClick={() => open("new")} disabled={!anySender} data-testid="smsfwd-new-rule"><Plus className="me-2 size-4" />{t("قانون جدید", "New rule")}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {anySender ? t("هنوز قانونی نساخته‌اید. بدونِ قانون، پیامک‌ها فقط در لاگ ثبت می‌شوند و جایی نمی‌روند.", "No rules yet. Without rules, messages are only logged and go nowhere.") : t("اول یک مسیر ارسال (بات یا اکانتِ شخصی) وصل کنید.", "Connect a sender (bot or personal account) first.")}
          </p>
        ) : rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-testid={`smsfwd-rule-${r.id}`}>
            <Switch checked={r.enabled} onCheckedChange={() => toggle.mutate(r)} aria-label={r.name} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <Badge variant="outline">{viaLabel[r.via]}</Badge>
                <Badge variant="secondary" dir="ltr">→ {r.chatRef}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("فرستنده:", "Sender:")} {r.senderFilter.length ? r.senderFilter.join("، ") : t("همه", "any")}
                {" · "}{t("کلمه:", "Keyword:")} {r.keyword ?? t("همه", "any")}
              </p>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" title={t("ارسالِ آزمایشی", "Send test")} disabled={test.isPending} onClick={() => test.mutate(r.id)}>
                {test.isPending && test.variables === r.id ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
              </Button>
              <Button type="button" variant="ghost" size="icon" title={t("ویرایش", "Edit")} onClick={() => open(r)}><Pencil className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="text-destructive" title={t("حذف", "Delete")}
                onClick={() => { if (window.confirm(t("این قانون حذف شود؟", "Delete this rule?"))) remove.mutate(r.id); }}><Trash2 className="size-4" /></Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("قانونِ جدید", "New rule") : t("ویرایشِ قانون", "Edit rule")}</DialogTitle>
            <DialogDescription>{t("پیامک‌هایی که با این فیلترها بخوانند عیناً به مقصد فرستاده می‌شوند.", "SMS matching these filters are forwarded as-is to the destination.")}</DialogDescription>
          </DialogHeader>
          <form id="smsfwd-rule-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="space-y-1.5">
              <Label>{t("نام", "Name")}</Label>
              <Input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("مثلاً پیامک‌های بانک", "e.g. Bank SMS")} data-testid="smsfwd-rule-name" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("مقصدِ تلگرام", "Telegram destination")}</Label>
              <Input dir="ltr" value={form.chatRef} onChange={(e) => setForm({ ...form, chatRef: e.target.value })} placeholder="@channel  |  -1001234567890  |  me" data-testid="smsfwd-rule-chat" />
              <p className="text-xs text-muted-foreground">{t("@username، شناسه‌ی عددیِ چت، یا «me» (پیام‌های ذخیره‌شده؛ فقط اکانتِ شخصی).", "@username, numeric chat id, or “me” (Saved Messages; personal account only).")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("ارسال از", "Send via")}</Label>
              <Select value={form.via} onValueChange={(v) => setForm({ ...form, via: v as SmsForwardVia })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {viaOptions.map((v) => <SelectItem key={v} value={v}>{viaLabel[v]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("فقط از این فرستنده‌ها (اختیاری)", "Only from these senders (optional)")}</Label>
                <Input dir="ltr" value={form.senders} onChange={(e) => setForm({ ...form, senders: e.target.value })} placeholder="Blubank, 10001" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("فقط اگر شاملِ این کلمه بود (اختیاری)", "Only if it contains (optional)")}</Label>
                <Input value={form.keyword} maxLength={100} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder={t("مثلاً واریز", "e.g. deposit")} />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("انصراف", "Cancel")}</Button>
            <Button type="submit" form="smsfwd-rule-form" disabled={save.isPending || !form.name.trim() || !form.chatRef.trim()} data-testid="smsfwd-rule-save">
              {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}{t("ذخیره", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── لاگ ────────────────────────────────────────────────────────────────────

function LogCard({ log, t }: { log: SmsForwardLogRow[]; t: T }) {
  const status = (s: SmsForwardLogRow["status"]) =>
    s === "sent" ? <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">{t("ارسال شد", "Sent")}</Badge>
    : s === "failed" ? <Badge variant="destructive">{t("ناموفق", "Failed")}</Badge>
    : s === "duplicate" ? <Badge variant="secondary">{t("تکراری", "Duplicate")}</Badge>
    : <Badge variant="outline">{t("بدونِ قانون", "No rule")}</Badge>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("لاگِ اخیر", "Recent activity")}</CardTitle>
        <CardDescription>{t("متنِ پیامک‌ها برای حفظِ حریم خصوصی ذخیره نمی‌شود؛ فقط فرستنده، طول و نتیجه تا ۳۰ روز.", "SMS text is never stored; only sender, length and result for 30 days.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {log.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("هنوز چیزی ثبت نشده.", "Nothing yet.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-start font-medium">{t("زمان", "Time")}</th>
                  <th className="p-2 text-start font-medium">{t("فرستنده", "Sender")}</th>
                  <th className="p-2 text-start font-medium">{t("قانون", "Rule")}</th>
                  <th className="p-2 text-start font-medium">{t("نتیجه", "Result")}</th>
                  <th className="p-2 text-start font-medium">{t("جزئیات", "Details")}</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(l.receivedAt).toLocaleString()}</td>
                    <td className="p-2" dir="ltr">{l.sender ?? "—"}</td>
                    <td className="p-2">{l.ruleName ?? "—"}</td>
                    <td className="p-2">{status(l.status)}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {l.via ? (l.via === "userbot" ? t("اکانتِ شخصی", "account") : t("بات", "bot")) : ""}{l.error ? ` — ${l.error}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
