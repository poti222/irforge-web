import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { customFetch, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Phone, Mail, LifeBuoy, Send, MessageSquareText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import { hoverLiftMotion } from "@/lib/motion-variants";
import { BrandLogo } from "@/components/layout/brand-home";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { BackHomeButton } from "@/components/layout/back-home-button";
import { CodeInput } from "@/components/auth/CodeInput";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { GitHubIcon } from "@/components/auth/GitHubIcon";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";
import { AuthStepHeader } from "@/components/auth/AuthStepHeader";
import { setAuthToken } from "@/lib/auth-token";
import { EMAIL_AUTH_CLOSED } from "@/lib/auth-policy";

/**
 * دو راه ورود، یک صفحه.
 *
 * ۱ **ورود با تلگرام (یک کلیک)** — کاربر دکمه را می‌زند، وارد بات می‌شود، بات
 *   او را از روی `telegram_id` می‌شناسد و می‌گوید «وارد شدید»؛ همین صفحه که
 *   در حال poll است، نشست را می‌گیرد و به داشبورد می‌رود. نه شماره، نه رمز،
 *   نه کد شش‌رقمی — چون تلگرام خودش هویت را تضمین کرده و مالکیت حساب تلگرام
 *   دقیقاً همان عاملی است که مسیر دوم با کد ثابتش می‌کند.
 *
 * ۲ **شماره + رمز → کد در تلگرام** — مسیر قبلی، دست‌نخورده. برای کسی که
 *   تلگرامش روی این دستگاه نیست، و تنها راهِ حسابی که هنوز وصل نشده.
 *
 * کد در **هر** ورودِ مسیر دوم لازم است. «این دستگاه را به خاطر بسپار» عمداً
 * وجود ندارد: عامل دومی که می‌شود خاموشش کرد، برای مهاجمی که رمز را دارد
 * یعنی فقط یک چک‌باکس فاصله تا حساب.
 */

type Step = "credentials" | "code" | "needs_telegram" | "telegram_waiting" | "sms_phone" | "sms_code";

/** شماره و رمز → کد تلگرام. */
const TOTAL_STEPS = 2;

/**
 * درخواست ورودِ تلگرام، در `sessionStorage`.
 *
 * روی موبایل، رفتن به تلگرام یعنی خروج از مرورگر و معمولاً پاک‌شدن تب از
 * حافظه؛ برگشتن یک بارگذاری کامل است که `useState` را از بین می‌برد. بدون
 * این، کاربر برمی‌گشت و صفحه‌ی ورودِ خالی می‌دید در حالی که ورودش همان لحظه
 * تأیید شده بود. همان درسی که `register.tsx` هم دارد.
 *
 * `pollSecret` اینجا می‌ماند و **هرگز در URL نمی‌رود** — از آنجا به referrer و
 * تاریخچه‌ی مرورگر نشت می‌کرد.
 */
const TG_STORAGE_KEY = "irforge_tg_login";

interface TgLoginRequest {
  id: string;
  pollSecret: string;
  deepLink: string;
}

/**
 * باز کردن لینک عمیق — روی موبایل و دسکتاپ عمداً متفاوت.
 *
 * روی **موبایل** همین تب: تب `_blank` به‌صورت ضمنی `noopener` می‌گیرد و
 * `sessionStorage` والد را به ارث نمی‌برد، پس اگر کاربر بعد از تلگرام سر از
 * آن تب دربیاورد، صفحه درخواستِ در جریان را نمی‌بیند. صفحه‌ی فعلی به bfcache
 * می‌رود و دست‌نخورده برمی‌گردد. (همان دلیلی که `TelegramLinkPanel` هم
 * `sameTab` دارد.)
 *
 * روی **دسکتاپ** برعکس: `t.me/...` در همان تب یعنی صفحه‌ی ورود جایش را به
 * سایت تلگرام می‌دهد و چیزی برای poll کردن باقی نمی‌ماند. تب تازه باز می‌شود
 * و صفحه‌ی انتظار — با QR — سر جایش می‌ماند. اگر مرورگر پاپ‌آپ را بست هم
 * چیزی خراب نمی‌شود: همان صفحه دکمه و QR را دارد.
 */
function openTelegram(deepLink: string) {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = deepLink;
    return;
  }
  window.open(deepLink, "_blank", "noopener,noreferrer");
}

/** همان الگوی register.tsx: «۰۹۱۲···۴۵۶۷» به‌جای شماره‌ی کامل. */
function maskPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `${digits.slice(0, 4)}···${digits.slice(-4)}`;
}

function loadTgRequest(): TgLoginRequest | null {
  try {
    const raw = sessionStorage.getItem(TG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.pollSecret === "string") {
      return { id: parsed.id, pollSecret: parsed.pollSecret, deepLink: parsed.deepLink ?? "" };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export default function Login() {
  const t = useT("auth") as Record<string, string>;
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  useSEO({ title: t.signIn ?? "Sign in | IrForge", noindex: true });

  const [step, setStep] = useState<Step>("credentials");
  const [loginMethod, setLoginMethod] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState<string>("Telegram");
  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [codeErrorMessage, setCodeErrorMessage] = useState<string | undefined>(undefined);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [linkDeepLink, setLinkDeepLink] = useState<string | null>(null);

  const { lang } = useLanguage();
  const [tgRequest, setTgRequest] = useState<TgLoginRequest | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);

  // ─── ورود سریع با کد پیامکی ───────────────────────────────────────────────
  // بدون رمز عبور: کدِ سرور با purpose="login" مستقیم یک نشستِ کامل صادر
  // می‌کند (issueSession در routes/auth.ts)، دقیقاً مثل مسیر شماره+رمز، فقط
  // با یک عاملِ اثبات به‌جای دو تا. همان CodeInput و همان ثانیه‌شمارِ بالا
  // (`secondsLeft`) اینجا هم استفاده می‌شوند — دو مسیر هیچ‌وقت هم‌زمان فعال
  // نیستند، پس تداخلی در کار نیست.
  const [smsLoginPhone, setSmsLoginPhone] = useState("");
  const [smsResendIn, setSmsResendIn] = useState(0);

  useEffect(() => {
    if (smsResendIn <= 0) return;
    const id = window.setInterval(() => setSmsResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [smsResendIn]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setInterval(() => setSecondsLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [secondsLeft]);

  // ─── ورود با تلگرام ───────────────────────────────────────────────────────

  /** درخواستِ در جریان را دور می‌ریزد و به گام اول برمی‌گردد. */
  const resetTelegram = useCallback((message?: string) => {
    sessionStorage.removeItem(TG_STORAGE_KEY);
    setTgRequest(null);
    setTgError(message ?? null);
    setStep("credentials");
  }, []);

  /**
   * بازگشت از تلگرام روی موبایل معمولاً یک بارگذاری کامل است، پس درخواستِ
   * ذخیره‌شده در همان mount برداشته می‌شود و کاربر مستقیم روی گام انتظار
   * می‌نشیند — نه روی فرم خالی.
   */
  useEffect(() => {
    const saved = loadTgRequest();
    if (saved) {
      setTgRequest(saved);
      setStep("telegram_waiting");
    }
  }, []);

  const finishSession = useCallback(
    (res: { user: any; token: string }) => {
      // همان کلیدی که main.tsx برای هدر Authorization می‌خواند ("irforge_token").
      // نوشتن روی کلید دیگر یعنی همه‌ی درخواست‌های بعدی بدون Authorization
      // بروند و سرور ۴۰۱ بدهد، در حالی که UI کاربر را واردشده نشان می‌دهد.
      setAuthToken(res.token);
      queryClient.setQueryData(getGetMeQueryKey(), res.user);
      navigate("/dashboard");
    },
    [navigate, queryClient],
  );

  async function startTelegramLogin() {
    setBusy(true);
    setTgError(null);
    try {
      const res = await customFetch<{
        id: string;
        pollSecret: string;
        deepLink: string;
        expiresInSeconds: number;
      }>("/api/auth/telegram/login/start", {
        method: "POST",
        body: JSON.stringify({ locale: lang }),
      });

      const request: TgLoginRequest = {
        id: res.id,
        pollSecret: res.pollSecret,
        deepLink: res.deepLink,
      };
      // ذخیره **قبل** از باز کردن تلگرام: بعدش ممکن است این تب دیگر کد اجرا نکند.
      sessionStorage.setItem(TG_STORAGE_KEY, JSON.stringify(request));
      setTgRequest(request);
      setSecondsLeft(res.expiresInSeconds);
      setStep("telegram_waiting");

      openTelegram(res.deepLink);
    } catch (err: any) {
      if (err?.status === 503) {
        setTgError(t.tgUnavailable);
      } else {
        fail(err);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * poll تا وقتی بات تأیید کند.
   *
   * دو ثانیه فاصله عمدی است: کاربر همین حالا در حال زدن دکمه‌ی بات است و
   * تأخیرِ محسوس، فیچر را «کار نمی‌کند» نشان می‌دهد. اندپوینت `rate limit`
   * ندارد و محافظش `pollSecret` است، پس این نرخ مشکلی نمی‌سازد.
   */
  const pollingRef = useRef(false);
  useEffect(() => {
    if (step !== "telegram_waiting" || !tgRequest) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const res = await customFetch<{
          status: "pending" | "approved" | "rejected" | "expired";
          reason?: string;
          user?: any;
          token?: string;
        }>(
          `/api/auth/telegram/login/${tgRequest.id}/status?secret=${encodeURIComponent(
            tgRequest.pollSecret,
          )}`,
        );

        if (cancelled) return;
        if (res.status === "approved" && res.token && res.user) {
          sessionStorage.removeItem(TG_STORAGE_KEY);
          finishSession({ user: res.user, token: res.token });
          return;
        }
        if (res.status === "rejected") {
          resetTelegram(
            res.reason === "no_account"
              ? t.tgNoAccount
              : res.reason === "suspended"
                ? t.tgSuspended
                : t.tgFailed,
          );
          return;
        }
        if (res.status === "expired") {
          resetTelegram(t.tgExpired);
        }
      } catch (err: any) {
        // ۴۰۴ یعنی درخواست پاک شده یا راز نمی‌خواند — چرخیدن تا ابد بی‌فایده
        // است. بقیه‌ی خطاها (قطعی گذرای شبکه) نادیده و دفعه‌ی بعد دوباره.
        if (!cancelled && err?.status === 404) resetTelegram(t.tgExpired);
      } finally {
        pollingRef.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [step, tgRequest, finishSession, resetTelegram, t]);

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
        body: JSON.stringify(
          loginMethod === "email" ? { email: email.trim(), password } : { phone: phone.trim(), password },
        ),
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
    setCodeErrorMessage(undefined);
    try {
      const res = await customFetch<{ user: any; token: string }>("/api/auth/login/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId, code: entered }),
      });
      finishSession(res);
    } catch (err: any) {
      setCodeInvalid(true);
      setCode("");
      if (err?.data?.code === "too_many_attempts" || err?.data?.code === "challenge_expired") {
        setStep("credentials");
        setChallengeId(null);
        toast({ variant: "destructive", title: t.tooManyAttempts });
        return;
      }
      const attemptsLeft = err?.data?.attemptsLeft;
      if (err?.data?.code === "invalid_code" && typeof attemptsLeft === "number") {
        setCodeErrorMessage((t.codeAttemptsLeft ?? "").replace("{n}", String(attemptsLeft)));
      }
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * بازگشت به گام اعتبارنامه. چالش جاری عمداً دور ریخته می‌شود: کدی که برای
   * یک تلاش ورود صادر شده نباید بعد از تایپ دوباره‌ی شماره هنوز معتبر باشد.
   */
  function goBackToCredentials() {
    setChallengeId(null);
    setCode("");
    setCodeInvalid(false);
    setCodeErrorMessage(undefined);
    setSecondsLeft(0);
    setStep("credentials");
  }

  // ─── ورود سریع با کد پیامکی ───────────────────────────────────────────────

  async function startSmsLogin() {
    if (!smsLoginPhone.trim()) return;
    setBusy(true);
    try {
      const res = await customFetch<{ message: string; expiresInSeconds: number }>(
        "/api/auth/otp/sms/send",
        {
          method: "POST",
          body: JSON.stringify({ phone: smsLoginPhone.trim(), purpose: "login" }),
        },
      );
      setCode("");
      setCodeInvalid(false);
      setCodeErrorMessage(undefined);
      setSecondsLeft(res.expiresInSeconds ?? 120);
      setSmsResendIn(60);
      setStep("sms_code");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verifySmsLogin(entered: string) {
    if (entered.length !== 6) return;
    setBusy(true);
    setCodeInvalid(false);
    setCodeErrorMessage(undefined);
    try {
      const res = await customFetch<{ user: any; token: string }>("/api/auth/otp/sms/verify", {
        method: "POST",
        body: JSON.stringify({ phone: smsLoginPhone.trim(), code: entered, purpose: "login" }),
      });
      finishSession(res);
    } catch (err: any) {
      setCodeInvalid(true);
      setCode("");
      if (err?.data?.code === "too_many_attempts" || err?.data?.code === "code_expired") {
        setStep("sms_phone");
        toast({ variant: "destructive", title: t.tooManyAttempts });
        return;
      }
      const attemptsLeft = err?.data?.attemptsLeft;
      if (err?.data?.code === "invalid_code" && typeof attemptsLeft === "number") {
        setCodeErrorMessage((t.codeAttemptsLeft ?? "").replace("{n}", String(attemptsLeft)));
      }
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function resendSmsLogin() {
    if (!smsLoginPhone.trim()) return;
    setBusy(true);
    try {
      const res = await customFetch<{ message: string; expiresInSeconds: number }>(
        "/api/auth/otp/sms/send",
        {
          method: "POST",
          body: JSON.stringify({ phone: smsLoginPhone.trim(), purpose: "login" }),
        },
      );
      setSmsResendIn(60);
      setSecondsLeft(res.expiresInSeconds ?? 120);
      setCode("");
      setCodeInvalid(false);
      setCodeErrorMessage(undefined);
    } catch (err: any) {
      if (typeof err?.data?.retryAfterSeconds === "number") setSmsResendIn(err.data.retryAfterSeconds);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function goBackToSmsPhone() {
    setCode("");
    setCodeInvalid(false);
    setCodeErrorMessage(undefined);
    setSecondsLeft(0);
    setStep("sms_phone");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <BackHomeButton className="fixed start-4 top-4 z-10" />
      <PublicPageControls className="fixed end-4 top-4 z-10" />
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <BrandLogo href="/" />
        </div>

        <div className="bg-card px-4 py-8 shadow-xl sm:rounded-xl border sm:px-10">
        {step === "credentials" && (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); void submitCredentials(); }}
          >
            <AuthStepHeader title={t.signInAccount} step={1} total={TOTAL_STEPS} />

            {/*
              راه‌های ورودِ یک‌کلیکی (تلگرام، گوگل، گیت‌هاب) از ایمیل/شماره
              جدا و کوچک‌ترند: این سه هیچ فرمی زیرشان باز نمی‌کنند — همان لحظه
              کاربر را به مقصد می‌فرستند — پس جای کارت‌های بزرگِ هم‌قواره با
              فرم پایین نیستند. ایمیل/شماره پایین‌تر، بزرگ و انتخاب‌پذیر
              می‌مانند چون فرم زیرشان همین‌جا باز می‌شود.
            */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void startTelegramLogin()}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border px-2 py-2.5 text-center transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
                aria-label={t.tgLoginButton}
                title={t.tgLoginHint}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                </span>
                <span className="text-xs font-medium leading-tight">{t.tgLoginButton}</span>
              </button>

              {/*
                گوگل و گیت‌هاب هم مثل تلگرام یک‌کلیکی‌اند: navigation کامل (نه
                fetch) به سرور، که خودش کاربر را به آن سرویس می‌فرستد. توکن
                نهایی از طریق auth-google-callback.tsx / auth-github-callback.tsx
                برمی‌گردد.
              */}
              <motion.button
                type="button"
                {...(reduceMotion ? {} : hoverLiftMotion)}
                disabled={busy}
                onClick={() => {
                  window.location.href = `${import.meta.env.VITE_API_URL ?? ""}/api/auth/google`;
                }}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border px-2 py-2.5 text-center transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
                aria-label={t.googleLoginButton}
                title={t.googleLoginHint}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <GoogleIcon className="size-4" />
                </span>
                <span className="text-xs font-medium leading-tight">{t.googleLoginButton}</span>
              </motion.button>

              <motion.button
                type="button"
                {...(reduceMotion ? {} : hoverLiftMotion)}
                disabled={busy}
                onClick={() => {
                  window.location.href = `${import.meta.env.VITE_API_URL ?? ""}/api/auth/github`;
                }}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border px-2 py-2.5 text-center transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
                aria-label={t.githubLoginButton}
                title={t.githubLoginHint}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <GitHubIcon className="size-4" />
                </span>
                <span className="text-xs font-medium leading-tight">{t.githubLoginButton}</span>
              </motion.button>
            </div>

            {tgError && (
              <p className="text-center text-sm text-destructive" role="alert">
                {tgError}
              </p>
            )}

            {/* جداکننده‌ی «یا» — تا فرم پایین یک گزینه دیده شود، نه گام بعدی. */}
            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t.orDivider}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {/*
              ایمیل و شماره: کارت‌های بزرگ و هم‌قواره‌ی قبلی، دست‌نخورده. هر
              کارت آیکون + زیرنویسِ «چه چیزی لازم داری» دارد و وقتی انتخاب
              است یک ring می‌گیرد تا معلوم باشد فرمِ زیرش الان مال کدام‌شان
              است.
              ورود با ایمیل بسته است (lib/auth-policy.ts) — با یک گزینه‌ی
              تنها، خودِ این انتخاب‌گر بی‌معنی می‌شد؛ پس این‌جا کلاً پنهان
              می‌شود و فرم مستقیم می‌رود سراغ شماره (شرطِ همان بستنِ زیرِ
              گرید هم دقیقاً همین رفتار را تضمین می‌کند).
            */}
            {!EMAIL_AUTH_CLOSED && (
              <div className="space-y-2.5">
                <motion.button
                  type="button"
                  {...(reduceMotion ? {} : hoverLiftMotion)}
                  disabled={busy}
                  onClick={() => setLoginMethod("email")}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-start transition-colors disabled:pointer-events-none disabled:opacity-50",
                    loginMethod === "email"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                    <Mail className="size-5" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium">{t.email}</span>
                    <span className="text-xs text-muted-foreground">{t.loginPassword}</span>
                  </span>
                </motion.button>

                <motion.button
                  type="button"
                  {...(reduceMotion ? {} : hoverLiftMotion)}
                  disabled={busy}
                  onClick={() => setLoginMethod("phone")}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-start transition-colors disabled:pointer-events-none disabled:opacity-50",
                    loginMethod === "phone"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                    <Phone className="size-5" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium">{t.loginPhone}</span>
                    <span className="text-xs text-muted-foreground">{t.loginPassword}</span>
                  </span>
                </motion.button>
              </div>
            )}

            {/* شناسه (شماره/ایمیل) و رمز عبور: از سایز تبلت به بالا کنار هم، روی موبایل زیر هم — گرید ثابتِ دوستونه اینجا را روی گوشی می‌شکست. */}
            <div className="grid gap-3 sm:grid-cols-2">
              {EMAIL_AUTH_CLOSED || loginMethod === "phone" ? (
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
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">{t.email}</Label>
                  <Input
                    id="login-email"
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              )}
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
            </div>

            <GlowButton type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.loginContinue}
            </GlowButton>

            <button
              type="button"
              onClick={() => setStep("sms_phone")}
              className="flex w-full items-center gap-2 rounded-lg border p-3 text-start transition-colors hover:border-primary/60"
            >
              <MessageSquareText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm">{t.smsLoginButton}</span>
            </button>

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
            {/* بازگشت، چالش جاری را رها می‌کند و به شماره/رمز برمی‌گردد. */}
            <AuthStepHeader
              title={t.loginCodeTitle}
              description={(t.loginCodeDesc ?? "").replace("{dest}", destination)}
              step={2}
              total={TOTAL_STEPS}
              onBack={goBackToCredentials}
            />

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

            <GlowButton
              className="w-full"
              disabled={busy || code.length !== 6}
              onClick={() => void verify(code)}
            >
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.loginVerify}
            </GlowButton>
          </div>
        )}

        {step === "telegram_waiting" && tgRequest && (
          <div className="space-y-5">
            <AuthStepHeader
              title={t.tgWaitingTitle}
              description={t.tgWaitingDesc}
              step={2}
              total={TOTAL_STEPS}
              onBack={() => resetTelegram()}
            />

            {/*
              همان پنل ثبت‌نام: دکمه‌ی «باز کردن تلگرام» + QR. QR اینجا هم
              اختیاری نیست — روی دسکتاپ بدون تلگرامِ نصب‌شده، لینک `t.me` تنها
              کاری که می‌کند باز کردن یک صفحه‌ی وب است.
            */}
            <TelegramLinkPanel mode="register" deepLink={tgRequest.deepLink} waiting sameTab />

            <p className="text-center text-sm text-muted-foreground" aria-live="polite">
              {secondsLeft > 0
                ? (t.codeExpiresIn ?? "").replace(
                    "{t}",
                    `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
                  )
                : t.tgExpired}
            </p>
          </div>
        )}

        {step === "sms_phone" && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void startSmsLogin(); }}>
            <AuthStepHeader
              title={t.smsLoginTitle}
              description={t.smsLoginDesc}
              step={1}
              total={TOTAL_STEPS}
              onBack={() => setStep("credentials")}
            />

            <div className="space-y-1.5">
              <Label htmlFor="sms-login-phone">{t.loginPhone}</Label>
              <Input
                id="sms-login-phone"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                value={smsLoginPhone}
                onChange={(e) => setSmsLoginPhone(e.target.value)}
                required
              />
            </div>

            <GlowButton type="submit" className="w-full" disabled={busy || !smsLoginPhone.trim()}>
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.smsLoginSend}
            </GlowButton>
          </form>
        )}

        {step === "sms_code" && (
          <div className="space-y-5">
            <AuthStepHeader
              title={t.loginCodeTitle}
              description={(t.smsLoginCodeDesc ?? "").replace("{dest}", maskPhoneForDisplay(smsLoginPhone))}
              step={2}
              total={TOTAL_STEPS}
              onBack={goBackToSmsPhone}
            />

            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(c) => void verifySmsLogin(c)}
              disabled={busy}
              invalid={codeInvalid}
              errorMessage={codeErrorMessage}
              webOtp
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
              onClick={() => void verifySmsLogin(code)}
            >
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.loginVerify}
            </GlowButton>

            <Button
              variant="ghost"
              className="w-full"
              disabled={busy || smsResendIn > 0}
              onClick={() => void resendSmsLogin()}
            >
              {smsResendIn > 0 ? (t.resendIn ?? "").replace("{n}", String(smsResendIn)) : t.resend}
            </Button>
          </div>
        )}

        {step === "needs_telegram" && (
          <div className="space-y-4">
            <AuthStepHeader
              title={t.needsTelegram}
              description={t.needsTelegramDesc}
              step={2}
              total={TOTAL_STEPS}
              onBack={goBackToCredentials}
            />
            <TelegramLinkPanel mode="register" deepLink={linkDeepLink} waiting sameTab />

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
    </div>
  );
}
