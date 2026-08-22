/**
 * BotAdminCodeCard.tsx — کد ادمینِ این بات، در نمای کلی.
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز این کد فقط در تنظیمات → «منطقه‌ی خطر» دیده می‌شد؛ جایی که کاربر
 * برای پیدا کردن یک عددی که هر بار راه‌اندازی لازمش دارد، باید سه کلیک
 * می‌کرد و از کنار دکمه‌ی حذف بات رد می‌شد.
 *
 * ⚠️ **این کد با «کد مدیر کل» در صفحه‌ی پروفایل هیچ ربطی ندارد.** آن یکی یک
 * راز سطح-پلتفرم است که بخش‌های سوپرادمین سایت را باز می‌کند؛ این یکی فقط
 * پنل ادمینِ همین یک بات را در تلگرام فعال می‌کند. متن هر دو صریحاً همین را
 * می‌گوید تا کسی یکی را جای دیگری وارد نکند.
 */
import { useState } from "react";
import type { Bot } from "@workspace/api-client-react";
import { KeyRound, Copy, Check, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

export function BotAdminCodeCard({ bot }: { bot: Bot }) {
  const t = useT("botWorkspace");
  const { toast } = useToast();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  // بدون کد، کارت اصلاً نمی‌آید — یک کارت خالی چیزی به نمای کلی اضافه نمی‌کند.
  if (!bot.adminCode) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(bot.adminCode as string);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // بدون HTTPS یا در مرورگر قدیمی، clipboard اجازه ندارد. کاربر باید
      // بداند چرا کلیک اثری نکرد، وگرنه کد خالی می‌چسباند.
      setShown(true);
      toast({ variant: "destructive", title: t.adminCodeCopyFailed });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> {t.adminCodeTitle}
        </CardTitle>
        <CardDescription>{t.adminCodeDesc}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 select-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
          {shown ? bot.adminCode : "•".repeat(bot.adminCode.length)}
        </code>
        <Button variant="ghost" size="icon" aria-label={shown ? t.adminCodeHide : t.adminCodeShow} onClick={() => setShown((v) => !v)}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t.adminCodeCopy} onClick={copy}>
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
        </Button>
      </CardContent>
    </Card>
  );
}
