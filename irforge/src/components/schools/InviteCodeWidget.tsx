import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { lookupInviteCode, submitSchoolOnboarding } from "@/lib/schools-api";

/**
 * ویجتِ «پیدا کردن مدرسه با کد معرف» — طبقِ خواستِ صریحِ کاربر، این باید هم
 * داخل فرمِ اطلاعاتِ اولیه باشد (irforge/src/pages/schools/onboarding.tsx،
 * به‌صورتِ یک فیلد) و هم به‌عنوانِ یک ویجتِ *مستقل* کنارِ سایدبار، برای وقتی
 * کاربر بعداً (بعد از تکمیلِ پروفایل) می‌خواهد به مدرسه‌ی دیگری بپیوندد یا
 * مدرسه‌اش را عوض کند. این کامپوننت همان منطق را در یک کارتِ کوچک بسته‌بندی
 * می‌کند تا هر دو جا (SchoolShell و صفحه‌ی آنبوردینگ) از آن استفاده کنند.
 */
export function InviteCodeWidget({ compact = false }: { compact?: boolean }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("schools");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ name: string } | null>(null);

  async function handleFind() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setFound(null);
    try {
      const res = await lookupInviteCode(trimmed);
      setFound({ name: res.school.name });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: t.inviteCodeNotFound,
        description: err?.data?.error,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await submitSchoolOnboarding({ role: "student", inviteCode: trimmed } as any);
      await queryClient.invalidateQueries({ queryKey: ["schools", "me"] });
      toast({ title: t.joinedSchool });
      setCode("");
      setFound(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: t.inviteCodeNotFound, description: err?.data?.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={compact ? "border-dashed" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t.findSchoolWidgetTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t.inviteCodePlaceholder}
            className="h-8 text-xs"
            dir="ltr"
          />
          <Button size="sm" variant="secondary" onClick={handleFind} disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          </Button>
        </div>
        {found && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" /> {found.name}
            </span>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={handleJoin} disabled={busy}>
              {t.joinButton}
            </Button>
          </div>
        )}
        {!found && <p className="text-[11px] text-muted-foreground">{fa ? t.findSchoolHint : t.findSchoolHint}</p>}
      </CardContent>
    </Card>
  );
}
