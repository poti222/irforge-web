import { useEffect, useRef, useState } from "react";
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
import { Loader2, ArrowLeft, ArrowRight, Phone, Mail, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { isRtlLang } from "@/lib/i18n";
import { BrandLogo } from "@/components/layout/brand-home";
import { CodeInput } from "@/components/auth/CodeInput";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";

/**
 * ثبت‌نام پنج‌مرحله‌ای.
 *
 * صریحاً یک ماشین حالت با یک enum است، نه چند boolean تودرتو — با پنج گام و
 * مسیرهای بازگشت، بولین‌های تودرتو خیلی زود به حالت‌های غیرممکن می‌رسند.
 *
 * `registrationId` در state و `sessionStorage` نگه داشته می‌شود تا یک رفرش
 * کار را از بین نبرد. **هرگز در URL نمی‌رود** — از آنجا به referrer، تاریخچه‌ی
 * مرورگر و ابزارهای تحلیلی نشت می‌کرد.
 *
 * سرور تنها چیزی است که `step` را جلو می‌برد؛ این صفحه فقط گزارشش را می‌خواند.
 */

type Step = "method" | "identity" | "telegram" | "code" | "finish";

const STORAGE_KEY = "irforge_registration_id";

interface RegStatus {
  registrationId: string;
  step: string;
  phone: string | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  email: string | null;
  codeExpiresAt: string | null;
  canResend: boolean;
}

function serverMessage(err: any): string | undefined {
  const reason = err?.data?.error;
  return typeof reason === "string" && reason.trim() !== "" ? reason : err?.message;
}

export default function Register() {
  const t = useT("auth") as Record<string, string>;
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  useSEO({ title: t.createAccount ?? "Sign up | IrForge", noindex: true });

  const [step, setStep] = useState<Step>("method");
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [status, setStatus] = useState<RegStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);

  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendIn, setResendIn] = useState(0);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const pollRef = useRef<number | null>(null);

  // بازیابی بعد از رفرش.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setRegistrationId(saved);
      void refreshStatus(saved);
    }
    // فقط یک‌بار در mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStatus(id: string) {
    try {
      const s = await customFetch<RegStatus>(`/api/auth/register/${id}/status`);
      setStatus(s);
      setEmail((prev) => prev || (s.email ?? ""));
      // سرور مرجع گام است.
      if (s.step === "identity") setStep("telegram");
      else if (s.step === "telegram_pending") setStep("telegram");
      else if (s.step === "code_sent") setStep("code");
      else if (s.step === "code_verified") setStep("finish");
      return s;
    } catch {
      // رکورد منقضی یا حذف شده — از اول.
      sessionStorage.removeItem(STORAGE_KEY);
      setRegistrationId(null);
      setStep("method");
      return null;
    }
  }

  // در گام تلگرام، وضعیت را poll می‌کنیم تا لحظه‌ای که کد ارسال شد رد شویم.
  useEffect(() => {
    if (step !== "telegram" || !registrationId) return;
    pollRef.current = window.setInterval(() => void refreshStatus(registrationId), 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, registrationId]);

  // شمارش معکوس اعتبار کد.
  useEffect(() => {
    if (!status?.codeExpiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(status.codeExpiresAt!).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status?.codeExpiresAt]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  function fail(err: any, fallback?: string) {
    const retry = err?.data?.retryAfterSeconds;
    const description =
      typeof retry === "number"
        ? (t.rateLimited ?? "Try again in {n}s").replace("{n}", String(retry))
        : serverMessage(err) ?? fallback;
    toast({ variant: "destructive", title: t.genericAuthError, description });
  }

  async function startRegistration() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setBusy(true);
    try {
      const res = await customFetch<{ registrationId: string; deepLink: string }>(
        "/api/auth/register/start",
        {
          method: "POST",
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            locale: lang,
          }),
        },
      );
      setRegistrationId(res.registrationId);
      setDeepLink(res.deepLink);
      sessionStorage.setItem(STORAGE_KEY, res.registrationId);
      setStep("telegram");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(entered: string) {
    if (!registrationId || entered.length !== 6) return;
    setBusy(true);
    setCodeInvalid(false);
    try {
      const res = await customFetch<RegStatus & { ok: boolean }>(
        "/api/auth/register/verify-code",
        { method: "POST", body: JSON.stringify({ registrationId, code: entered }) },
      );
      setStatus((prev) => ({ ...(prev as RegStatus), ...res }));
      setEmail(res.email ?? email);
      setStep("finish");
    } catch (err: any) {
      setCodeInvalid(true);
      setCode("");
      if (err?.data?.code === "too_many_attempts") {
        sessionStorage.removeItem(STORAGE_KEY);
        setRegistrationId(null);
        setStep("method");
        toast({ variant: "destructive", title: t.tooManyAttempts });
        return;
      }
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!registrationId) return;
    setBusy(true);
    try {
      await customFetch("/api/auth/register/resend", {
        method: "POST",
        body: JSON.stringify({ registrationId }),
      });
      setResendIn(60);
      await refreshStatus(registrationId);
    } catch (err: any) {
      if (typeof err?.data?.retryAfterSeconds === "number") setResendIn(err.data.retryAfterSeconds);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveEmail() {
    if (!registrationId) return;
    try {
      await customFetch(`/api/auth/register/${registrationId}`, {
        method: "PATCH",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEditingEmail(false);
    } catch (err) {
      fail(err);
    }
  }

  async function complete() {
    if (!registrationId) return;
    if (password !== passwordConfirm) {
      toast({ variant: "destructive", title: t.passwordMismatch });
      return;
    }
    if (password.length < 8) {
      toast({ variant: "destructive", title: t.passwordMin });
      return;
    }
    setBusy(true);
    try {
      const res = await customFetch<{ user: any; token: string }>(
        "/api/auth/register/complete",
        {
          method: "POST",
          body: JSON.stringify({ registrationId, password, passwordConfirm }),
        },
      );
      localStorage.setItem("token", res.token);
      queryClient.setQueryData(getGetMeQueryKey(), res.user);
      sessionStorage.removeItem(STORAGE_KEY);
      navigate("/dashboard");
    } catch (err: any) {
      // رکورد عمداً زنده می‌ماند تا کاربر بتواند ایمیل را اصلاح کند.
      if (err?.data?.code === "email_taken") setEditingEmail(true);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const telegramName = [status?.telegramFirstName, status?.telegramLastName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <BrandLogo href="/" />
        </div>

        {/* ── گام ۱: انتخاب روش ─────────────────────────────────────────── */}
        {step === "method" && (
          <div className="space-y-4">
            <h1 className="text-center text-2xl font-bold tracking-tight">{t.methodTitle}</h1>

            <button
              type="button"
              onClick={() => setStep("identity")}
              className="w-full rounded-xl border p-5 text-start transition-colors hover:border-primary/60"
            >
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold">{t.methodPhone}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t.methodPhoneDesc}</p>
                </div>
              </div>
            </button>

            {/* عمداً پنهان نشده: گزینه‌ی پنهان یعنی «وجود ندارد»، گزینه‌ی
                غیرفعال یعنی «در مسیر است». */}
            <div
              className="w-full cursor-not-allowed rounded-xl border p-5 opacity-60"
              aria-disabled="true"
            >
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{t.methodEmail}</p>
                    <Badge variant="secondary">{t.comingSoon}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t.methodEmailDesc}</p>
                </div>
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              {t.alreadyHaveAccount ?? ""}{" "}
              <Link href="/login" className="text-primary hover:underline">{t.signInLink}</Link>
            </p>
          </div>
        )}

        {/* ── گام ۲: هویت ───────────────────────────────────────────────── */}
        {step === "identity" && (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); void startRegistration(); }}
          >
            <h1 className="text-2xl font-bold tracking-tight">{t.identityTitle}</h1>
            <p className="text-sm text-muted-foreground">{t.identityDesc}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reg-first">{t.firstName}</Label>
                <Input id="reg-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-last">{t.lastName}</Label>
                <Input id="reg-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-email">{t.email}</Label>
              <Input id="reg-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <GlowButton type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.continue}
            </GlowButton>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("method")}>
              <BackArrow className="me-2 size-4" /> {t.back}
            </Button>
          </form>
        )}

        {/* ── گام ۳: اتصال تلگرام ───────────────────────────────────────── */}
        {step === "telegram" && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold tracking-tight">{t.telegramTitle}</h1>
            <p className="text-sm text-muted-foreground">{t.telegramDesc}</p>
            <TelegramLinkPanel mode="register" deepLink={deepLink} waiting />
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => registrationId && void refreshStatus(registrationId)}
            >
              {t.continue}
            </Button>
          </div>
        )}

        {/* ── گام ۴: کد ─────────────────────────────────────────────────── */}
        {step === "code" && (
          <div className="space-y-5">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">{t.codeTitle}</h1>
              <p className="text-sm text-muted-foreground">{t.codeDesc}</p>
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

            <GlowButton className="w-full" disabled={busy || code.length !== 6} onClick={() => void verify(code)}>
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.verify}
            </GlowButton>

            <Button
              variant="ghost"
              className="w-full"
              disabled={busy || resendIn > 0 || status?.canResend === false}
              onClick={() => void resend()}
            >
              {status?.canResend === false
                ? t.resendLimit
                : resendIn > 0
                  ? (t.resendIn ?? "").replace("{n}", String(resendIn))
                  : t.resend}
            </Button>
          </div>
        )}

        {/* ── گام ۵: رمز عبور ───────────────────────────────────────────── */}
        {step === "finish" && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void complete(); }}>
            <h1 className="text-2xl font-bold tracking-tight">{t.finishTitle}</h1>
            <p className="text-sm text-muted-foreground">{t.finishDesc}</p>

            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t.connectedAs}</span>
                  <span className="truncate font-medium" dir="ltr">
                    {status?.telegramUsername ? `@${status.telegramUsername}` : telegramName || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t.phoneLabel}</span>
                  <span className="font-medium tabular-nums" dir="ltr">{status?.phone ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t.email}</span>
                  {editingEmail ? (
                    <span className="flex items-center gap-2">
                      <Input
                        value={email}
                        dir="ltr"
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-8 w-48"
                        aria-label={t.email}
                      />
                      <Button type="button" size="sm" variant="outline" onClick={() => void saveEmail()}>
                        {t.saveEmail}
                      </Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium" dir="ltr">{email || "—"}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={t.editEmail}
                        onClick={() => setEditingEmail(true)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <Label htmlFor="reg-pass">{t.password}</Label>
              <PasswordInput id="reg-pass" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <p className="text-xs text-muted-foreground">{t.passwordMin}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-pass2">{t.passwordConfirm}</Label>
              <PasswordInput id="reg-pass2" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required />
              {passwordConfirm !== "" && password !== passwordConfirm && (
                <p className="text-xs text-destructive">{t.passwordMismatch}</p>
              )}
            </div>

            <GlowButton type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.createAccount}
            </GlowButton>
          </form>
        )}
      </div>
    </div>
  );
}
