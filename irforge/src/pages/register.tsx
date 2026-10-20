import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetMeQueryKey } from "@workspace/api-client-react";
import {
  AtSign,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Smartphone,
  User,
} from "lucide-react";
import { EnamadSeal } from "@/components/layout/enamad-seal";
import { consumePostAuthTarget } from "@/lib/post-auth";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { AuthShell } from "@/components/auth/AuthShell";
import { CodeInput } from "@/components/auth/CodeInput";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { GitHubIcon } from "@/components/auth/GitHubIcon";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/TurnstileWidget";
import { useCaptchaConfig } from "@/config/captcha";
import { setAuthToken } from "@/lib/auth-token";

/**
 * ثبت‌نام «یک‌صفحه‌ای».
 *
 * همه‌ی مراحل روی یک صفحه‌اند و کاربر به هر ترتیبی می‌تواند فرم را پر کند، ولی
 * هر عاملِ تأیید جدا و **سمتِ سرور** ثبت می‌شود (routes/signup.ts):
 *
 *   ۱. مشخصات  — نام، جنسیت، یوزرنیم، ایمیل (ایمیل فقط افزوده می‌شود)
 *   ۲. تلگرام  — اجباری. لینکِ بات باز می‌شود؛ پیامِ تأییدِ بات دکمه‌ی بازگشت به
 *                همین صفحه دارد (با `?resume=…`) و صفحه خودش تأیید را poll می‌کند.
 *   ۳. شماره   — اجباری. کد پیامکی؛ بعد از تأیید تلگرام باز می‌شود.
 *   ۴. ایمیل   — اختیاری: دکمه‌ی «تأیید ایمیل» و (بعد از تأیید) ورود دومرحله‌ای.
 *   ۵. رمز عبور و ثبت.
 *
 * `registrationId` فقط در state و `sessionStorage` می‌ماند و **هرگز** در URL
 * نمی‌رود. تنها استثنا توکنِ `resume` است که فوراً از URL پاک می‌شود.
 *
 * نشست سمتِ سرور تا اولین «اتصال تلگرام» ساخته نمی‌شود (تا بازدیدکننده‌ی بی‌کار
 * ردیفی در دیتابیس نسازد)؛ پیش‌نویس فرم بعد از ساخته‌شدن نشست خودکار ذخیره
 * می‌شود تا مرورگرِ داخلیِ تلگرام هم بتواند ادامه بدهد.
 */

const STORAGE_KEY = "irforge_signup_id";
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const RESEND_COOLDOWN_S = 60;
const TELEGRAM_POLL_MS = 2500;

interface SignupView {
  registrationId: string;
  draft: {
    firstName: string;
    lastName: string;
    gender: "male" | "female" | null;
    platformUsername: string;
    email: string;
  };
  telegram: { verified: boolean; username: string | null; firstName: string | null };
  phone: { value: string | null; verified: boolean; codeSent: boolean; codeExpiresAt: string | null; canResend: boolean };
  email: { verified: boolean; codeSent: boolean; codeExpiresAt: string | null; canResend: boolean };
  expiresAt: string;
}

const COPY_KEYS = ["title", "subtitle", "required", "optional", "verified", "s1", "firstName", "lastName", "gender", "male", "female", "username", "usernameHint", "usernameFree", "usernameTaken", "email", "emailHint", "s2", "s2Desc", "connectTelegram", "openTelegramAgain", "waitingTelegram", "telegramOk", "s3", "s3Locked", "phone", "sendCode", "resend", "resendIn", "codeSentTo", "changePhone", "phoneOk", "s4", "verifyEmail", "emailCodeSent", "emailOk", "twoFactor", "twoFactorHint", "s5", "password", "passwordConfirm", "passwordHint", "submit", "haveAccount", "signIn", "fixErrors", "sessionExpired", "welcomeBack"] as const;
const ERROR_CODES = ["firstName_required", "lastName_required", "fake_name", "invalid_gender", "invalid_username", "username_taken", "email_required", "invalid_email", "email_taken", "invalid_password", "password_mismatch", "telegram_not_verified", "telegram_required", "telegram_taken", "phone_not_verified", "phone_taken", "invalid_phone", "invalid_code", "code_expired", "too_many_attempts", "resend_limit", "sms_send_failed", "email_delivery_failed", "email_not_verified", "rate_limited", "captcha_failed", "signup_expired"] as const;

type Copy = { [K in (typeof COPY_KEYS)[number]]: string } & { errors: Record<string, string> };

/** متن‌های صفحه از فایل‌های زبان (فضای‌نام `auth`، کلیدهای `signup*`) خوانده می‌شود. */
function copyFrom(t: Record<string, string>): Copy {
  const out: Record<string, any> = { errors: {} as Record<string, string> };
  for (const k of COPY_KEYS) out[k] = t["signup" + k[0].toUpperCase() + k.slice(1)] ?? "";
  for (const code of ERROR_CODES) out.errors[code] = t["signupErr_" + code] ?? "";
  return out as Copy;
}

/** ۰۱۲۳۴۵۶۷۸۹ فارسی و ٠١٢٣٤٥٦٧٨٩ عربی → ASCII (کیبورد فارسی موبایل). */
function foldDigits(raw: string): string {
  return raw.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 6 ? phone : `${digits.slice(0, 4)}···${digits.slice(-4)}`;
}

function api<T>(path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
  return customFetch<T>(`/api/auth/signup${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function Section({
  icon,
  title,
  badge,
  done,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`space-y-3 rounded-2xl border p-4 transition-colors ${done ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/70"}`}
    >
      <header className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-secondary text-primary"}`}>
          {done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : icon}
        </span>
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        {badge && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{badge}</span>}
      </header>
      {children}
    </section>
  );
}

export default function Register() {
  const t = useT("auth") as Record<string, string>;
  const { lang } = useLanguage();
  const c = useMemo(() => copyFrom(t), [t]);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  useSEO({ title: t.createAccount ?? "Sign up | IrForge", noindex: true });

  const captchaConfig = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  // ── فرم ────────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [enableEmail2fa, setEnableEmail2fa] = useState(false);

  // ── نشست سمتِ سرور ─────────────────────────────────────────────────────
  const [sid, setSid] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [view, setView] = useState<SignupView | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [waitingTelegram, setWaitingTelegram] = useState(false);
  // پیش از پایانِ بازیابیِ نشست، پیش‌نویسِ (هنوز خالیِ) فرم نباید روی سرور بنشیند.
  const [ready, setReady] = useState(false);

  // ── شماره ──────────────────────────────────────────────────────────────
  const [phoneInput, setPhoneInput] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCooldown, setPhoneCooldown] = useState(0);
  const [phoneCodeError, setPhoneCodeError] = useState<string | undefined>();

  // ── ایمیل ──────────────────────────────────────────────────────────────
  const [emailCode, setEmailCode] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [emailCodeError, setEmailCodeError] = useState<string | undefined>();

  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");
  const [busy, setBusy] = useState<null | "telegram" | "phoneSend" | "phoneVerify" | "emailSend" | "emailVerify" | "submit">(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const errText = useCallback(
    (err: any, fallback?: string) => {
      const code = err?.data?.code as string | undefined;
      if (code && c.errors[code]) return c.errors[code];
      return err?.data?.error || fallback || err?.message || "Error";
    },
    [c],
  );

  const persistSid = useCallback((id: string | null) => {
    setSid(id);
    try {
      if (id) sessionStorage.setItem(STORAGE_KEY, id);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage بسته است؛ فقط در حافظه می‌ماند */
    }
  }, []);

  /** نتیجه‌ی سرور را می‌گیرد؛ فیلدهای **خالیِ** فرم را از پیش‌نویسِ سرور پر می‌کند. */
  const applyView = useCallback((v: SignupView) => {
    setView(v);
    setFirstName((x) => x || v.draft.firstName);
    setLastName((x) => x || v.draft.lastName);
    setGender((x) => x ?? v.draft.gender);
    setUsername((x) => x || v.draft.platformUsername);
    setEmail((x) => x || v.draft.email);
    setPhoneInput((x) => x || v.phone.value || "");
  }, []);

  const dropSession = useCallback(
    (message?: string) => {
      persistSid(null);
      setView(null);
      setDeepLink(null);
      setWaitingTelegram(false);
      if (message) setFormError(message);
    },
    [persistSid],
  );

  // ── بازیابی: ?resume=… (دکمه‌ی بات) یا sessionStorage ──────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
      const params = new URLSearchParams(window.location.search);
      const resume = params.get("resume");
      if (resume) {
        // توکن فوراً از URL و تاریخچه پاک می‌شود.
        window.history.replaceState(null, "", window.location.pathname);
        try {
          const v = await api<SignupView>("/resume", "POST", { token: resume });
          if (cancelled) return;
          persistSid(v.registrationId);
          applyView(v);
          toast({ title: c.welcomeBack });
        } catch (err: any) {
          if (!cancelled) setFormError(errText(err, c.sessionExpired));
        }
        return;
      }
      if (sid) {
        try {
          const v = await api<SignupView>(`/${encodeURIComponent(sid)}`, "GET");
          if (!cancelled) applyView(v);
        } catch {
          if (!cancelled) dropSession();
        }
      }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
    // فقط یک‌بار موقع mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── poll تأیید تلگرام ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sid || !view || view.telegram.verified) return;
    if (!waitingTelegram) return;
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      if (!mounted.current) return;
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        setWaitingTelegram(false);
        return;
      }
      try {
        const v = await api<SignupView>(`/${encodeURIComponent(sid)}`, "GET");
        if (!mounted.current) return;
        applyView(v);
        if (v.telegram.verified) setWaitingTelegram(false);
      } catch (err: any) {
        if (err?.data?.code === "signup_expired") dropSession(c.sessionExpired);
      }
    }, TELEGRAM_POLL_MS);
    return () => window.clearInterval(timer);
  }, [sid, view, waitingTelegram, applyView, dropSession, c.sessionExpired]);

  // ── ذخیره‌ی خودکار پیش‌نویس ──────────────────────────────────────────────
  useEffect(() => {
    if (!sid || !ready) return;
    const handle = window.setTimeout(() => {
      api<SignupView>(`/${encodeURIComponent(sid)}`, "PATCH", {
        firstName,
        lastName,
        gender,
        platformUsername: username,
        email,
      })
        .then((v) => mounted.current && applyView(v))
        .catch((err: any) => {
          if (err?.data?.code === "signup_expired") dropSession(c.sessionExpired);
        });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [sid, ready, firstName, lastName, gender, username, email, applyView, dropSession, c.sessionExpired]);

  // ── بررسی آزاد بودن یوزرنیم ─────────────────────────────────────────────
  useEffect(() => {
    const u = username.trim().toLowerCase();
    if (!u) return setUsernameState("idle");
    if (!USERNAME_RE.test(u)) return setUsernameState("invalid");
    setUsernameState("checking");
    const handle = window.setTimeout(async () => {
      try {
        const r = await customFetch<{ valid: boolean; available: boolean }>(
          `/api/auth/signup/username-available?u=${encodeURIComponent(u)}`,
        );
        if (mounted.current) setUsernameState(r.available ? "free" : "taken");
      } catch {
        if (mounted.current) setUsernameState("idle");
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [username]);

  // ── شمارنده‌های ارسال دوباره ─────────────────────────────────────────────
  useEffect(() => {
    if (phoneCooldown <= 0) return;
    const h = window.setTimeout(() => setPhoneCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(h);
  }, [phoneCooldown]);
  useEffect(() => {
    if (emailCooldown <= 0) return;
    const h = window.setTimeout(() => setEmailCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(h);
  }, [emailCooldown]);

  // ── مشتقات ──────────────────────────────────────────────────────────────
  const telegramOk = Boolean(view?.telegram.verified);
  const phoneOk = Boolean(view?.phone.verified) && !editingPhone;
  const emailNorm = email.trim().toLowerCase();
  const emailOk =
    Boolean(view?.email.verified) && emailNorm !== "" && emailNorm === (view?.draft.email ?? "").trim().toLowerCase();
  const emailValid = EMAIL_RE.test(email.trim());
  const phoneCodeSent = Boolean(view?.phone.codeSent) && !phoneOk;
  const emailCodeSent = Boolean(view?.email.codeSent) && !emailOk;

  // اگر ایمیل دیگر تأییدشده نیست، ورود دومرحله‌ای هم نباید تیک‌خورده بماند.
  useEffect(() => {
    if (!emailOk && enableEmail2fa) setEnableEmail2fa(false);
  }, [emailOk, enableEmail2fa]);

  // ── اقدام‌ها ────────────────────────────────────────────────────────────
  async function ensureSession(): Promise<string | null> {
    if (captchaConfig.enabled && !captchaToken && !sid) {
      setFormError(c.errors.captcha_failed);
      return null;
    }
    const v = await api<SignupView & { deepLink: string }>("/start", "POST", {
      registrationId: sid ?? undefined,
      locale: lang,
      captchaToken,
    });
    persistSid(v.registrationId);
    applyView(v);
    setDeepLink(v.deepLink);
    // توکن Turnstile یک‌بارمصرف است.
    setCaptchaToken(null);
    turnstileRef.current?.reset();
    return v.registrationId;
  }

  async function connectTelegram() {
    setFormError(null);
    setBusy("telegram");
    try {
      const id = await ensureSession();
      if (!id) return;
      // لینک تازه برای هر کلیک (لینک‌ها یک‌بارمصرف‌اند).
      const { deepLink: link } = await api<{ deepLink: string }>(`/${encodeURIComponent(id)}/telegram-link`, "POST");
      setDeepLink(link);
      window.open(link, "_blank", "noopener");
      setWaitingTelegram(true);
    } catch (err: any) {
      setFormError(errText(err));
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setBusy(null);
    }
  }

  async function sendPhoneCode() {
    if (!sid) return;
    setFormError(null);
    setPhoneCodeError(undefined);
    setBusy("phoneSend");
    try {
      await api(`/${encodeURIComponent(sid)}/phone/send`, "POST", { phone: foldDigits(phoneInput).trim() });
      const v = await api<SignupView>(`/${encodeURIComponent(sid)}`, "GET");
      applyView(v);
      setEditingPhone(false);
      setPhoneCode("");
      setPhoneCooldown(RESEND_COOLDOWN_S);
    } catch (err: any) {
      setFieldErrors((e) => ({ ...e, phone: errText(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function verifyPhone(code: string) {
    if (!sid || busy) return;
    setBusy("phoneVerify");
    setPhoneCodeError(undefined);
    try {
      const v = await api<SignupView>(`/${encodeURIComponent(sid)}/phone/verify`, "POST", { code });
      applyView(v);
      setFieldErrors((e) => ({ ...e, phone: "" }));
      setPhoneCode("");
    } catch (err: any) {
      setPhoneCodeError(errText(err));
      setPhoneCode("");
    } finally {
      setBusy(null);
    }
  }

  async function sendEmailCode() {
    if (!emailValid) {
      setFieldErrors((e) => ({ ...e, email: c.errors.invalid_email }));
      return;
    }
    setFormError(null);
    setEmailCodeError(undefined);
    setBusy("emailSend");
    try {
      if (!sid) return;
      await api(`/${encodeURIComponent(sid)}/email/send`, "POST", { email: email.trim() });
      const v = await api<SignupView>(`/${encodeURIComponent(sid)}`, "GET");
      applyView(v);
      setEmailCode("");
      setEmailCooldown(RESEND_COOLDOWN_S);
      setFieldErrors((e) => ({ ...e, email: "" }));
    } catch (err: any) {
      setFieldErrors((e) => ({ ...e, email: errText(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function verifyEmail(code: string) {
    if (!sid || busy) return;
    setBusy("emailVerify");
    setEmailCodeError(undefined);
    try {
      const v = await api<SignupView>(`/${encodeURIComponent(sid)}/email/verify`, "POST", { code });
      applyView(v);
      setEmailCode("");
    } catch (err: any) {
      setEmailCodeError(errText(err));
      setEmailCode("");
    } finally {
      setBusy(null);
    }
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = c.errors.firstName_required;
    if (!lastName.trim()) e.lastName = c.errors.lastName_required;
    if (!gender) e.gender = c.errors.invalid_gender;
    if (!USERNAME_RE.test(username.trim().toLowerCase())) e.platformUsername = c.errors.invalid_username;
    else if (usernameState === "taken") e.platformUsername = c.errors.username_taken;
    if (!email.trim()) e.email = c.errors.email_required;
    else if (!emailValid) e.email = c.errors.invalid_email;
    if (!telegramOk) e.telegram = c.errors.telegram_not_verified;
    if (!phoneOk) e.phone = c.errors.phone_not_verified;
    if (password.length < PASSWORD_MIN) e.password = c.errors.invalid_password;
    else if (password !== password2) e.passwordConfirm = c.errors.password_mismatch;
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setFieldErrors(e);
    if (Object.keys(e).length > 0 || !sid) {
      setFormError(c.fixErrors);
      return;
    }
    setBusy("submit");
    try {
      const res = await api<{ token: string; user: any }>(`/${encodeURIComponent(sid)}/complete`, "POST", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender,
        platformUsername: username.trim().toLowerCase(),
        email: email.trim(),
        password,
        passwordConfirm: password2,
        enableEmail2fa: enableEmail2fa && emailOk,
      });
      persistSid(null);
      setAuthToken(res.token);
      queryClient.setQueryData(getGetMeQueryKey(), res.user);
      navigate(consumePostAuthTarget());
    } catch (err: any) {
      if (err?.data?.code === "signup_expired") {
        dropSession(c.sessionExpired);
      } else {
        const field = err?.data?.field as string | undefined;
        const message = errText(err);
        if (field) setFieldErrors({ [field]: message });
        setFormError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  const fe = (name: string) =>
    fieldErrors[name] ? <p className="text-xs text-red-500" role="alert">{fieldErrors[name]}</p> : null;

  const usernameNote = useMemo(() => {
    switch (usernameState) {
      case "checking": return <span className="text-muted-foreground">…</span>;
      case "free": return <span className="text-emerald-600">{c.usernameFree}</span>;
      case "taken": return <span className="text-red-500">{c.usernameTaken}</span>;
      default: return <span className="text-muted-foreground">{c.usernameHint}</span>;
    }
  }, [usernameState, c]);

  return (
    <>
      <AuthShell className="max-w-xl">
        <div className="flex flex-col items-center">
          <h2 className="text-center text-2xl font-bold tracking-tight">{c.title}</h2>
          <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">{c.subtitle}</p>
        </div>

        <div className="mt-2 w-full">
          <form
            onSubmit={submit}
            noValidate
            className="space-y-4 rounded-3xl border border-border/70 bg-card px-4 py-6 shadow-[var(--shadow-pop)] sm:px-7"
          >
            {/* ثبت‌نام یک‌کلیکی با گوگل/گیت‌هاب — همان endpoint ورود */}
            <div className="grid grid-cols-2 gap-2.5">
              {([
                ["google", GoogleIcon, t.googleLoginButton],
                ["github", GitHubIcon, t.githubLoginButton],
              ] as const).map(([provider, Icon, label]) => (
                <button
                  key={provider}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    window.location.href = `${import.meta.env.VITE_API_URL ?? ""}/api/auth/${provider}`;
                  }}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border px-2 py-2.5 text-xs font-medium transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t.orDivider}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {formError && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600" role="alert">
                {formError}
              </p>
            )}

            {/* ── ۱. مشخصات ─────────────────────────────────────────────── */}
            <Section icon={<User className="size-4" />} title={c.s1}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="su-first">{c.firstName}</Label>
                  <Input id="su-first" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy === "submit"} className="bg-background" />
                  {fe("firstName")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-last">{c.lastName}</Label>
                  <Input id="su-last" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy === "submit"} className="bg-background" />
                  {fe("lastName")}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{c.gender}</Label>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={c.gender}>
                  {(["male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={gender === g}
                      onClick={() => setGender(g)}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${gender === g ? "border-primary bg-primary/10 font-semibold" : "border-border hover:border-primary/50"}`}
                    >
                      {g === "male" ? c.male : c.female}
                    </button>
                  ))}
                </div>
                {fe("gender")}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="su-user">{c.username}</Label>
                <div className="relative">
                  <AtSign className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="su-user" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    className="bg-background ps-9"
                  />
                </div>
                <p className="text-[11px]">{usernameNote}</p>
                {fe("platformUsername")}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="su-email">{c.email}</Label>
                <Input
                  id="su-email" type="email" dir="ltr" autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="bg-background"
                />
                <p className="text-[11px] text-muted-foreground">{c.emailHint}</p>
                {fe("email")}
              </div>
            </Section>

            {/* ── ۲. تلگرام ─────────────────────────────────────────────── */}
            <Section icon={<Send className="size-4" />} title={c.s2} badge={telegramOk ? c.verified : c.required} done={telegramOk}>
              {telegramOk ? (
                <p className="text-sm">
                  {c.telegramOk}
                  {view?.telegram.username && <span className="ms-2 font-mono text-muted-foreground" dir="ltr">@{view.telegram.username}</span>}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{c.s2Desc}</p>
                  {captchaConfig.enabled && !sid && (
                    <div className="flex justify-center">
                      <TurnstileWidget
                        ref={turnstileRef}
                        siteKey={captchaConfig.siteKey}
                        onVerify={setCaptchaToken}
                        onExpire={() => setCaptchaToken(null)}
                      />
                    </div>
                  )}
                  <Button
                    type="button"
                    className="w-full"
                    onClick={connectTelegram}
                    disabled={busy !== null || (captchaConfig.enabled && !sid && !captchaToken)}
                  >
                    {busy === "telegram" ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
                    {c.connectTelegram}
                  </Button>
                  {waitingTelegram && (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                      <span className="flex-1">{c.waitingTelegram}</span>
                      {deepLink && (
                        <a href={deepLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {c.openTelegramAgain} <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}
              {fe("telegram")}
            </Section>

            {/* ── ۳. شماره ──────────────────────────────────────────────── */}
            <Section icon={<Smartphone className="size-4" />} title={c.s3} badge={phoneOk ? c.verified : c.required} done={phoneOk}>
              {!telegramOk ? (
                <p className="text-sm text-muted-foreground">{c.s3Locked}</p>
              ) : phoneOk ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span dir="ltr" className="font-mono">{maskPhone(view?.phone.value ?? phoneInput)}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingPhone(true); setPhoneCode(""); }}>
                    {c.changePhone}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-phone">{c.phone}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="su-phone" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="0912xxxxxxx"
                        value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}
                        className="bg-background"
                      />
                      <Button
                        type="button"
                        onClick={sendPhoneCode}
                        disabled={busy !== null || phoneInput.trim().length < 8 || (phoneCodeSent && phoneCooldown > 0)}
                      >
                        {busy === "phoneSend" && <Loader2 className="me-2 size-4 animate-spin" />}
                        {phoneCodeSent ? c.resend : c.sendCode}
                      </Button>
                    </div>
                    {phoneCodeSent && phoneCooldown > 0 && (
                      <p className="text-[11px] text-muted-foreground">{c.resendIn.replace("{s}", String(phoneCooldown))}</p>
                    )}
                    {fe("phone")}
                  </div>
                  {phoneCodeSent && (
                    <div className="space-y-2">
                      <p className="text-center text-xs text-muted-foreground" dir="ltr">
                        {c.codeSentTo.replace("{p}", maskPhone(view?.phone.value ?? phoneInput))}
                      </p>
                      <CodeInput
                        value={phoneCode}
                        onChange={setPhoneCode}
                        onComplete={(code) => void verifyPhone(code)}
                        disabled={busy !== null}
                        invalid={Boolean(phoneCodeError)}
                        errorMessage={phoneCodeError}
                        webOtp
                      />
                    </div>
                  )}
                </>
              )}
            </Section>

            {/* ── ۴. ایمیل (اختیاری) ────────────────────────────────────── */}
            <Section icon={<Mail className="size-4" />} title={c.s4} badge={emailOk ? c.verified : c.optional} done={emailOk}>
              {emailOk ? (
                <p className="text-sm" dir="ltr">{email.trim()}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-muted-foreground" dir="ltr">{email.trim() || "—"}</span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={sendEmailCode}
                      disabled={busy !== null || !telegramOk || !emailValid || (emailCodeSent && emailCooldown > 0)}
                    >
                      {busy === "emailSend" && <Loader2 className="me-2 size-4 animate-spin" />}
                      {c.verifyEmail}
                    </Button>
                  </div>
                  {!telegramOk && <p className="text-[11px] text-muted-foreground">{c.s3Locked}</p>}
                  {emailCodeSent && (
                    <div className="space-y-2">
                      <p className="text-center text-xs text-muted-foreground">{c.emailCodeSent}</p>
                      <CodeInput
                        value={emailCode}
                        onChange={setEmailCode}
                        onComplete={(code) => void verifyEmail(code)}
                        disabled={busy !== null}
                        invalid={Boolean(emailCodeError)}
                        errorMessage={emailCodeError}
                      />
                      {emailCooldown > 0 && (
                        <p className="text-center text-[11px] text-muted-foreground">{c.resendIn.replace("{s}", String(emailCooldown))}</p>
                      )}
                    </div>
                  )}
                </>
              )}
              <label className={`flex items-start gap-2 text-sm ${emailOk ? "" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={enableEmail2fa}
                  disabled={!emailOk}
                  onChange={(e) => setEnableEmail2fa(e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1 font-medium"><ShieldCheck className="size-4 text-primary" aria-hidden="true" /> {c.twoFactor}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.twoFactorHint}</span>
                </span>
              </label>
            </Section>

            {/* ── ۵. رمز عبور ───────────────────────────────────────────── */}
            <Section icon={<ShieldCheck className="size-4" />} title={c.s5}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass">{c.password}</Label>
                  <PasswordInput id="su-pass" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-background" />
                  <p className="text-[11px] text-muted-foreground">{c.passwordHint}</p>
                  {fe("password")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-pass2">{c.passwordConfirm}</Label>
                  <PasswordInput id="su-pass2" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} className="bg-background" />
                  {fe("passwordConfirm")}
                </div>
              </div>
            </Section>

            <GlowButton type="submit" className="w-full" disabled={busy !== null}>
              {busy === "submit" && <Loader2 className="me-2 size-4 animate-spin" />}
              {c.submit}
            </GlowButton>

            <p className="text-center text-sm text-muted-foreground">
              {c.haveAccount}{" "}
              <Link href="/login" className="text-primary hover:underline">{c.signIn}</Link>
            </p>
          </form>
        </div>
      </AuthShell>
      <EnamadSeal className="bg-background pb-4" />
    </>
  );
}
