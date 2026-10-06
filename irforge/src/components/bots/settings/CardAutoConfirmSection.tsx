/**
 * CardAutoConfirmSection.tsx — «کارت‌به‌کارت خودکار (تأیید با پیامک بانک)» — IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۷.
 *
 * فروشنده اینجا کانالِ پرداختِ خودش را می‌سازد/ویرایش می‌کند، آدرسِ وبهوک و کلیدِ امنیتیِ گوشی را می‌گیرد، پیامکِ
 * آزمایشی می‌فرستد و سلامتِ اتصالِ گوشی را می‌بیند. جدا از نوارِ ذخیره‌ی بالای تب است: هر عملیات همان لحظه روی
 * API کانال‌ها انجام می‌شود (نه draft).
 *
 * امنیت: شماره‌کارتِ کامل هرگز از سرور نمی‌آید (فقط ماسک)؛ کلیدِ امنیتی فقط یک‌بار (بعد از ساخت/چرخش) در stateِ
 * محلیِ دیالوگ است و با بستنش پاک می‌شود — نه در cacheِ query و نه در localStorage.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle, BookOpen, Check, CheckCircle2, Copy, GraduationCap, KeyRound, Loader2, Pencil, Plus, RefreshCcw, Send,
  Smartphone, Trash2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/contexts/AuthContext";
import { apiErrorMessage } from "./api";
import {
  useCardChannels, useCardGuide, useCardSmsLog, useCreateCardChannel, useDeleteCardChannel, useRotateCardSecret,
  useSaveCardGuide, useTestCardSms, useUpdateCardChannel,
  MAX_CHANNEL_DESCRIPTION, type CardChannel, type CardChannelForm, type CardChannelPatch, type TestSmsResult,
} from "./cardChannelsApi";
import { deriveFormKind, formProblems, willHaveCard, type LinkType } from "./cardChannelForm";

const SECRET_HEADER = "X-Sms-Secret";
// بدنه = فقط Magic Textِ «SMS Message» (Content-Type: text/plain). هیچ متنِ دیگری نگذارید؛ مبلغ را سرور خودش از متنِ پیامک می‌خواند.
const SAMPLE_BODY = "{sms_message}";

/** ۴رقم‌۴رقم؛ ذخیره همیشه بدونِ فاصله. */
function formatCardNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function fmtTime(iso: string | null, lang: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "fa" ? "fa-IR" : "en-US", { timeZone: "Asia/Tehran" });
  } catch {
    return iso;
  }
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

function useCopy() {
  const { toast } = useToast();
  const t = useT("botSettings");
  return (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast({ title: t.cardAutoCopied })).catch(() => {});
  };
}

// ─── کادرِ زردِ راهنما (فقط سوپرادمین ویرایش می‌کند) ─────────────────────────

function GuideCallout() {
  const t = useT("botSettings");
  const tTutorial = useT("tutorial");
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const guide = useCardGuide();
  const save = useSaveCardGuide();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  if (!guide.data) return null;
  const g = guide.data;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200" data-testid="card-guide">
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          {editing ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="card-guide-title">{t.cardAutoGuideTitleLabel}</Label>
                <Input id="card-guide-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-label="guide text" />
              <div className="space-y-1">
                <Label htmlFor="card-guide-url">{t.cardAutoGuideUrlLabel}</Label>
                <Input id="card-guide-url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={save.isPending || !text.trim()}
                  onClick={() =>
                    save.mutate({ title, text, tutorialUrl: url }, {
                      onSuccess: () => setEditing(false),
                      onError: (e) => toast({ title: apiErrorMessage(e, "Error"), variant: "destructive" }),
                    })
                  }
                >
                  {t.cardAutoGuideSave}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t.cardAutoCancel}</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">{g.title}</p>
              {/* متنِ ساده: هر خط یک بند. هرگز به‌صورت HTML نمایش داده نمی‌شود. */}
              <div className="space-y-1 whitespace-pre-line text-xs leading-6">{g.text}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/tutorials/cardpay"
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-background"
                  data-testid="card-guide-full-tutorial"
                >
                  <BookOpen className="size-3" aria-hidden="true" /> {tTutorial.fullPageCta}
                </Link>
                {g.tutorialUrl && (
                  <a
                    href={g.tutorialUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-background"
                  >
                    {t.cardAutoGuideLink}
                  </a>
                )}
                {isSuperAdmin && (
                  <Button
                    size="sm" variant="outline" className="h-7"
                    onClick={() => { setTitle(g.title); setText(g.text); setUrl(g.tutorialUrl); setEditing(true); }}
                  >
                    <Pencil className="me-1 size-3" /> {t.cardAutoGuideEdit}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── دیالوگِ کلیدِ امنیتی (فقط یک‌بار) ──────────────────────────────────────

/** لینکِ راه‌اندازیِ اپِ «IrForge Pay Agent» (mobile/) — با اسکنِ QR یا چسباندنِ لینک، همه‌ی تنظیمات یک‌جا وارد می‌شود. */
export function buildAgentSetupLink(channel: CardChannel, secret: string): string {
  const q = new URLSearchParams();
  q.append("u", channel.webhookUrl);
  q.append("s", secret);
  if (channel.senderAllowlist.length) q.append("b", channel.senderAllowlist.join(","));
  return `irforge-pay://setup?${q.toString()}`;
}

function SecretDialog({ secret, channel, onClose }: { secret: string; channel: CardChannel; onClose: () => void }) {
  const t = useT("botSettings");
  const copy = useCopy();
  const agentLink = buildAgentSetupLink(channel, secret);
  const row = (label: string, value: string, dataTestId: string) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code dir="ltr" data-testid={dataTestId} className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 text-xs">{value}</code>
        <Button type="button" size="sm" variant="outline" onClick={() => copy(value)} aria-label={t.cardAutoCopy}>
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-4" /> {t.cardAutoSecretTitle}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t.cardAutoSecretWarn}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-md border p-3" data-testid="agent-qr">
            <QRCodeSVG value={agentLink} size={112} level="M" marginSize={1} />
            <div className="min-w-0 flex-1 space-y-1.5 text-xs">
              <div className="font-medium">اتصال با اپ IrForge Pay Agent</div>
              <p className="text-muted-foreground">در اپ، «اسکن QR» را بزنید. این QR شامل کلید امنیتی است؛ جایی ذخیره یا منتشرش نکنید.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => copy(agentLink)}>
                <Copy className="me-1.5 size-3.5" /> کپی لینک راه‌اندازی
              </Button>
            </div>
          </div>
          {row(t.cardAutoWebhook, channel.webhookUrl, "secret-url")}
          {row(t.cardAutoSecretHeader, SECRET_HEADER, "secret-header")}
          {row(t.cardAutoSecretValue, secret, "secret-value")}
          {row("Content-Type", "text/plain", "secret-content-type")}
          {channel.senderAllowlist[0] && row("X-Sms-Sender", channel.senderAllowlist[0], "secret-sender")}
          {row(t.cardAutoSecretBody, SAMPLE_BODY, "secret-body")}
        </div>
        <DialogFooter>
          <Button onClick={onClose}><Check className="me-1.5 size-4" /> {t.cardAutoDone}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── پیش‌نمایشِ آنچه مشتری در بات می‌بیند ──────────────────────────────────────

/** همان ترتیبِ پیامِ پرداختِ بات: شماره‌کارت، «به‌نام …»، «بانک …»، توضیحات، و دکمه‌ی لینک (اگر لینک هست). */
function CustomerPreview({ f }: { f: CardChannelForm }) {
  const t = useT("botSettings");
  // هنگامِ ویرایش، شماره‌کارتِ قبلی از سرور نمی‌آید (فقط ماسک)؛ پیش‌نمایش فقط از چیزی که الان در فرم هست ساخته می‌شود.
  const hasAny = f.cardNumber || f.paymentUrl.trim() || f.holderName.trim() || f.bankName.trim() || f.description.trim();
  return (
    <div className="space-y-1.5 rounded-md border border-dashed bg-muted/30 p-3" data-testid="cac-preview">
      <p className="text-xs font-medium">{t.cardAutoPreviewTitle}</p>
      {!hasAny ? (
        <p className="text-xs text-muted-foreground">{t.cardAutoPreviewEmpty}</p>
      ) : (
        <div className="space-y-1 text-sm">
          {f.cardNumber && <p dir="ltr" className="font-mono tracking-wide" data-testid="cac-preview-card">{formatCardNumber(f.cardNumber)}</p>}
          {f.holderName.trim() && <p>{fmt(t.cardAutoPreviewHolder, { name: f.holderName.trim() })}</p>}
          {f.bankName.trim() && <p>{fmt(t.cardAutoPreviewBank, { bank: f.bankName.trim() })}</p>}
          {f.description.trim() && <p className="whitespace-pre-line text-muted-foreground" data-testid="cac-preview-desc">{f.description.trim()}</p>}
          {f.paymentUrl.trim() && <p className="text-muted-foreground" data-testid="cac-preview-link">{t.cardAutoPreviewLink}</p>}
        </div>
      )}
    </div>
  );
}

// ─── فرمِ ساخت/ویرایش ───────────────────────────────────────────────────────

const EMPTY_FORM: CardChannelForm = {
  kind: "open_link", cardNumber: "", holderName: "", bankName: "", description: "", paymentUrl: "", minAmountToman: 100_000,
  senderAllowlist: [], bankParser: "blubank",
};

type SubmitExtra = { removeCard: boolean };

/**
 * لینکِ پرداخت و شماره‌کارت هر دو اختیاری‌اند، حداقل یکی لازم است. `existingCard` = کانال (در ویرایش) از قبل کارت دارد
 * (کارتِ کامل از سرور نمی‌آید؛ خالی‌گذاشتنِ فیلد یعنی «همان کارت»، و «حذف شماره کارت» آن را برمی‌دارد).
 */
function ChannelForm({
  initial, editing, existingCard = false, pending, error, onSubmit, onCancel,
}: {
  initial: CardChannelForm; editing: boolean; existingCard?: boolean; pending: boolean; error: unknown;
  onSubmit: (f: CardChannelForm, extra: SubmitExtra) => void; onCancel: () => void;
}) {
  const t = useT("botSettings");
  const [f, setF] = useState<CardChannelForm>(initial);
  const [senders, setSenders] = useState(initial.senderAllowlist.join(", "));
  const [removeCard, setRemoveCard] = useState(false);
  const set = <K extends keyof CardChannelForm>(k: K, v: CardChannelForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const hasUrl = f.paymentUrl.trim() !== "";
  const hasCard = willHaveCard({ newCardDigits: f.cardNumber, existingCard, removeCard });
  const linkType: LinkType = f.kind === "fixed_link" ? "fixed_link" : "open_link";
  const kind = deriveFormKind(hasCard, hasUrl, linkType);
  const problems = formProblems({ hasCard, hasUrl, holderName: f.holderName });
  const linkLocked = hasCard && hasUrl;   // با کارت، لینک همیشه «مبلغ باز» است

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!kind || problems.length) return;
        onSubmit(
          { ...f, kind, paymentUrl: f.paymentUrl.trim(), senderAllowlist: senders.split(/[,\n;،]+/).map((s) => s.trim()).filter(Boolean) },
          { removeCard },
        );
      }}
    >
      <p className="text-xs text-muted-foreground" data-testid="cac-need-one-hint">{t.cardAutoNeedOne}</p>

      <div className="space-y-1.5">
        <Label htmlFor="cac-url">{t.cardAutoUrl}</Label>
        <Input id="cac-url" dir="ltr" placeholder="https://" value={f.paymentUrl} onChange={(e) => set("paymentUrl", e.target.value.trim())} />
      </div>
      {hasUrl && (
        <div className="space-y-1.5">
          <Label>{t.cardAutoLinkType}</Label>
          <Select value={linkLocked ? "open_link" : linkType} disabled={linkLocked} onValueChange={(v) => set("kind", v as LinkType)}>
            <SelectTrigger data-testid="cac-link-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open_link">{t.cardAutoKindOpen}</SelectItem>
              <SelectItem value="fixed_link">{t.cardAutoKindFixed}</SelectItem>
            </SelectContent>
          </Select>
          {linkLocked && <p className="text-xs text-muted-foreground">{t.cardAutoLinkFixedWithCard}</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="cac-card">{t.cardAutoCardNumber}</Label>
        <Input
          id="cac-card" dir="ltr" inputMode="numeric" autoComplete="off"
          placeholder={existingCard && !removeCard ? t.cardAutoCardKeep : "6037 9970 0000 0001"}
          value={formatCardNumber(f.cardNumber)}
          onChange={(e) => set("cardNumber", e.target.value.replace(/\D/g, "").slice(0, 16))}
        />
        {editing && existingCard && (
          removeCard ? (
            <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="cac-remove-card-note">
              {t.cardAutoRemoveCardNote}{" "}
              <button type="button" className="underline" onClick={() => setRemoveCard(false)}>{t.cardAutoRemoveCardUndo}</button>
            </p>
          ) : (
            <button type="button" className="text-xs text-destructive underline" data-testid="cac-remove-card" onClick={() => { set("cardNumber", ""); setRemoveCard(true); }}>
              {t.cardAutoRemoveCard}
            </button>
          )
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cac-holder">{t.cardAutoHolder}</Label>
          <Input id="cac-holder" value={f.holderName} onChange={(e) => set("holderName", e.target.value)} />
          {hasCard && (
            <p className={`text-xs ${problems.includes("holder_required") ? "text-destructive" : "text-muted-foreground"}`}>{t.cardAutoHolderHint}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cac-bank">{t.cardAutoBank}</Label>
          <Input id="cac-bank" value={f.bankName} onChange={(e) => set("bankName", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cac-min">{t.cardAutoMin}</Label>
          <Input
            id="cac-min" dir="ltr" inputMode="numeric" value={String(f.minAmountToman)}
            onChange={(e) => set("minAmountToman", Number(e.target.value.replace(/\D/g, "")) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t.cardAutoParser}</Label>
          <Select value={f.bankParser} onValueChange={(v) => set("bankParser", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="blubank">Blubank</SelectItem>
              <SelectItem value="generic">{t.cardAutoParserGeneric}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cac-desc">{t.cardAutoDescription}</Label>
        <Textarea
          id="cac-desc" rows={3} maxLength={MAX_CHANNEL_DESCRIPTION} value={f.description}
          placeholder={t.cardAutoDescriptionPlaceholder}
          onChange={(e) => set("description", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {fmt(t.cardAutoDescriptionHint, { max: MAX_CHANNEL_DESCRIPTION })}{" "}
          <span dir="ltr" data-testid="cac-desc-count">{f.description.length}/{MAX_CHANNEL_DESCRIPTION}</span>
        </p>
      </div>
      <CustomerPreview f={f} />
      <div className="space-y-1.5">
        <Label htmlFor="cac-senders">{t.cardAutoSenders}</Label>
        <Input id="cac-senders" dir="ltr" value={senders} onChange={(e) => setSenders(e.target.value)} />
        <p className="text-xs text-muted-foreground">{t.cardAutoSendersHint}</p>
      </div>
      {problems.includes("need_one") && <p className="text-xs text-destructive" role="alert" data-testid="cac-need-one-error">{t.cardAutoNeedOne}</p>}
      {error ? <p className="text-xs text-destructive" role="alert">{apiErrorMessage(error, "Error")}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || problems.length > 0} data-testid="cac-submit">
          {pending && <Loader2 className="me-1.5 size-3.5 animate-spin" />}
          {editing ? t.cardAutoSave : t.cardAutoCreate}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t.cardAutoCancel}</Button>
      </div>
    </form>
  );
}

// ─── سلامت ──────────────────────────────────────────────────────────────────

function HealthBadge({ channel }: { channel: CardChannel }) {
  const t = useT("botSettings");
  const h = channel.health;
  if (h.status === "never") {
    return <Badge variant="outline" className="gap-1"><Smartphone className="size-3" /> {t.cardAutoHealthNever}</Badge>;
  }
  if (h.status === "stale") {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300" data-testid="health-stale">
        <AlertTriangle className="size-3" /> {fmt(t.cardAutoHealthStale, { h: Math.floor(h.hoursSince) })}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300" data-testid="health-ok">
      <CheckCircle2 className="size-3" /> {t.cardAutoHealthOk}
    </Badge>
  );
}

// ─── کارتِ یک کانال ─────────────────────────────────────────────────────────

function SmsLog({ botId, channelId }: { botId: string; channelId: string }) {
  const t = useT("botSettings");
  const { lang } = useLanguage();
  const log = useCardSmsLog(botId, channelId, true);
  const entries = log.data?.entries ?? [];
  const statusLabel: Record<string, string> = {
    unmatched: t.cardAutoSt_unmatched, unparsed: t.cardAutoSt_unparsed, matched: t.cardAutoSt_matched, ambiguous: t.cardAutoSt_ambiguous, ignored: t.cardAutoSt_ignored,
  };
  return (
    <div className="space-y-1.5" data-testid="sms-log">
      <p className="text-xs font-medium">{t.cardAutoLog}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.cardAutoLogEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-1.5 text-start font-medium">{t.cardAutoColTime}</th>
                <th className="p-1.5 text-start font-medium">{t.cardAutoColSender}</th>
                <th className="p-1.5 text-start font-medium">{t.cardAutoColAmount}</th>
                <th className="p-1.5 text-start font-medium">{t.cardAutoColStatus}</th>
                <th className="p-1.5 text-start font-medium">{t.cardAutoColText}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="whitespace-nowrap p-1.5">{fmtTime(e.receivedAt, lang)}</td>
                  <td className="p-1.5" dir="ltr">{e.sender ?? "—"}</td>
                  <td className="p-1.5" dir="ltr">{e.amountToman !== null ? e.amountToman.toLocaleString("en-US") : "—"}</td>
                  <td className="p-1.5">
                    {statusLabel[e.status === "unmatched" && !e.parsedOk ? "unparsed" : e.status] ?? e.status}
                    {e.isTest && <Badge variant="outline" className="ms-1 px-1 py-0 text-[10px]">{t.cardAutoTestBadge}</Badge>}
                  </td>
                  <td className="max-w-[220px] truncate p-1.5" dir="auto" title={e.preview}>{e.preview || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  botId, channel, publicUrlConfigured, onSecret,
}: { botId: string; channel: CardChannel; publicUrlConfigured: boolean; onSecret: (secret: string, channel: CardChannel) => void }) {
  const t = useT("botSettings");
  const { lang } = useLanguage();
  const copy = useCopy();
  const { toast } = useToast();
  const update = useUpdateCardChannel(botId);
  const rotate = useRotateCardSecret(botId);
  const del = useDeleteCardChannel(botId);
  const test = useTestCardSms(botId);
  const [editing, setEditing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [testResult, setTestResult] = useState<TestSmsResult | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = channel.activeRequests > 0;
  const kindLabel = channel.kind === "card_manual" ? t.cardAutoKindCard
    : channel.kind === "fixed_link" ? t.cardAutoKindFixed
    : channel.cardMasked ? t.cardAutoKindBoth : t.cardAutoKindOpen;
  const err = (e: unknown) => toast({ title: apiErrorMessage(e, "Error"), variant: "destructive" });

  return (
    <Card data-testid={`channel-${channel.id}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <span>{channel.holderName || kindLabel}</span>
            <Badge variant="outline" className="text-[10px]">{kindLabel}</Badge>
            {channel.cardMasked && <code dir="ltr" className="text-xs text-muted-foreground">{channel.cardMasked}</code>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor={`act-${channel.id}`} className="text-xs">{t.cardAutoActive}</Label>
            <Switch
              id={`act-${channel.id}`} checked={channel.active} disabled={update.isPending || (locked && channel.active)}
              onCheckedChange={(v) => update.mutate({ channelId: channel.id, patch: { active: v } }, { onError: err })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <HealthBadge channel={channel} />
          <span className="text-xs text-muted-foreground">
            {t.cardAutoLastSms}: {fmtTime(channel.lastSmsAt, lang)}
          </span>
          {locked && <Badge variant="outline" className="text-[10px]">{fmt(t.cardAutoActiveReqs, { n: channel.activeRequests })}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">{t.cardAutoWebhook}</Label>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 text-xs" data-testid="webhook-url">{channel.webhookUrl}</code>
            <Button type="button" size="sm" variant="outline" onClick={() => copy(channel.webhookUrl)} aria-label={t.cardAutoCopy}>
              <Copy className="size-3.5" />
            </Button>
          </div>
          {!publicUrlConfigured && <p className="text-xs text-destructive">{t.cardAutoWebhookMissing}</p>}
        </div>

        {editing ? (
          <ChannelForm
            editing
            existingCard={Boolean(channel.cardMasked)}
            initial={{
              kind: channel.kind, cardNumber: "", holderName: channel.holderName ?? "", bankName: channel.bankName ?? "",
              description: channel.description ?? "", paymentUrl: channel.paymentUrl ?? "", minAmountToman: channel.minAmountToman,
              senderAllowlist: channel.senderAllowlist, bankParser: channel.bankParser,
            }}
            pending={update.isPending}
            error={update.error}
            onCancel={() => setEditing(false)}
            onSubmit={(f, { removeCard }) => {
              const patch: CardChannelPatch = {
                kind: f.kind, holderName: f.holderName, bankName: f.bankName, description: f.description,
                minAmountToman: f.minAmountToman, senderAllowlist: f.senderAllowlist, bankParser: f.bankParser,
                paymentUrl: f.paymentUrl,            // "" = بدونِ لینک
              };
              if (f.cardNumber) patch.cardNumber = f.cardNumber;
              else if (removeCard) patch.cardNumber = null;
              update.mutate({ channelId: channel.id, patch }, { onSuccess: () => setEditing(false) });
            }}
          />
        ) : (
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {channel.description && (
              <><dt className="text-muted-foreground">{t.cardAutoDescriptionLabel}</dt><dd className="whitespace-pre-line" data-testid="channel-description">{channel.description}</dd></>
            )}
            {channel.paymentUrl && (<><dt className="text-muted-foreground">{t.cardAutoUrl}</dt><dd dir="ltr" className="break-all">{channel.paymentUrl}</dd></>)}
            <dt className="text-muted-foreground">{t.cardAutoMin}</dt>
            <dd dir="ltr">{channel.minAmountToman.toLocaleString("en-US")}</dd>
            <dt className="text-muted-foreground">{t.cardAutoSenders}</dt>
            <dd dir="ltr">{channel.senderAllowlist.length ? channel.senderAllowlist.join(", ") : "—"}</dd>
          </dl>
        )}
        {locked && editing && <p className="text-xs text-muted-foreground">{t.cardAutoLockedHint}</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button" size="sm" variant="outline" disabled={test.isPending}
            onClick={() => test.mutate(channel.id, { onSuccess: (d) => setTestResult(d.result), onError: err })}
          >
            {test.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Send className="me-1.5 size-3.5" />}
            {t.cardAutoTest}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowLog((v) => !v)}>
            {t.cardAutoLog}
          </Button>
          {!editing && (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="me-1.5 size-3.5" /> {t.cardAutoEdit}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRotate(true)}>
            <RefreshCcw className="me-1.5 size-3.5" /> {t.cardAutoRotate}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="me-1.5 size-3.5" /> {t.cardAutoDelete}
          </Button>
        </div>

        {testResult && (
          <div
            className={`flex items-start gap-1.5 rounded-md border p-2 text-xs ${testResult.matchesExpected ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}
            data-testid="test-result"
          >
            {testResult.matchesExpected ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
            <div className="space-y-1">
              <p>
                {testResult.matchesExpected
                  ? fmt(t.cardAutoTestOk, { amount: (testResult.amountRial ?? 0).toLocaleString("en-US") })
                  : t.cardAutoTestFail}
              </p>
              <p className="text-muted-foreground">{t.cardAutoTestNote}</p>
            </div>
          </div>
        )}
        {showLog && <SmsLog botId={botId} channelId={channel.id} />}
      </CardContent>

      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.cardAutoRotate}</DialogTitle>
            <DialogDescription>{t.cardAutoRotateConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRotate(false)}>{t.cardAutoCancel}</Button>
            <Button
              disabled={rotate.isPending}
              onClick={() =>
                rotate.mutate(channel.id, {
                  onSuccess: (d) => { setConfirmRotate(false); onSecret(d.smsSecret, d.channel); },
                  onError: err,
                })
              }
            >
              {rotate.isPending && <Loader2 className="me-1.5 size-3.5 animate-spin" />} {t.cardAutoRotate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.cardAutoDelete}</DialogTitle>
            <DialogDescription>{t.cardAutoDeleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t.cardAutoCancel}</Button>
            <Button
              variant="destructive" disabled={del.isPending}
              onClick={() => del.mutate(channel.id, { onSuccess: () => setConfirmDelete(false), onError: (e) => { setConfirmDelete(false); err(e); } })}
            >
              {t.cardAutoDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── بخشِ اصلی ──────────────────────────────────────────────────────────────

export { GuideCallout };

/** پیش‌پرکردنِ فرمِ «افزودن شماره کارت» از بیرون (مثلاً از کارتِ دستیِ همین تب). `nonce` هر بار عوض شود فرم دوباره باز می‌شود. */
export type CardSeed = { cardNumber: string; holderName: string; nonce: number };

export const CARD_AUTO_SECTION_ID = "card-auto-section";

export function CardAutoConfirmSection(
  { botId, title, description, showGuide = true, seed }: {
    botId: string; title?: string; description?: string; showGuide?: boolean; seed?: CardSeed | null;
  },
) {
  const t = useT("botSettings");
  const channels = useCardChannels(botId);
  const create = useCreateCardChannel(botId);
  const [adding, setAdding] = useState(false);
  const [initial, setInitial] = useState<CardChannelForm>(EMPTY_FORM);
  const [formKey, setFormKey] = useState(0);
  const [secret, setSecret] = useState<{ value: string; channel: CardChannel } | null>(null);

  const openAdd = (form: CardChannelForm) => {
    create.reset();
    setInitial(form);
    setFormKey((k) => k + 1);   // فرم با مقدارِ اولیه‌ی تازه دوباره ساخته شود
    setAdding(true);
  };

  useEffect(() => {
    if (!seed?.nonce) return;
    openAdd({ ...EMPTY_FORM, cardNumber: seed.cardNumber.replace(/\D/g, "").slice(0, 16), holderName: seed.holderName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  const data = channels.data;
  const atLimit = data ? data.channels.length >= data.limits.maxChannels : false;

  return (
    <Card id={CARD_AUTO_SECTION_ID} data-testid="card-auto-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Smartphone className="size-4" /> {title ?? t.cardAutoTitle}</CardTitle>
        <CardDescription>{description ?? t.cardAutoDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showGuide && <GuideCallout />}

        {channels.isError && <p className="text-xs text-destructive">{t.cardAutoLoadError}</p>}
        {channels.isLoading && <Loader2 className="size-4 animate-spin" />}
        {data && data.channels.length === 0 && !adding && <p className="text-sm text-muted-foreground">{t.cardAutoNone}</p>}

        {data?.channels.map((c) => (
          <ChannelCard
            key={c.id} botId={botId} channel={c} publicUrlConfigured={data.publicUrlConfigured}
            onSecret={(value, channel) => setSecret({ value, channel })}
          />
        ))}

        {adding ? (
          <ChannelForm
            key={formKey}
            editing={false} initial={initial} pending={create.isPending} error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(f) =>
              create.mutate(f, {
                onSuccess: (d) => { setAdding(false); setSecret({ value: d.smsSecret, channel: d.channel }); },
              })
            }
          />
        ) : (
          data && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" disabled={atLimit} data-testid="add-channel" onClick={() => openAdd(EMPTY_FORM)}>
                <Plus className="me-1.5 size-3.5" /> {t.cardAutoAdd}
              </Button>
              <span className="text-xs text-muted-foreground">{fmt(t.cardAutoLimit, { n: data.limits.maxChannels })}</span>
            </div>
          )
        )}
      </CardContent>
      {secret && <SecretDialog secret={secret.value} channel={secret.channel} onClose={() => setSecret(null)} />}
    </Card>
  );
}
