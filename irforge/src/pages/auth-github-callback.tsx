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
 * `/auth/github/callback#token=…` — مقصدِ ریدایرکتِ سرور بعد از
 * `GET /api/auth/github/callback`.
 *
 * دقیقاً همان صفحه‌ی `auth-google-callback.tsx`، فقط مقصدِ متفاوت: توکن در
 * URL fragment است (نه query)، همان‌جا بلافاصله پاک می‌شود، و بعد یک
 * GET /auth/me کش react-query را پر می‌کند تا این مسیر هم مثل بقیه‌ی
 * روش‌های ورود رفتار کند.
 */
export default function AuthGithubCallback() {
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
            <p className="text-sm text-muted-foreground">{t.githubLoginFailed}</p>
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
