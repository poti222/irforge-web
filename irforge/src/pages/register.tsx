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
import { Loader2, Phone, Mail, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { BrandLogo } from "@/components/layout/brand-home";
import { CodeInput } from "@/components/auth/CodeInput";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";
import { AuthStepHeader } from "@/components/auth/AuthStepHeader";

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

/** روش → هویت → تلگرام → کد → رمز عبور. */
const TOTAL_STEPS = 5;

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
  // آخرین گامی که **سرور** گزارش کرده. جلو بردن خودکار فقط وقتی مجاز است که
  // این مقدار تغییر کند — یعنی کاربر واقعاً کاری در بات انجام داده باشد.
  // بدون این، برگشتن از «کد» به «تلگرام» بی‌فایده بود: اولین poll وضعیت
  // `code_sent` را می‌دید و کاربر را فوراً به همان صفحه‌ای که از آن آمده بود
  // پرت می‌کرد.
  const lastServerStepRef = useRef<string | null>(null);

  // بازیابی بعد از رفرش.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setRegistrationId(saved);
      void refreshStatus(saved, { force: true });
    }
    // فقط یک‌بار در mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stepForServer(serverStep: string): Step | null {
    if (serverStep === "identity" || serverStep === "telegram_pending") return "telegram";
    if (serverStep === "code_sent") return "code";
    if (serverStep === "code_verified") return "finish";
    return null;
  }

  /**
   * `force` یعنی «کاربر همین الان صریحاً درخواست کرد» (دکمه‌ی ادامه، یا
   * بازیابی بعد از رفرش) — آنجا پریدن به گام سرور همان چیزی است که می‌خواهد.
   * بدون `force`، فقط یک **تغییر** در گام سرور کاربر را جلو می‌برد.
   */
  async function refreshStatus(id: string, opts: { force?: boolean } = {}) {
    try {
      const s = await customFetch<RegStatus>(`/api/auth/register/${id}/status`);
      setStatus(s);
      setEmail((prev) => prev || (s.email ?? ""));

      const changed = lastServerStepRef.current !== s.step;
      lastServerStepRef.current = s.step;

      if (opts.force || changed) {
        const target = stepForServer(s.step);
        if (target) setStep(target);
      }
      return s;
    } catch {
      // رکورد منقضی یا حذف شده — از اول.
      sessionStorage.removeItem(STORAGE_KEY);
      setRegistrationId(null);
      lastServerStepRef.current = null;
      setStep("method");
      return null;
    }
  }

  // در گام تلگرام، وضعیت را poll می‌کنیم تا لحظه‌ای که کد ارسال شد رد شویم.
  // با تغییر `step` این افکت تمیز می‌شود، پس بازگشت به گام قبل تایمر را
  // متوقف می‌کند و برگشتن دوباره یکی تازه می‌سازد.
  useEffect(() => {
    if (step !== "telegram" || !registrationId) return;
    pollRef.current = window.setInterval(() => void refreshStatus(registrationId), 3000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, registrationId]);

  /** بازگشت یک گام. هیچ‌وقت حالت سرور را دور نمی‌ریزد. */
  function goBack(to: Step) {
    // گام فعلی سرور را به‌عنوان «دیده‌شده» ثبت می‌کنیم تا poll بعدی کاربر را
    // بلافاصله به همان‌جایی که از آن برگشته پرت نکند.
    if (status?.step) lastServerStepRef.current = status.step;
    setStep(to);
  }

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
      const res = await customFetch<{ registrationId: string; deepLink: string; step?: string }>(
        "/api/auth/register/start",
        {
          method: "POST",
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            locale: lang,
            // اگر از گام تلگرام برگشته باشیم، همین رکورد به‌روزرسانی می‌شود و
            // ردیف در انتظار تازه‌ای ساخته نمی‌شود.
            registrationId,
          }),
        },
      );
      setRegistrationId(res.registrationId);
      setDeepLink(res.deepLink);
      sessionStorage.setItem(STORAGE_KEY, res.registrationId);
      lastServerStepRef.current = res.step ?? null;
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
            {/* گام اول: بازگشتی وجود ندارد، پس فقط نشانگر گام. */}
            <AuthStepHeader title={t.methodTitle} step={1} total={TOTAL_STEPS} />

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
            <AuthStepHeader
              title={t.identityTitle}
              description={t.identityDesc}
              step={2}
              total={TOTAL_STEPS}
              onBack={() => goBack("method")}
            />

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
          </form>
        )}

        {/* ── گام ۳: اتصال تلگرام ───────────────────────────────────────── */}
        {step === "telegram" && (
          <div className="space-y-4">
            <AuthStepHeader
              title={t.telegramTitle}
              description={t.telegramDesc}
              step={3}
              total={TOTAL_STEPS}
              // رکورد در انتظار زنده می‌ماند؛ برگشتن به هویت همان
              // `registrationId` را دوباره می‌فرستد و ردیف تازه‌ای نمی‌سازد.
              onBack={() => goBack("identity")}
            />
            <TelegramLinkPanel mode="register" deepLink={deepLink} waiting />
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => registrationId && void refreshStatus(registrationId, { force: true })}
            >
              {t.continue}
            </Button>
          </div>
        )}

        {/* ── گام ۴: کد ─────────────────────────────────────────────────── */}
        {step === "code" && (
          <div className="space-y-5">
            {/* بازگشت فقط دیپ‌لینک و QR را دوباره نشان می‌دهد — کد تازه‌ای
                نمی‌فرستد؛ ارسال مجدد دکمه‌ی خودش را دارد. */}
            <AuthStepHeader
              title={t.codeTitle}
              description={t.codeDesc}
              step={4}
              total={TOTAL_STEPS}
              onBack={() => goBack("telegram")}
            />

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
            {/* عمداً بدون بازگشت: کد در این نقطه مصرف شده و `verifiedAt` روی
                سرور ست شده. برگشتن به گام کد، صفحه‌ی ورود کدی را نشان می‌داد
                که دیگر وجود ندارد. برای عوض کردن ایمیل، همین صفحه دکمه‌ی
                ویرایش دارد. */}
            <AuthStepHeader
              title={t.finishTitle}
              description={t.finishDesc}
              step={5}
              total={TOTAL_STEPS}
            />

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
