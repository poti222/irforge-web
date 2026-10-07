import { useState } from "react";
import { EnamadSeal } from "@/components/layout/enamad-seal";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { ArrowLeft, CheckCircle2, Loader2, Send } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

export default function ForgotPassword() {
  useSEO({ title: "بازیابی رمز عبور | IrForge", noindex: true });
  const t = useT("auth");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await customFetch<{ message: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setSent(true);
      setError(res.message ?? null);
    } catch (err: any) {
      setError(err?.data?.error || err?.message || t.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthShell>
        <div className="flex flex-col items-center">
          <h2 className="text-center text-2xl font-bold tracking-tight">
            {t.resetPasswordTitle}
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground max-w-sm">
            {t.resetPasswordDesc}
          </p>
        </div>

        <div className="mt-2 w-full">
          <div className="rounded-3xl border border-border/70 bg-card px-5 py-8 shadow-[var(--shadow-pop)] sm:px-9">
            {sent ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button asChild className="w-full">
                  <Link href="/reset-password">{t.haveResetCode}</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="fp-phone">{t.loginPhone}</Label>
                  <Input
                    id="fp-phone" required
                    dir="ltr" inputMode="tel" autoComplete="tel"
                    placeholder="0912xxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loading}
                    className="bg-background"
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Send className="me-2 h-4 w-4" />}
                  {t.sendResetCode}
                </Button>
              </form>
            )}

            <div className="mt-6 flex items-center justify-between text-sm">
              <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                <ArrowLeft className="size-4 rtl-flip" /> {t.backToLogin}
              </Link>
              <Link href="/reset-password" className="text-primary hover:underline">
                {t.enterCode}
              </Link>
            </div>
          </div>
        </div>
      </AuthShell>
      <EnamadSeal className="bg-background pb-4" />
    </>
  );
}
