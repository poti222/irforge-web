import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Loader2, CheckCircle2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";

/**
 * یک کامپوننت برای هر دو نقطه‌ی اتصال تلگرام: ثبت‌نام و پروفایل.
 *
 * تفاوت دو حالت فقط در این است که کدام اندپوینت توکن را می‌سازد — پروفایل
 * اندپوینت `requireAuth` را صدا می‌زند، ثبت‌نام اندپوینت پیش از احراز هویت را.
 * بقیه‌ی رفتار (لینک عمیق، QR، poll، حالت متصل) یکی است، پس یک‌جا نوشته شده.
 *
 * **QR اختیاری نیست.** یک لینک `t.me/...` روی مرورگر دسکتاپ بدون گوشی برای
 * اسکن‌کردن عملاً بی‌فایده است.
 */

/**
 * QR بدون کتابخانه‌ی خارجی: از سرویس عمومی qr استفاده نمی‌کنیم چون آدرس
 * لینک عمیق (که یک توکن یک‌بارمصرف دارد) نباید به شخص ثالث برود. به‌جایش
 * از یک ماتریس محلی استفاده می‌شود.
 */
import { QrCanvas } from "./QrCanvas";

export type LinkMode = "register" | "profile";

export function TelegramLinkPanel({
  mode,
  deepLink,
  connected,
  connectedUsername,
  connectedName,
  waiting,
  onRefresh,
}: {
  mode: LinkMode;
  /** لینک عمیق آماده (حالت ثبت‌نام) — در حالت پروفایل خودش می‌سازد */
  deepLink?: string | null;
  connected?: boolean;
  connectedUsername?: string | null;
  connectedName?: string | null;
  /** آیا در حال انتظار برای تکمیل در تلگرام هستیم */
  waiting?: boolean;
  onRefresh?: () => void;
}) {
  const t = useT("auth") as Record<string, string>;
  const [profileLink, setProfileLink] = useState<string | null>(null);

  // حالت پروفایل توکنش را از اندپوینت requireAuth می‌گیرد.
  const { data: linkData } = useQuery({
    queryKey: ["telegram-link-start"],
    queryFn: () =>
      customFetch<{ token: string; expiresAt: string }>("/api/auth/telegram/link/start", {
        method: "POST",
      }),
    enabled: mode === "profile" && !connected,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!linkData?.token) return;
    customFetch<{ username: string | null }>("/api/auth/telegram/bot-username")
      .then((r) => {
        if (r.username) setProfileLink(`https://t.me/${r.username}?start=${linkData.token}`);
      })
      .catch(() => setProfileLink(null));
  }, [linkData?.token]);

  const link = mode === "register" ? deepLink ?? null : profileLink;

  const handle = useMemo(() => {
    if (connectedUsername) return `@${connectedUsername.replace(/^@/, "")}`;
    return connectedName ?? null;
  }, [connectedUsername, connectedName]);

  if (connected) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="flex items-center gap-3 p-5">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-500" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">{t.telegramConnected}</p>
            {handle && (
              <p className="truncate text-sm text-muted-foreground" dir="ltr">{handle}</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Button asChild disabled={!link} className="w-full gap-2">
        <a href={link ?? "#"} target="_blank" rel="noopener noreferrer">
          <Send className="size-4" aria-hidden="true" />
          {t.openTelegram}
        </a>
      </Button>

      {link && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">{t.scanQr}</p>
          <QrCanvas value={link} size={168} />
        </div>
      )}

      {waiting && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t.waitingForTelegram}
        </p>
      )}

      {onRefresh && (
        <Button variant="ghost" size="sm" className="w-full" onClick={onRefresh}>
          {t.continue}
        </Button>
      )}
    </div>
  );
}
