import { useState } from "react";
import { EnamadSeal } from "@/components/layout/enamad-seal";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { AuthShell } from "@/components/auth/AuthShell";
import { ArrowLeft, Loader2, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

export default function ResetPassword() {
  useSEO({ title: "تنظیم رمز عبور جدید | IrForge", noindex: true });
  const t = useT("auth");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await customFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), code, newPassword }),
      });
      toast({
        title: t.passwordResetToastTitle,
        description: t.passwordResetToastDesc,
      });
      setLocation("/login");
    } catch (err: any) {
      setError(err?.data?.error || err?.message || t.resetCodeInvalidError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthShell>
        <div className="flex flex-col items-center">
          <h2 className="text-center text-2xl font-bold tracking-tight">
            {t.setNewPasswordTitle}
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground max-w-sm">
            {t.setNewPasswordDesc}
          </p>
        </div>

        <div className="mt-2 w-full">
          <div className="rounded-3xl border border-border/70 bg-card px-5 py-8 shadow-[var(--shadow-pop)] sm:px-9">
            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="rp-phone">{t.loginPhone}</Label>
                <Input
                  id="rp-phone" required
                  dir="ltr" inputMode="tel" autoComplete="tel"
                  placeholder="0912xxxxxxx"
                  value={phone} onChange={(e) => setPhone(e.target.value)} disabled={loading} className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-code">{t.resetCodeLabel}</Label>
                <Input id="rp-code" required dir="ltr" placeholder="A1B2C3D4" value={code} onChange={(e) => setCode(e.target.value)} disabled={loading} className="bg-background font-mono tracking-widest" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-pass">{t.newPasswordLabel}</Label>
                <PasswordInput id="rp-pass" required placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={loading} className="bg-background" />
                <p className="text-[11px] text-muted-foreground">{t.passwordMinHint}</p>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <KeyRound className="me-2 h-4 w-4" />}
                {t.resetPasswordButton}
              </Button>
            </form>

            <div className="mt-6 text-sm">
              <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                <ArrowLeft className="size-4 rtl-flip" /> {t.backToLogin}
              </Link>
            </div>
          </div>
        </div>
      </AuthShell>
      <EnamadSeal className="bg-background pb-4" />
    </>
  );
}
