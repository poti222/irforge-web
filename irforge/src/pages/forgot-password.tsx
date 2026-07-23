import { useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrangeRobot } from "@/components/layout/brand-home";
import { ArrowLeft, Loader2, MailCheck, Send } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

export default function ForgotPassword() {
  useSEO({ title: "بازیابی رمز عبور | IrForge", noindex: true });
  const t = useT("auth");
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email }),
      });
      setSent(true);
      setError(res.message ?? null);
    } catch (err: any) {
      // Backend returns a clear message for the "no linked Telegram" case.
      setError(err?.data?.error || err?.message || t.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 bg-background">
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <Link href="/" className="flex items-center gap-2 mb-8 hover:opacity-80 transition-opacity">
          <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <OrangeRobot className="size-6" />
          </div>
          <span className="font-bold text-2xl tracking-tight">IrForge</span>
        </Link>
        <h2 className="text-center text-2xl font-bold tracking-tight">
          {t.resetPasswordTitle}
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground max-w-sm">
          {t.resetPasswordDesc}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[400px]">
        <div className="bg-card px-4 py-8 shadow-xl sm:rounded-xl border sm:px-10">
          {sent ? (
            <div className="space-y-4 text-center">
              <MailCheck className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button asChild className="w-full">
                <Link href="/reset-password">{t.haveResetCode}</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="fp-email">{t.emailAddress}</Label>
                <Input
                  id="fp-email" type="email" required
                  placeholder="developer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
    </div>
  );
}
