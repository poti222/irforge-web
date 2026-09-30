import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, Check } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { getSchoolBotStatus, getSchoolBotSubscribed, createSchoolBotLinkToken } from "@/lib/schools-api";

/**
 * BotConnectWidget.tsx — بخش "/schools" فاز ۷ (بخشِ B): دکمه‌ی «اتصال به بات
 * اطلاع‌رسانی» — کنارِ سایدبار در SchoolShell، برایِ **هر نقشی** (مدیر تا
 * والد)، فقط وقتی مدرسه بات فعال دارد. با کلیک، یک توکنِ یک‌بارمصرف می‌سازد و
 * `https://t.me/<bot>?start=<token>` را در تبِ تازه باز می‌کند — همان الگویِ
 * لینکِ عمیقِ باتِ پلتفرم (`telegramLinkTokensTable`)، اما برایِ باتِ **همین
 * مدرسه** (routes/schoolBotWebhook.ts چت‌آیدی را بعد از `/start` ثبت می‌کند).
 */
export function BotConnectWidget({ schoolId }: { schoolId: string }) {
  const t = useT("schools") as any;
  const { data: bot } = useQuery({ queryKey: ["schools", "bot", schoolId], queryFn: () => getSchoolBotStatus(schoolId) });
  const { data: subscribed, refetch: refetchSubscribed } = useQuery({
    queryKey: ["schools", "bot-subscribed", schoolId],
    queryFn: () => getSchoolBotSubscribed(schoolId),
    enabled: !!bot?.purchased,
  });

  if (!bot?.purchased) return null;

  async function handleConnect() {
    const { deepLink } = await createSchoolBotLinkToken(schoolId);
    window.open(deepLink, "_blank", "noopener,noreferrer");
    // کاربر بعد از زدنِ /start توی تلگرام برمی‌گردد؛ یک تلاشِ دیرترِ ساده
    // برایِ به‌روزکردنِ وضعیت (وبهوک فوری کار می‌کند، ولی بازگشت به سایت
    // معمولاً کمی طول می‌کشد).
    setTimeout(() => void refetchSubscribed(), 4000);
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Bot className="size-4" /> {t.botConnectTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-[11px] text-muted-foreground">{t.botConnectDescription}</p>
        {subscribed?.subscribed ? (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" /> {t.botConnected}
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={handleConnect}>
            {t.botConnectButton}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
