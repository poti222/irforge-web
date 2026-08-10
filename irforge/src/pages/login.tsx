import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ArrowRight, Phone, Mail, LifeBuoy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { isRtlLang } from "@/lib/i18n";
import { BrandLogo } from "@/components/layout/brand-home";
import { CodeInput } from "@/components/auth/CodeInput";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";

/**
 * ورود دومرحله‌ای: شماره + رمز → کد در تلگرام → نشست.
 *
 * کد در **هر** ورود لازم است. «این دستگاه را به خاطر بسپار» عمداً وجود ندارد:
 * عامل دومی که می‌شود خاموشش کرد، برای مهاجمی که رمز را دارد یعنی فقط یک
 * چک‌باکس فاصله تا حساب.
 */

type Step = "credentials" | "code" | "needs_telegram";

export default function Login() {
  const t = useT("auth") as Record<string, string>;
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  useSEO({ title: t.signIn ?? "Sign in | IrForge", noindex: true });

  const [step, setStep] = useState<Step>("credentials");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState<string>("Telegram");
  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [linkDeepLink, setLinkDeepLink] = useState<string | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setInterval(() => setSecondsLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [secondsLeft]);

  function fail(err: any) {
    const retry = err?.data?.retryAfterSeconds;
    toast({
      variant: "destructive",
      title: t.genericAuthError,
      description:
        typeof retry === "number"
          ? (t.rateLimited ?? "").replace("{n}", String(retry))
          : undefined,
    });
  }

  async function submitCredentials() {
    setBusy(true);
    try {
      const res = await customFetch<{
        challengeId: string;
        expiresInSeconds: number;
        destinationHint: string;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), password }),
      });
      setChallengeId(res.challengeId);
      setDestination(res.destinationHint);
      setSecondsLeft(res.expiresInSeconds);
      setCode("");
      setStep("code");
    } catch (err: any) {
      // کاربر قدیمی بدون تلگرام: نه رد، نه عبور بدون عامل دوم — هدایت به اتصال.
      if (err?.data?.code === "telegram_required") {
        setLinkDeepLink(err.data.deepLink ?? null);
        setStep("needs_telegram");
        return;
      }
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(entered: string) {
    if (!challengeId || entered.length !== 6) return;
    setBusy(true);
    setCodeInvalid(false);
    try {
      const res = await customFetch<{ user: any; token: string }>("/api/auth/login/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId, code: entered }),
      });
      localStorage.setItem("token", res.token);
      queryClient.setQueryData(getGetMeQueryKey(), res.user);
      navigate("/dashboard");
    } catch (err: any) {
      setCodeInvalid(true);
      setCode("");
      if (err?.data?.code === "too_many_attempts" || err?.data?.code === "challenge_expired") {
        setStep("credentials");
        setChallengeId(null);
        toast({ variant: "destructive", title: t.tooManyAttempts });
        return;
      }
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <BrandLogo href="/" />
        </div>

        {step === "credentials" && (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); void submitCredentials(); }}
          >
            <h1 className="text-2xl font-bold tracking-tight">{t.signInAccount}</h1>

            <div className="space-y-1.5">
              <Label htmlFor="login-phone">{t.loginPhone}</Label>
              <Input
                id="login-phone"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-pass">{t.loginPassword}</Label>
              <PasswordInput
                id="login-pass"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <GlowButton type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.loginContinue}
            </GlowButton>

            {/* ایمیل مثل ثبت‌نام، دیده می‌شود ولی غیرفعال است. */}
            <div className="flex items-center gap-2 rounded-lg border p-3 opacity-60" aria-disabled="true">
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm">{t.methodEmail}</span>
              <Badge variant="secondary" className="ms-auto">{t.comingSoon}</Badge>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              {t.noAccount}{" "}
              <Link href="/register" className="text-primary hover:underline">{t.registerNow}</Link>
            </p>

            {/* مسیر مشخص به‌جای بن‌بست، برای کسی که تلگرامش را از دست داده. */}
            <Link
              href="/support?topic=telegram-lost"
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LifeBuoy className="size-3.5" aria-hidden="true" />
              {t.lostTelegram}
            </Link>
          </form>
        )}

        {step === "code" && (
          <div className="space-y-5">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">{t.loginCodeTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {(t.loginCodeDesc ?? "").replace("{dest}", destination)}
              </p>
            </div>

            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(c) => void verify(c)}
              disabled={busy}
              invalid={codeInvalid}
            />

            <p className="text-center text-sm text-muted-foreground" aria-live="polite">
              {secondsLeft > 0
                ? (t.codeExpiresIn ?? "").replace(
                    "{t}",
                    `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
                  )
                : t.codeExpired}
            </p>

            <GlowButton
              className="w-full"
              disabled={busy || code.length !== 6}
              onClick={() => void verify(code)}
            >
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.loginVerify}
            </GlowButton>

            <Button variant="ghost" className="w-full" onClick={() => setStep("credentials")}>
              <BackArrow className="me-2 size-4" /> {t.back}
            </Button>
          </div>
        )}

        {step === "needs_telegram" && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold tracking-tight">{t.needsTelegram}</h1>
            <p className="text-sm text-muted-foreground">{t.needsTelegramDesc}</p>
            <TelegramLinkPanel mode="register" deepLink={linkDeepLink} waiting />
            <Button variant="ghost" className="w-full" onClick={() => setStep("credentials")}>
              <BackArrow className="me-2 size-4" /> {t.back}
            </Button>

            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">{t.lostTelegramDesc}</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
