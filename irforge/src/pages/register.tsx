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
import { Loader2, Phone, Mail, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { BrandLogo } from "@/components/layout/brand-home";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { CodeInput } from "@/components/auth/CodeInput";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";
import { AuthStepHeader } from "@/components/auth/AuthStepHeader";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/TurnstileWidget";
import { useCaptchaConfig } from "@/config/captcha";
import { setAuthToken } from "@/lib/auth-token";

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

/**
 * چیزی که در `sessionStorage` می‌ماند. تا پیش از این فقط `id` ذخیره می‌شد؛
 * روی موبایل کافی نبود: وقتی کاربر برای باز کردن تلگرام از صفحه بیرون می‌رود،
 * مرورگر معمولاً تب را از حافظه پاک می‌کند و برگشتن یعنی یک بارگذاری کامل.
 * آن بارگذاری `deepLink` و گام جاری را — که فقط در state بودند — از دست می‌داد
 * و کاربر روی گام یک ظاهر می‌شد.
 */
interface SavedRegistration {
  id: string;
  deepLink: string | null;
  step: Step;
  method: "phone" | "email";
}

function loadSaved(): SavedRegistration | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string") {
      return {
        id: parsed.id,
        deepLink: parsed.deepLink ?? null,
        step: parsed.step ?? "telegram",
        method: parsed.method === "email" ? "email" : "phone",
      };
    }
  } catch {
    // نسخه‌ی قدیمی فقط رشته‌ی id را ذخیره می‌کرد.
    return { id: raw, deepLink: null, step: "telegram", method: "phone" };
  }
  return null;
}

function saveRegistration(data: SavedRegistration) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * روش → هویت → [تلگرام] → کد → رمز عبور.
 *
 * گام تلگرام فقط در مسیر شماره است؛ مسیر ایمیل چهار گام دارد نه پنج.
 */
function stepNumber(method: "phone" | "email", s: Step): number {
  switch (s) {
    case "method": return 1;
    case "identity": return 2;
    case "telegram": return 3;
    case "code": return method === "email" ? 3 : 4;
    case "finish": return method === "email" ? 4 : 5;
  }
}

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

/** IRFORGE_PROMPT_V3 Phase 15 — «۰۹۱۲···۴۵۶۷» به‌جای شماره‌ی کامل. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `${digits.slice(0, 4)}···${digits.slice(-4)}`;
}

/** همان ایده برای ایمیل: فقط دو حرف اول + دامنه دیده می‌شود. */
function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return value;
  return `${value.slice(0, Math.min(2, at))}···${value.slice(at)}`;
}

export default function Register() {
  const t = useT("auth") as Record<string, string>;
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useSEO({ title: t.createAccount ?? "Sign up | IrForge", noindex: true });

  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [status, setStatus] = useState<RegStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // جدا از `busy` نگه داشته می‌شود: این فقط دکمه‌ی «ادامه»ی گام تلگرام را
  // مشغول نشان می‌دهد و نباید بقیه‌ی فرم‌ها را قفل کند.
  const [checking, setChecking] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);

  // IRFORGE_PROMPT_V3 Phase 42 — abuse gate on the free identity step.
  const captchaConfig = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const tCaptcha = useT("captcha");

  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [codeErrorMessage, setCodeErrorMessage] = useState<string | undefined>(undefined);
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

  // بازیابی بعد از رفرش (یا بعد از برگشتن از اپ تلگرام روی موبایل).
  //
  // گام و لینک عمیق **قبل از** رفتن به شبکه از حافظه برمی‌گردند؛ اگر منتظر
  // پاسخ سرور می‌ماندیم، کاربر یک لحظه گام یک را می‌دید و اگر آن درخواست
  // شکست می‌خورد (که موقع برگشتن به اینترنت خیلی هم عادی است) همان‌جا گیر
  // می‌کرد.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved) return;
    setRegistrationId(saved.id);
    setDeepLink(saved.deepLink);
    setStep(saved.step);
    setMethod(saved.method);
    void refreshStatus(saved.id, { force: true });
    // فقط یک‌بار در mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // هر بار که گام یا لینک عوض شد، عکس تازه‌ای برای بازیابی بعدی ذخیره کن.
  useEffect(() => {
    if (!registrationId) return;
    saveRegistration({ id: registrationId, deepLink, step, method });
  }, [registrationId, deepLink, step, method]);

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
    } catch (err: any) {
      // فقط وقتی از اول شروع می‌کنیم که سرور **صریحاً** بگوید رکورد دیگر
      // نیست. قبلاً هر خطایی همین کار را می‌کرد، و روی موبایل همین باعث
      // باگ می‌شد: کاربر از تلگرام برمی‌گشت، اولین poll در لحظه‌ی وصل شدن
      // دوباره‌ی شبکه شکست می‌خورد، و کل ثبت‌نام پاک و به گام یک برمی‌گشت.
      const gone = err?.status === 404 || err?.status === 410;
      if (!gone) return null;

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

  // برگشتن از اپ تلگرام = تب دوباره visible می‌شود. همان‌جا وضعیت را می‌پرسیم
  // به‌جای اینکه تا poll بعدی صبر کنیم؛ مرورگرهای موبایل تایمرهای تب پس‌زمینه
  // را کند یا کلاً متوقف می‌کنند، پس نمی‌شود روی interval حساب کرد.
  // `pageshow` هم لازم است: وقتی صفحه از bfcache برمی‌گردد، اصلاً mount دوباره
  // اتفاق نمی‌افتد.
  useEffect(() => {
    if (step !== "telegram" || !registrationId) return;

    const resume = () => {
      if (document.visibilityState !== "visible") return;
      void refreshStatus(registrationId);
    };

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
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

  /**
   * دکمه‌ی «ادامه»ی گام تلگرام.
   *
   * قبلاً مستقیم `refreshStatus` را صدا می‌زد و اگر سرور هنوز روی
   * `identity`/`telegram_pending` بود، گام مقصد همین گام فعلی درمی‌آمد —
   * یعنی `setStep` هیچ چیزی را عوض نمی‌کرد و دکمه از دید کاربر کاملاً مرده
   * بود: نه اسپینر، نه پیام، نه خطا. حالا همیشه یک جواب می‌گیرد.
   */
  async function checkTelegramProgress() {
    const id = registrationId ?? loadSaved()?.id ?? null;
    if (!id) {
      // رکورد گم شده — به‌جای دکمه‌ی بی‌اثر، صریح از اول شروع کن.
      setStep("identity");
      toast({ variant: "destructive", title: t.genericAuthError });
      return;
    }
    if (checking) return;

    setChecking(true);
    try {
      const s = await refreshStatus(id, { force: true });
      if (!s) {
        toast({ variant: "destructive", title: t.genericAuthError });
        return;
      }
      // سرور هنوز جلو نرفته: کاربر داخل بات شماره‌اش را نفرستاده.
      if (stepForServer(s.step) === "telegram") {
        toast({ title: t.telegramNotDoneTitle, description: t.telegramNotDoneDesc });
      }
    } finally {
      setChecking(false);
    }
  }

  async function startRegistration() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    if (captchaConfig.enabled && !captchaToken) {
      toast({ variant: "destructive", title: tCaptcha.required });
      return;
    }
    setBusy(true);
    try {
      if (method === "email") {
        // مسیر ایمیل گام تلگرام ندارد: کد همین‌جا و بلافاصله فرستاده می‌شود.
        const res = await customFetch<{ registrationId: string; step?: string }>(
          "/api/auth/register/email/start",
          {
            method: "POST",
            body: JSON.stringify({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              locale: lang,
              captchaToken,
            }),
          },
        );
        setRegistrationId(res.registrationId);
        setDeepLink(null);
        saveRegistration({ id: res.registrationId, deepLink: null, step: "code", method: "email" });
        lastServerStepRef.current = res.step ?? "code_sent";
        setStep("code");
        // مسیر شماره این را از همان poll گام تلگرام می‌گیرد؛ مسیر ایمیل هیچ
        // poll ای ندارد، پس بدون این fetch صریح، `codeExpiresAt`/`canResend`
        // هرگز پر نمی‌شدند و شمارش معکوس همان لحظه «منقضی شده» نشان می‌داد.
        await refreshStatus(res.registrationId, { force: true });
        return;
      }

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
      saveRegistration({ id: res.registrationId, deepLink: res.deepLink, step: "telegram", method: "phone" });
      lastServerStepRef.current = res.step ?? null;
      setStep("telegram");
    } catch (err) {
      // A Turnstile token is single-use — whatever failed, the one already
      // spent (or possibly-spent) is no good for a retry.
      turnstileRef.current?.reset();
      setCaptchaToken(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(entered: string) {
    if (!registrationId || entered.length !== 6) return;
    setBusy(true);
    setCodeInvalid(false);
    setCodeErrorMessage(undefined);
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
      // IRFORGE_PROMPT_V3 Phase 15 — «کد اشتباه است» به‌تنهایی کاربر را رها
      // می‌کند؛ تعداد تلاش باقی‌مانده می‌گوید عجله برای دوباره‌فرستادن هست یا نه.
      const attemptsLeft = err?.data?.attemptsLeft;
      const message =
        err?.data?.code === "invalid_code" && typeof attemptsLeft === "number"
          ? (t.codeAttemptsLeft ?? "").replace("{n}", String(attemptsLeft))
          : serverMessage(err);
      setCodeErrorMessage(message);
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
      setCode("");
      setCodeInvalid(false);
      setCodeErrorMessage(undefined);
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
      // Same key `customFetch`'s auth-token getter reads ("irforge_token") —
      // see the note in login.tsx's verify(). Mismatched keys here silently
      // break every authenticated request after registration.
      setAuthToken(res.token);
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
      <PublicPageControls className="fixed end-4 top-4 z-10" />
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <BrandLogo href="/" />
        </div>

        {/* ── گام ۱: انتخاب روش ─────────────────────────────────────────── */}
        {step === "method" && (
          <div className="space-y-4">
            {/* گام اول: بازگشتی وجود ندارد، پس فقط نشانگر گام. */}
            <AuthStepHeader title={t.methodTitle} step={1} total={stepNumber(method, "finish")} />

            <button
              type="button"
              onClick={() => { setMethod("phone"); setStep("identity"); }}
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

            <button
              type="button"
              onClick={() => { setMethod("email"); setStep("identity"); }}
              className="w-full rounded-xl border p-5 text-start transition-colors hover:border-primary/60"
            >
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold">{t.methodEmail}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t.methodEmailDesc}</p>
                </div>
              </div>
            </button>

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
              description={method === "email" ? t.identityDescEmail : t.identityDesc}
              step={stepNumber(method, "identity")}
              total={stepNumber(method, "finish")}
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

            <GlowButton type="submit" className="w-full" disabled={busy || (captchaConfig.enabled && !captchaToken)}>
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
              step={stepNumber(method, "telegram")}
              total={stepNumber(method, "finish")}
              // رکورد در انتظار زنده می‌ماند؛ برگشتن به هویت همان
              // `registrationId` را دوباره می‌فرستد و ردیف تازه‌ای نمی‌سازد.
              onBack={() => goBack("identity")}
            />
            {/* `sameTab`: باز کردن لینک در تب جدید روی موبایل یعنی تب تازه‌ای
                با sessionStorage خالی — و همان بود که ثبت‌نام را می‌پراند. */}
            <TelegramLinkPanel mode="register" deepLink={deepLink} waiting sameTab />
            <Button
              variant="ghost"
              className="w-full"
              disabled={checking}
              onClick={() => void checkTelegramProgress()}
            >
              {checking && <Loader2 className="me-2 size-4 animate-spin" />}
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
              description={method === "email" ? t.codeDescEmail : t.codeDesc}
              step={stepNumber(method, "code")}
              total={stepNumber(method, "finish")}
              onBack={() => goBack(method === "email" ? "identity" : "telegram")}
            />

            {/* مقصد ماسک‌شده — نه رشته‌ی خام، ولی به‌قدر کافی برای این‌که کاربر
                مطمئن شود کجا فرستاده شده. اینجا هیچ «✅ فرستاده شد» با علامت
                سبز ادعا نمی‌شود چون هیچ تأییدیه‌ی واقعی تحویل (کیو ارسال، فاز
                ۱۲) هنوز وجود ندارد — فقط همان چیزی گفته می‌شود که واقعاً اتفاق
                افتاده: تلاش برای ارسال. */}
            <p className="text-center text-sm text-muted-foreground" dir="ltr">
              {method === "email"
                ? maskEmail(email)
                : status?.phone
                  ? maskPhone(status.phone)
                  : ""}
            </p>

            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(c) => void verify(c)}
              disabled={busy}
              invalid={codeInvalid}
              errorMessage={codeErrorMessage}
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

            <div className="space-y-2">
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
              {/* بعد از رسیدن به سقفِ ارسال مجدد، بن‌بست نیست — یک مسیر واقعی. */}
              {status?.canResend === false && (
                <Link
                  href="/support?topic=verification-code"
                  className="block text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  {t.codeNotReceived}
                </Link>
              )}
            </div>
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
              description={method === "email" ? t.finishDescEmail : t.finishDesc}
              step={stepNumber(method, "finish")}
              total={stepNumber(method, "finish")}
            />

            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                {method === "phone" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t.connectedAs}</span>
                    <span className="truncate font-medium" dir="ltr">
                      {status?.telegramUsername ? `@${status.telegramUsername}` : telegramName || "—"}
                    </span>
                  </div>
                )}
                {method === "phone" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t.phoneLabel}</span>
                    <span className="font-medium tabular-nums" dir="ltr">{status?.phone ?? "—"}</span>
                  </div>
                )}
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
