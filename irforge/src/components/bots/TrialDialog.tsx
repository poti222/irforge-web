import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2, CheckCircle2, ExternalLink, Gift } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { customFetch, getListBotsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/TurnstileWidget";
import { useCaptchaConfig } from "@/config/captcha";

interface TrialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TrialDialog({ open, onOpenChange }: TrialDialogProps) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"telegram_check" | "form" | "success">("form");
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  // IRFORGE_PROMPT_V3 Phase 42 — a free, one-per-account trial bot is
  // exactly the kind of action worth gating against scripted abuse.
  const captchaConfig = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const tCaptcha = useT("captcha");

  const telegramLinked = Boolean(user?.telegramId);

  useEffect(() => {
    if (open) setStep(telegramLinked ? "form" : "telegram_check");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function resetAndClose(val: boolean) {
    if (!val) {
      setName("");
      setToken("");
      setCaptchaToken(null);
      setStep("form");
    }
    onOpenChange(val);
  }

  async function handleSubmit() {
    if (!name.trim() || !token.trim()) {
      toast({
        variant: "destructive",
        title: fa ? "نام و توکن بات الزامی است" : "Bot name and token are required",
      });
      return;
    }
    if (captchaConfig.enabled && !captchaToken) {
      toast({ variant: "destructive", title: tCaptcha.required });
      return;
    }
    setSubmitting(true);
    try {
      await customFetch("/api/bots/trial", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), token: token.trim(), captchaToken }),
      });
      queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
      setStep("success");
    } catch (err: any) {
      // A Turnstile token is single-use — whatever failed, get a fresh one
      // before the visitor can retry.
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      // A 401 here always means "not actually signed in" (missing/expired
      // session token, or a guest token) — the raw "Unauthorized" from the
      // API is true but unhelpful, so surface what the user should actually
      // do about it and send them to log in instead.
      if (err?.status === 401) {
        toast({
          variant: "destructive",
          title: fa ? "برای ساخت بات باید وارد حساب شوی" : "You have to log in to create a bot",
          description: fa
            ? "به نظر می‌رسد نشست شما منقضی شده یا وارد حساب نیستید. لطفاً دوباره وارد شو."
            : "It looks like you're not signed in (or your session expired). Please log in and try again.",
        });
        onOpenChange(false);
        setLocation("/login");
        return;
      }
      toast({
        variant: "destructive",
        title: fa ? "خطا در فعال‌سازی تریال" : "Could not start trial",
        description: err?.data?.error || err?.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-md">
        {step === "telegram_check" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-500" />
                {fa ? "اول تلگرامت رو وصل کن" : "Connect Telegram first"}
              </DialogTitle>
              <DialogDescription>
                {fa
                  ? "برای فعال‌سازی تریال رایگان باید حساب تلگرامت به پروفایل وصل باشد."
                  : "To activate the free trial, your Telegram account needs to be linked to your profile."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
                {fa ? "بعداً" : "Later"}
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  onOpenChange(false);
                  setLocation("/profile");
                }}
              >
                <ExternalLink className="size-4 me-2" />
                {fa ? "رفتن به پروفایل" : "Go to profile"}
              </Button>
            </div>
          </>
        )}

        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gift className="size-5 text-primary" />
                {fa ? "شروع تریال رایگان ۷ روزه" : "Start your 7-day free trial"}
              </DialogTitle>
              <DialogDescription>
                {fa
                  ? "معادل پکیج نقره‌ای، بدون نیاز به پرداخت. بعد از ۷ روز اگر پکیجی نخری، سرویس بات قطع می‌شود."
                  : "Equivalent to the Silver package, no payment needed. If you don't upgrade within 7 days, the bot's service will be suspended."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="trial-bot-name">{fa ? "نام بات *" : "Bot name *"}</Label>
                <Input
                  id="trial-bot-name"
                  placeholder={fa ? "مثلاً: فروشگاه من" : "e.g. My Shop"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trial-bot-token">{fa ? "توکن بات *" : "Bot token *"}</Label>
                <Input
                  id="trial-bot-token"
                  dir="ltr"
                  placeholder="123456:ABCdef..."
                  className="font-mono text-sm"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={submitting}
                />
                <p className="text-xs text-muted-foreground">
                  {fa ? "توکن رو از @BotFather دریافت کن" : "Get your token from @BotFather"}
                </p>
              </div>
              <Alert>
                <AlertDescription className="text-xs">
                  {fa
                    ? "هر حساب فقط یک‌بار می‌تواند از تریال رایگان استفاده کند."
                    : "Each account can only use the free trial once."}
                </AlertDescription>
              </Alert>
              {captchaConfig.enabled && (
                <div className="flex justify-center">
                  <TurnstileWidget
                    ref={turnstileRef}
                    siteKey={captchaConfig.siteKey}
                    onVerify={setCaptchaToken}
                    onExpire={() => setCaptchaToken(null)}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={submitting}>
                {fa ? "انصراف" : "Cancel"}
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={handleSubmit}
                disabled={submitting || (captchaConfig.enabled && !captchaToken)}
              >
                {submitting ? (
                  <><Loader2 className="size-4 me-2 animate-spin" /> {fa ? "در حال فعال‌سازی..." : "Starting..."}</>
                ) : (
                  fa ? "شروع تریال رایگان" : "Start free trial"
                )}
              </Button>
            </div>
          </>
        )}

        {step === "success" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-green-500" />
                {fa ? "تریال فعال شد!" : "Trial activated!"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-4 text-sm text-muted-foreground">
              <p>
                {fa
                  ? "بات تو همین الان فعال شد و ۷ روز وقت داری امکاناتش رو امتحان کنی."
                  : "Your bot is active now — you have 7 days to try everything out."}
              </p>
              <p>
                {fa
                  ? "۳ روز قبل از پایان تریال، از طریق زنگ اعلان‌ها بالای صفحه بهت هشدار می‌دیم."
                  : "3 days before it ends, we'll warn you via the notification bell at the top of the page."}
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  resetAndClose(false);
                  setLocation("/bots");
                }}
              >
                {fa ? "رفتن به بات‌های من" : "Go to My Bots"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
