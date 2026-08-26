import { useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { BrandLogo } from "@/components/layout/brand-home";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { ArrowLeft, Loader2, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

export default function ResetPassword() {
  useSEO({ title: "تنظیم رمز عبور جدید | IrForge", noindex: true });
  const t = useT("auth");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, code, newPassword }),
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
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 bg-background">
      <PublicPageControls className="fixed end-4 top-4 z-10" />
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <BrandLogo className="mb-8 hover:opacity-80 transition-opacity" />
        <h2 className="text-center text-2xl font-bold tracking-tight">
          {t.setNewPasswordTitle}
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground max-w-sm">
          {t.setNewPasswordDesc}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[400px]">
        <div className="bg-card px-4 py-8 shadow-xl sm:rounded-xl border sm:px-10">
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="rp-email">{t.emailAddress}</Label>
              <Input id="rp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} className="bg-background" />
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
    </div>
  );
}
