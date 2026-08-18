import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetMeQueryKey } from "@workspace/api-client-react";
import { GlowButton } from "@/components/ui/glow-button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useSEO } from "@/hooks/use-seo";
import { useT } from "@/hooks/use-translation";
import { BrandLogo } from "@/components/layout/brand-home";

/**
 * `/auth/telegram?ticket=…` — مقصد دکمه‌ی «داشبورد» داخل پیام بات.
 *
 * چرا این صفحه لازم است: کسی که بات را روی گوشی باز کرده، معمولاً در مرورگرِ
 * همان گوشی لاگین نیست. یک دکمه که مستقیم به `/dashboard` برود او را فقط به
 * صفحه‌ی ورود می‌اندازد — یعنی همان چیزی که این فیچر قرار بود حذفش کند. پس
 * دکمه به اینجا می‌آید، تیکت یک‌بارمصرف با یک نشست عوض می‌شود، و بعد داشبورد.
 *
 * تیکت **بلافاصله** از URL پاک می‌شود: یک لینک ورود در تاریخچه‌ی مرورگر و در
 * هدر `Referer` صفحه‌ی بعدی، همان‌قدر بد است که در لاگ سرور.
 */
export default function AuthTelegram() {
  const t = useT("auth") as Record<string, string>;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useSEO({ title: t.signIn ?? "Sign in | IrForge", noindex: true });

  const [failed, setFailed] = useState(false);
  // در StrictMode افکت دوبار اجرا می‌شود و تیکت یک‌بارمصرف است: بار دوم
  // «منقضی» می‌گرفت و کاربرِ درست پیام خطا می‌دید.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const ticket = params.get("ticket");

    // پاک‌کردن قبل از هر درخواستی، تا حتی اگر شبکه کند بود لینک در تاریخچه نماند.
    window.history.replaceState(null, "", window.location.pathname);

    if (!ticket) {
      setFailed(true);
      return;
    }

    customFetch<{ user: any; token: string }>("/api/auth/telegram/login/ticket", {
      method: "POST",
      body: JSON.stringify({ ticket }),
    })
      .then((res) => {
        // همان کلیدی که main.tsx برای هدر Authorization می‌خواند.
        localStorage.setItem("irforge_token", res.token);
        queryClient.setQueryData(getGetMeQueryKey(), res.user);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => setFailed(true));
    // فقط یک‌بار، موقع mount — تیکت در URL است و عوض نمی‌شود.
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
            <p className="text-sm text-muted-foreground">{t.tgTicketExpired}</p>
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
