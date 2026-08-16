/**
 * ClaimBotCard.tsx — «کد ادمین یک بات را دارم».
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز فقط مالک بات می‌توانست از سایت مدیریتش کند؛ اگر کسی می‌خواست
 * مدیریت باتش را به شما بسپارد، هیچ راهی نبود.
 *
 * ⚠️ **این با «کد مدیر کل» فرق دارد.** آن یکی راز سطح-پلتفرم است و بخش‌های
 * سوپرادمین سایت را باز می‌کند. این یکی مخصوص **یک بات** است و فقط پنل
 * مدیریت همان بات را باز می‌کند — نه حذف بات، نه ساخت کد تازه، نه تغییر
 * مالکیت. آن‌ها دست مالک می‌مانند.
 *
 * دسترسی ثبت می‌شود و مالک می‌تواند هر وقت خواست لغوش کند.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListBotsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

export function ClaimBotCard() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState("");

  const claim = useMutation({
    mutationFn: () =>
      customFetch<{ botId: string; botName: string }>("/api/bots/claim", {
        method: "POST",
        body: JSON.stringify({ adminCode: code.trim() }),
      }),
    onSuccess: (result) => {
      setCode("");
      // بات تازه باید بلافاصله در فهرست «بات‌ها» ظاهر شود.
      qc.invalidateQueries({ queryKey: getListBotsQueryKey() });
      toast({
        title: fa ? "دسترسی داده شد" : "Access granted",
        description: fa
          ? `حالا می‌توانید بات «${result.botName}» را از بخش بات‌ها مدیریت کنید.`
          : `You can now manage “${result.botName}” from the Bots section.`,
      });
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: fa ? "کد پذیرفته نشد" : "Code not accepted",
        description: err?.data?.error ?? err?.message,
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> {fa ? "کد ادمین بات" : "Bot admin code"}
        </CardTitle>
        <CardDescription>
          {fa
            ? "اگر کسی کد ادمین باتش را به شما داده، اینجا واردش کنید تا آن بات به فهرست بات‌هایتان اضافه شود و بتوانید مدیریتش کنید. ⚠️ این با «کد مدیر کل» پایین‌تر فرق دارد و فقط همان یک بات را باز می‌کند — حذف بات و ساخت کد تازه همچنان فقط دست مالک است."
            : "If someone gave you their bot's admin code, enter it here to add that bot to your list and manage it. ⚠️ This is not the Super Admin Code below — it unlocks only that one bot, and deleting the bot or issuing a new code stays with its owner."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pf-bot-code">{fa ? "کد" : "Code"}</Label>
          <Input
            id="pf-bot-code"
            dir="ltr"
            className="font-mono"
            placeholder={fa ? "کد ادمین بات" : "Bot admin code"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim()) claim.mutate();
            }}
          />
        </div>
        <Button disabled={!code.trim() || claim.isPending} onClick={() => claim.mutate()}>
          {claim.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
          {fa ? "افزودن بات" : "Add bot"}
        </Button>
      </CardContent>
    </Card>
  );
}
