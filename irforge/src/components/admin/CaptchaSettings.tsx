/**
 * CaptchaSettings.tsx — IRFORGE_PROMPT_V3 Phase 42.
 * ─────────────────────────────────────────────────────────────────────────────
 * Toggles the Cloudflare Turnstile gate on registration and free-trial-bot
 * creation, and sets the (public) site key. There is deliberately no field
 * here for the secret key — api-server/src/lib/platformSettings.ts's captcha
 * section explains why: everything in that settings table is assumed safe to
 * ship to the client, and a Turnstile secret is a real server-side
 * credential, so it lives only in the `TURNSTILE_SECRET_KEY` environment
 * variable, the same way this app's other real secrets (JWT signing key, DB
 * credentials) do.
 */
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { CAPTCHA_CONFIG_QUERY_KEY, type CaptchaConfig } from "@/config/captcha";

export const ADMIN_CAPTCHA_KEY = ["admin-captcha"] as const;

export function CaptchaSettings() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ADMIN_CAPTCHA_KEY,
    queryFn: () => customFetch<CaptchaConfig>("/api/admin/captcha"),
  });

  const [draft, setDraft] = useState<CaptchaConfig | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  if (!draft) {
    return <div className="h-40 animate-pulse rounded-md bg-muted" />;
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await customFetch<CaptchaConfig>("/api/admin/captcha", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDraft(saved);
      queryClient.invalidateQueries({ queryKey: ADMIN_CAPTCHA_KEY });
      // بازدیدکننده‌های فعلیِ صفحه‌ی ثبت‌نام/تریال — بدون رفرش، ویجت تازه ظاهر/ناپدید شود.
      queryClient.invalidateQueries({ queryKey: CAPTCHA_CONFIG_QUERY_KEY });
      toast({ title: fa ? "تنظیمات کپچا ذخیره شد" : "Captcha settings saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const missingKeyWhileOn = draft.enabled && !draft.siteKey.trim();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-muted-foreground" />
          {fa ? "بررسیِ امنیتی (کپچا)" : "Security check (captcha)"}
        </CardTitle>
        <CardDescription>
          {fa
            ? "یک چالشِ Cloudflare Turnstile روی ثبت‌نام و شروعِ تریالِ رایگان — دو کاری که یک اسکریپت می‌تواند رایگان و پشتِ سرِ هم تکرار کند. کلیدِ مخفیِ Turnstile را اینجا وارد نکنید؛ آن باید متغیر محیطیِ TURNSTILE_SECRET_KEY روی سرور باشد."
            : "A Cloudflare Turnstile challenge on registration and starting a free trial — the two actions a script can repeat for free. Do not enter the Turnstile secret key here; it must be the TURNSTILE_SECRET_KEY environment variable on the server."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>{fa ? "فعال" : "Enabled"}</span>
          <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft((d) => (d ? { ...d, enabled: v } : d))} />
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="captcha-site-key">{fa ? "Site Key (عمومی)" : "Site key (public)"}</Label>
          <Input
            id="captcha-site-key" dir="ltr" placeholder="0x4AAAAAAA..."
            value={draft.siteKey}
            onChange={(e) => setDraft((d) => (d ? { ...d, siteKey: e.target.value } : d))}
          />
          <p className="text-xs text-muted-foreground">
            {fa
              ? "از پنل Cloudflare Turnstile می‌گیرید — عمومی است و همراهِ ویجت در مرورگر بارگذاری می‌شود."
              : "From your Cloudflare Turnstile dashboard — this one is public and ships with the widget in the browser."}
          </p>
        </div>

        {missingKeyWhileOn && (
          <p className="text-xs text-amber-500">
            {fa
              ? "فعال است ولی Site Key خالی است — تا زمانی که پر نشود، گیت واقعاً روشن نمی‌شود."
              : "Enabled, but the site key is empty — the gate won't actually turn on until it's set."}
          </p>
        )}

        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {fa ? "ذخیره" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
