/**
 * TelegramNotifyToggle.tsx — «اعلان‌های سایت را در تلگرام هم بفرست».
 *
 * اعلان‌های سایت (تأیید فیش، پاسخ تیکت، هشدار تریال، اعلان سراسری…) از این
 * پس علاوه بر زنگوله‌ی سایت، در چتِ **بات پلتفرم** — همان باتی که کد ورود
 * می‌فرستد — هم می‌رسند. این سوئیچ خاموش‌کردنِ همان تحویل است؛ خودِ اعلان در
 * سایت به‌هرحال ساخته می‌شود.
 *
 * فقط وقتی معنی دارد که تلگرام وصل باشد، پس در همان کارت تلگرامِ پروفایل و
 * زیر شاخه‌ی «متصل» نشسته است. سرور هم مستقل از این، کاربر بدون `telegramId`
 * را کنار می‌گذارد (api-server/src/lib/notifyTelegram.ts).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

type Prefs = { notifyTelegram: boolean; telegramLinked: boolean };

const KEY = ["notification-prefs"] as const;

export function TelegramNotifyToggle() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => customFetch<Prefs>("/api/users/notification-prefs"),
  });

  const update = useMutation({
    mutationFn: (notifyTelegram: boolean) =>
      customFetch<Prefs>("/api/users/notification-prefs", {
        method: "PATCH",
        body: JSON.stringify({ notifyTelegram }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(KEY, saved);
      toast({
        title: saved.notifyTelegram
          ? (fa ? "اعلان‌های تلگرام روشن شد" : "Telegram notifications on")
          : (fa ? "اعلان‌های تلگرام خاموش شد" : "Telegram notifications off"),
      });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message }),
  });

  if (!data) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor="notify-telegram" className="text-sm font-medium">
          {fa ? "دریافت اعلان‌های سایت در تلگرام" : "Send site notifications to Telegram"}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fa
            ? "تأیید واریز، پاسخ تیکت، هشدار تریال و اعلان‌های سراسری در همین بات برایتان فرستاده می‌شود."
            : "Deposit approvals, ticket replies, trial warnings and announcements are sent to you in this bot."}
        </p>
      </div>
      <Switch
        id="notify-telegram"
        checked={data.notifyTelegram}
        disabled={update.isPending}
        onCheckedChange={(v) => update.mutate(v)}
      />
    </div>
  );
}
