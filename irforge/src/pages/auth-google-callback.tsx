import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetMeQueryKey } from "@workspace/api-client-react";
import { GlowButton } from "@/components/ui/glow-button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { BrandLogo } from "@/components/layout/brand-home";
import { setAuthToken } from "@/lib/auth-token";

/**
 * `/auth/google/callback#token=…` — مقصدِ ریدایرکتِ سرور بعد از
 * `GET /api/auth/google/callback`.
 *
 * توکن در URL **fragment** است نه query: مثل تیکتِ `auth-telegram.tsx`،
 * fragment هرگز به سرور (نه این‌جا، نه صفحه‌ی بعدی از طریق Referer) نمی‌رود
 * و در لاگ دسترسی هم ثبت نمی‌شود. از URL هم بلافاصله پاک می‌شود، همان دلیل.
 *
 * خودِ سرور نشست را از قبل ساخته (issueSession در auth.ts) — این‌جا فقط
 * توکن را برمی‌دارد و با یک GET /auth/me کاربر را می‌گیرد تا کش
 * react-query هم مثل بقیه‌ی مسیرهای ورود پر شود.
 */
export default function AuthGoogleCallback() {
  const t = useT("auth") as Record<string, string>;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useSEO({ title: t.signIn ?? "Sign in | IrForge", noindex: true });

  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const token = new URLSearchParams(hash).get("token");

    // پاک‌کردن قبل از هر درخواستی، تا حتی اگر شبکه کند بود توکن در
    // تاریخچه‌ی مرورگر نماند.
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      setFailed(true);
      return;
    }

    setAuthToken(token);
    customFetch<any>("/api/auth/me")
      .then((user) => {
        queryClient.setQueryData(getGetMeQueryKey(), user);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => setFailed(true));
    // فقط یک‌بار، موقع mount — توکن در fragment است و عوض نمی‌شود.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <BrandLogo href="/" />
        </div>

        {failed ? (
          <div className="space-y-4">
            <XCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t.googleLoginFailed}</p>
            <GlowButton className="w-full" onClick={() => navigate("/login")}>
              {t.backToLogin}
            </GlowButton>
          </div>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <CheckCircle2 className="mx-auto size-10 text-emerald-500" aria-hidden="true" />
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t.tgSigningIn}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
