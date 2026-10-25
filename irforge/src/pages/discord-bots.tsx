import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Plus, Loader2, ExternalLink, Server, Command, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/forge-ui/PageHeader";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { createDiscordBot, discordErrorText, DiscordApiError, listDiscordBots } from "@/lib/discord-bots-api";
import { BotStatusPill } from "@/components/discord/status";

/** pages/discord-bots.tsx — «بات‌های دیسکورد من»: فهرست + ساخت بات تازه. */
export default function DiscordBots() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = (a: string, b: string) => (fa ? a : b);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  usePrivatePageTitle(t("بات‌های دیسکورد", "Discord bots"));

  const { data, isLoading } = useQuery({ queryKey: ["discord-bots"], queryFn: listDiscordBots, refetchInterval: 8000 });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  const create = useMutation({
    mutationFn: () => createDiscordBot({ name: name.trim(), token: token.trim() || undefined }),
    onSuccess: ({ bot }) => {
      qc.invalidateQueries({ queryKey: ["discord-bots"] });
      setOpen(false);
      setName("");
      setToken("");
      navigate(`/discord-bots/${bot.id}`);
    },
    onError: (e: unknown) => {
      const code = e instanceof DiscordApiError ? e.code : "unknown";
      toast({ title: t("ساخت بات انجام نشد", "Couldn't create the bot"), description: discordErrorText(code, fa), variant: "destructive" });
    },
  });

  const bots = data?.bots ?? [];
  const limit = data?.maxBotsPerUser ?? 3;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        icon={<Gamepad2 />}
        eyebrow={t("بات‌ساز دیسکورد", "Discord bot builder")}
        title={t("بات‌های دیسکورد من", "My Discord bots")}
        description={t("بدون کدنویسی بات دیسکورد بسازید: دستور اسلش، خوش‌آمدگویی، مدیریت سرور، دکمه و دیتابیس.", "Build Discord bots without code: slash commands, welcome messages, moderation, buttons and a database.")}
        actions={
          <Button onClick={() => setOpen(true)} disabled={bots.length >= limit} data-testid="discord-new-bot">
            <Plus className="me-2 size-4" />{t("بات جدید", "New bot")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : bots.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("از اینجا شروع کنید", "Start here")}</CardTitle>
            <CardDescription>{t("اولین بات دیسکوردتان را در چند دقیقه بسازید.", "Create your first Discord bot in a few minutes.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed">
            <ol className="list-decimal space-y-1.5 ps-5">
              <li>{t("در discord.com/developers/applications یک Application بسازید.", "Create an Application at discord.com/developers/applications.")}</li>
              <li>{t("از بخش Bot دکمه‌ی Reset Token را بزنید و توکن را کپی کنید.", "In the Bot section press Reset Token and copy the token.")}</li>
              <li>{t("اینجا «بات جدید» را بزنید، نام و توکن را وارد کنید.", "Press “New bot” here and enter a name and the token.")}</li>
              <li>{t("دستورها و رویدادها را بچینید، بات را روشن کنید و با لینک دعوت به سرورتان اضافه‌اش کنید.", "Arrange commands and events, start the bot, and add it to your server with the invite link.")}</li>
            </ol>
            <Button onClick={() => setOpen(true)}><Plus className="me-2 size-4" />{t("ساخت اولین بات", "Create first bot")}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {bots.map((b) => (
            <Link key={b.id} href={`/discord-bots/${b.id}`} data-testid={`discord-bot-${b.id}`}>
              <Card className="h-full cursor-pointer transition hover:border-primary/50 hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-lg">{b.name}</CardTitle>
                      <CardDescription dir="ltr" className="truncate text-start">{b.botUsername ? `@${b.botUsername}` : t("توکن ثبت نشده", "No token yet")}</CardDescription>
                    </div>
                    <BotStatusPill bot={b} fa={fa} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Command className="size-3.5" />{b.counts.commands} {t("دستور", "commands")}</span>
                  <span className="flex items-center gap-1"><Zap className="size-3.5" />{b.counts.events} {t("رویداد", "events")}</span>
                  <span className="flex items-center gap-1"><Server className="size-3.5" />{b.guildCount} {t("سرور", "servers")}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t(`حداکثر ${limit} بات دیسکورد برای هر حساب.`, `Up to ${limit} Discord bots per account.`)}</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ساخت بات دیسکورد", "Create a Discord bot")}</DialogTitle>
            <DialogDescription>{t("توکن را می‌توانید بعداً هم ثبت کنید. توکن رمزنگاری می‌شود و دوباره نمایش داده نخواهد شد.", "You can add the token later. It is encrypted and never shown again.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("نام بات", "Bot name")}</label>
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("مثلاً بات مدیریت سرور", "e.g. My server bot")} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("توکن بات (اختیاری)", "Bot token (optional)")}</label>
              <Input dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="MTIz…" />
              <a className="inline-flex items-center gap-1 text-xs text-primary" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
                Discord Developer Portal <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("انصراف", "Cancel")}</Button>
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}{t("ساخت", "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
