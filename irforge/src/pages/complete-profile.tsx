import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Loader2, User as UserIcon, MessageSquareText, RefreshCw, ShieldCheck, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { BrandLogo } from "@/components/layout/brand-home";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { AuthStepHeader } from "@/components/auth/AuthStepHeader";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";
import { CodeInput } from "@/components/auth/CodeInput";
import { cn } from "@/lib/utils";

/**
 * ویزارد اجباریِ تکمیل هویت — Mandatory Profile Completion & Identity System.
 *
 * سه گام: هویت پایه (نام/جنسیت/ایمیل/شماره/یوزرنیم/رمز) → تلگرام (اجباری،
 * بدون رد کردن) → امنیت (اختیاری). AuthOnlyRoute در App.tsx این صفحه را از
 * ProtectedRoute استثنا کرده — وگرنه کاربرِ ناقص به همین صفحه ریدایرکت
 * می‌شد. `user.missingProfileFields`/`onlyUsernameMissing` مستقیم از پاسخ
 * سرور (toAuthUser → checkProfile) می‌آید؛ این صفحه فقط همان را می‌خواند،
 * قانونِ کامل‌بودن را دوباره پیاده نمی‌کند.
 *
 * شماره‌ی موبایل (وقتی از قبل نیست — حساب‌های ایمیلی/OAuth) یک متنِ ساده
 * نیست: سرور (PATCH /auth/complete-profile) یک اثباتِ واقعیِ پیامکیِ تازه
 * می‌خواهد (همان recentSmsRegisterProof که routes/registration.ts برای
 * ثبت‌نامِ پیامکی هم دارد)، وگرنه هرکسی می‌توانست شماره‌ی دیگری را تایپ کند
 * و phoneVerified=true بگیرد. پس این‌جا هم قبل از شامل‌کردنِ شماره در PATCH
 * اصلی، همان POST /auth/otp/sms/send + POST /auth/otp/sms/verify زده
 * می‌شود.
 */

type Step = "identity" | "telegram" | "security";
const TOTAL_STEPS = 3;

const IDENTITY_MISSING_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "phoneVerified",
  "gender",
  "platformUsername",
  "password",
];

const FIELD_ERROR_KEY: Record<string, string> = {
  invalid_name: "cpErrInvalidName",
  fake_name: "cpErrFakeName",
  invalid_gender: "cpErrInvalidGender",
  invalid_email: "cpErrInvalidEmail",
  email_taken: "cpErrEmailTaken",
  invalid_phone: "cpErrInvalidPhone",
  phone_taken: "cpErrPhoneTaken",
  phone_not_verified: "cpErrPhoneNotVerified",
  invalid_username: "cpErrInvalidUsername",
  username_taken: "cpErrUsernameTaken",
  invalid_password: "cpErrInvalidPassword",
};

export default function CompleteProfile() {
  const t = useT("auth") as Record<string, string>;
  const tCommon = useT("common") as Record<string, string>;
  const { user, refreshUser, logout } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  useSEO({ title: t.cpTitle ?? "Complete your profile | IrForge", noindex: true });

  const missing = useMemo(() => new Set(user?.missingProfileFields ?? []), [user?.missingProfileFields]);
  const identityDone = !IDENTITY_MISSING_FIELDS.some((f) => missing.has(f));
  const telegramDone = !missing.has("telegramId") && !missing.has("telegramUsername");
  const phoneMissing = missing.has("phone") || missing.has("phoneVerified");

  const [step, setStep] = useState<Step>(() => (identityDone ? (telegramDone ? "security" : "telegram") : "identity"));

  // اگر گام فعلی همین الان کامل شد (مثلاً بعد از refreshUser) و کاربر هنوز
  // روی همان گام است، به گام بعدی هل بده — کاربر دستی «ادامه» نمی‌زند چون
  // این گام دیگر فیلدی برای پر کردن ندارد.
  useEffect(() => {
    if (step === "identity" && identityDone) setStep(telegramDone ? "security" : "telegram");
    else if (step === "telegram" && telegramDone) setStep("security");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityDone, telegramDone]);

  const [name, setName] = useState(user?.name ?? "");
  const [gender, setGender] = useState<"male" | "female" | "">((user?.gender as "male" | "female") ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.platformUsername ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isOAuth = Boolean(user?.oauthProvider);

  function fail(err: any) {
    if (err?.data?.field && err?.data?.code) {
      setFieldErrors((prev) => ({ ...prev, [err.data.field]: FIELD_ERROR_KEY[err.data.code] ?? "cpErrGeneric" }));
      return;
    }
    toast({ variant: "destructive", title: t.genericAuthError, description: err?.data?.error || err?.message });
  }

  // ─── شماره‌ی موبایل: ارسال کد → تأیید → قابلِ استفاده در PATCH اصلی ───────
  const [phone, setPhone] = useState("");
  const [phoneStep, setPhoneStep] = useState<"idle" | "code_sent" | "verified">("idle");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeInvalid, setPhoneCodeInvalid] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneResendIn, setPhoneResendIn] = useState(0);

  useEffect(() => {
    if (phoneResendIn <= 0) return;
    const id = window.setInterval(() => setPhoneResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [phoneResendIn]);

  async function sendPhoneCode() {
    if (!phone.trim()) return;
    setPhoneBusy(true);
    setFieldErrors((prev) => ({ ...prev, phone: "" }));
    try {
      await customFetch("/api/auth/otp/sms/send", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), purpose: "register" }),
      });
      setPhoneStep("code_sent");
      setPhoneResendIn(60);
      setPhoneCode("");
      setPhoneCodeInvalid(false);
    } catch (err) {
      fail(err);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function verifyPhoneCode(entered: string) {
    if (entered.length !== 6) return;
    setPhoneBusy(true);
    setPhoneCodeInvalid(false);
    try {
      await customFetch("/api/auth/otp/sms/verify", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), code: entered, purpose: "register" }),
      });
      setPhoneStep("verified");
    } catch (err) {
      setPhoneCodeInvalid(true);
      setPhoneCode("");
      fail(err);
    } finally {
      setPhoneBusy(false);
    }
  }

  const nameWordCount = name.trim().split(/\s+/).filter(Boolean).length;
  const identitySubmittable = nameWordCount >= 2 && Boolean(gender) && (!phoneMissing || phoneStep === "verified");

  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (nameWordCount < 2) {
      setFieldErrors((prev) => ({ ...prev, name: "cpErrInvalidName" }));
      return;
    }
    if (!gender || !identitySubmittable) return;
    setBusy(true);
    setFieldErrors({});
    try {
      const body: Record<string, unknown> = { name: name.trim(), gender, email: email.trim() };
      if (phoneMissing && phoneStep === "verified") body.phone = phone.trim();
      if (missing.has("platformUsername") || username.trim() !== (user?.platformUsername ?? "")) {
        body.platformUsername = username.trim().toLowerCase();
      }
      if (!isOAuth && password) body.password = password;
      await customFetch("/api/auth/complete-profile", { method: "PATCH", body: JSON.stringify(body) });
      await refreshUser();
      setPassword("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const [checkingTelegram, setCheckingTelegram] = useState(false);

  // همان الگوی profile.tsx::handleBotConnect — poll تا وقتی وبهوک بات
  // telegramId را ست کند، بدون این‌که کاربر دستی «بررسی کن» بزند.
  useEffect(() => {
    if (step !== "telegram") return;
    let cancelled = false;
    const startedAt = Date.now();
    const POLL_INTERVAL_MS = 2500;
    const POLL_TIMEOUT_MS = 3 * 60 * 1000;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) return;
      const fresh = await customFetch<{ telegramId: string | null }>("/api/auth/me").catch(() => null);
      if (cancelled) return;
      if (fresh?.telegramId) {
        await refreshUser();
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };
    const id = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function recheckTelegram() {
    setCheckingTelegram(true);
    try {
      await refreshUser();
    } finally {
      setCheckingTelegram(false);
    }
  }

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean(user?.twoFactorEnabled));
  const [twoFactorMethod, setTwoFactorMethod] = useState<string>(user?.twoFactorMethod ?? "telegram");
  const [savingSecurity, setSavingSecurity] = useState(false);

  async function saveSecurityAndFinish(enable: boolean) {
    setSavingSecurity(true);
    try {
      await customFetch("/api/auth/complete-profile", {
        method: "PATCH",
        body: JSON.stringify({ twoFactorEnabled: enable, twoFactorMethod: enable ? twoFactorMethod : undefined }),
      });
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      fail(err);
    } finally {
      setSavingSecurity(false);
    }
  }

  const onlyUsernameMissing = !telegramDone && user?.onlyUsernameMissing === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <PublicPageControls className="fixed end-4 top-4 z-10" />
      <button
        type="button"
        onClick={() => void logout()}
        className="fixed start-4 top-4 z-10 text-xs text-muted-foreground hover:text-foreground"
      >
        {tCommon.logout}
      </button>

      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <BrandLogo href="/" />
        </div>

        <div className="bg-card px-4 py-8 shadow-xl sm:rounded-xl border sm:px-10">
          {step === "identity" && (
            <form className="space-y-4" onSubmit={submitIdentity}>
              <AuthStepHeader title={t.cpIdentityTitle} description={t.cpIdentityDesc} step={1} total={TOTAL_STEPS} />

              <div className="space-y-1.5">
                <Label htmlFor="cp-name">{t.cpFullName}</Label>
                <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} required />
                {fieldErrors.name && <p className="text-xs text-destructive">{t[fieldErrors.name]}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>{t.cpGender}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      className={cn(
                        "rounded-md border px-3.5 py-2.5 text-sm font-medium transition-colors",
                        gender === g
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      {g === "male" ? t.cpGenderMale : t.cpGenderFemale}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cp-email">{t.email}</Label>
                <Input
                  id="cp-email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                {fieldErrors.email && <p className="text-xs text-destructive">{t[fieldErrors.email]}</p>}
              </div>

              {phoneMissing && (
                <div className="space-y-1.5 rounded-md border p-3">
                  <Label htmlFor="cp-phone">{t.phoneLabel}</Label>
                  {phoneStep === "verified" ? (
                    <p className="flex items-center gap-2 text-sm text-emerald-600">
                      <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                      {phone.trim()}
                    </p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <Input
                          id="cp-phone"
                          dir="ltr"
                          inputMode="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          disabled={phoneStep === "code_sent"}
                        />
                        {phoneStep === "idle" && (
                          <Button type="button" variant="outline" disabled={phoneBusy || !phone.trim()} onClick={() => void sendPhoneCode()}>
                            {phoneBusy && <Loader2 className="me-2 size-4 animate-spin" />}
                            {t.cpSendCode}
                          </Button>
                        )}
                      </div>
                      {phoneStep === "code_sent" && (
                        <div className="space-y-2 pt-1">
                          <CodeInput
                            value={phoneCode}
                            onChange={setPhoneCode}
                            onComplete={(c) => void verifyPhoneCode(c)}
                            disabled={phoneBusy}
                            invalid={phoneCodeInvalid}
                            webOtp
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            disabled={phoneBusy || phoneResendIn > 0}
                            onClick={() => void sendPhoneCode()}
                          >
                            {phoneResendIn > 0 ? (t.resendIn ?? "").replace("{n}", String(phoneResendIn)) : t.resend}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  {fieldErrors.phone && <p className="text-xs text-destructive">{t[fieldErrors.phone]}</p>}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="cp-username">{t.cpUsername}</Label>
                <Input
                  id="cp-username"
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  required
                />
                <p className="text-xs text-muted-foreground">{t.cpUsernameHint}</p>
                {fieldErrors.platformUsername && (
                  <p className="text-xs text-destructive">{t[fieldErrors.platformUsername]}</p>
                )}
              </div>

              {!isOAuth && (
                <div className="space-y-1.5">
                  <Label htmlFor="cp-password">{t.password}</Label>
                  <PasswordInput
                    id="cp-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={missing.has("password")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {missing.has("password") ? t.passwordMin : t.cpPasswordOptionalHint}
                  </p>
                  {fieldErrors.password && <p className="text-xs text-destructive">{t[fieldErrors.password]}</p>}
                </div>
              )}
              {isOAuth && <p className="text-xs text-muted-foreground">{t.cpOauthPasswordNote}</p>}

              <GlowButton type="submit" className="w-full" disabled={busy || !identitySubmittable}>
                {busy && <Loader2 className="me-2 size-4 animate-spin" />}
                <UserIcon className="me-2 size-4" aria-hidden="true" />
                {t.continue}
              </GlowButton>
            </form>
          )}

          {step === "telegram" && (
            <div className="space-y-5">
              <AuthStepHeader
                title={onlyUsernameMissing ? t.cpUsernameMissingTitle : t.cpTelegramTitle}
                description={onlyUsernameMissing ? t.cpUsernameMissingDesc : t.cpTelegramDesc}
                step={2}
                total={TOTAL_STEPS}
              />

              {onlyUsernameMissing ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={checkingTelegram}
                  onClick={() => void recheckTelegram()}
                >
                  {checkingTelegram ? (
                    <Loader2 className="me-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="me-2 size-4" aria-hidden="true" />
                  )}
                  {t.cpRecheck}
                </Button>
              ) : (
                <TelegramLinkPanel mode="profile" waiting onRefresh={() => void recheckTelegram()} />
              )}
            </div>
          )}

          {step === "security" && (
            <div className="space-y-5">
              <AuthStepHeader title={t.cpSecurityTitle} description={t.cpSecurityDesc} step={3} total={TOTAL_STEPS} />

              <button
                type="button"
                onClick={() => setTwoFactorEnabled((v) => !v)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border p-3.5 text-start transition-colors",
                  twoFactorEnabled
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50",
                )}
              >
                <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="font-medium">{t.cpTwoFactorEnable}</span>
                  <span className="text-xs text-muted-foreground">{t.cpSecurityDesc}</span>
                </span>
              </button>

              {twoFactorEnabled && (
                <div className="grid grid-cols-3 gap-2">
                  {(["email", "sms", "telegram"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTwoFactorMethod(m)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                        twoFactorMethod === m
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      <MessageSquareText className="size-3.5" aria-hidden="true" />
                      {m === "email" ? t.cpTwoFactorEmail : m === "sms" ? t.cpTwoFactorSms : t.cpTwoFactorTelegram}
                    </button>
                  ))}
                </div>
              )}

              <GlowButton
                className="w-full"
                disabled={savingSecurity}
                onClick={() => void saveSecurityAndFinish(twoFactorEnabled)}
              >
                {savingSecurity && <Loader2 className="me-2 size-4 animate-spin" />}
                {t.cpFinish}
              </GlowButton>

              {!twoFactorEnabled && (
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={savingSecurity}
                  onClick={() => void saveSecurityAndFinish(false)}
                >
                  {t.cpSkip}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
