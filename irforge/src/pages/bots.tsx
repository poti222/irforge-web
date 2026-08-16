import { useListBots } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Bot as BotIcon, ArrowRight, Gift, Settings } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

export default function Bots() {
  usePrivatePageTitle(useT("pageTitles").bots);
  const { lang } = useLanguage();
  const t = useT("bots");
  const { data: bots, isLoading } = useListBots();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.title}</h1>
        {/* Creating a bot now always starts from the Buy Bot flow. */}
        <Button asChild className="w-full sm:w-auto">
          <Link href="/buy-bot">
            <Plus className="me-2 h-4 w-4" /> {t.createNewBot}
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-20" />
              <CardContent className="h-24" />
            </Card>
          ))}
        </div>
      ) : bots && bots.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <Card key={bot.id} className="flex flex-col">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* the bot's own Telegram profile photo when it has one —
                        makes a list of several bots scannable at a glance */}
                    {bot.avatar ? (
                      <img
                        src={bot.avatar}
                        alt={t.botAvatarAlt}
                        loading="lazy"
                        className="size-10 shrink-0 rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <BotIcon className="h-6 w-6" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <CardTitle className="truncate text-lg">{bot.name}</CardTitle>
                      {bot.username ? (
                        <a
                          href={`https://t.me/${bot.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          dir="ltr"
                          className="block truncate text-sm text-muted-foreground hover:text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          @{bot.username}
                        </a>
                      ) : (
                        <p className="truncate text-sm text-muted-foreground">{t.noUsername}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant={bot.status === "active" ? "default" : "secondary"}>
                    {bot.status === "expired" ? (lang === "fa" ? "منقضی‌شده" : "expired") : bot.status}
                  </Badge>
                </div>
                {bot.isTrial && (
                  <Badge
                    variant="outline"
                    className={`mt-2 flex w-fit items-center gap-1 ${bot.status === "expired" ? "border-red-500/40 text-red-500" : "border-amber-500/40 text-amber-600 dark:text-amber-400"}`}
                  >
                    <Gift className="size-3" />
                    {bot.status === "expired"
                      ? (lang === "fa" ? "تریال تمام شده" : "Trial ended")
                      : (lang === "fa" ? `تریال · ${bot.trialDaysLeft ?? 0} روز مانده` : `Trial · ${bot.trialDaysLeft ?? 0}d left`)}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="flex-1 pb-4">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {bot.description || t.noDescription}
                </p>
                <div className="flex gap-4 mt-4 text-sm">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">{t.usersLabel}</span>
                    <span className="font-medium">{(bot.userCount || 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">{t.commandsLabel}</span>
                    <span className="font-medium">{(bot.commandCount || 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-0 border-t mt-4 gap-2">
                <Button variant="ghost" className="flex-1 mt-4" asChild>
                  <Link href={`/bots/${bot.id}`}>
                    {t.manageBot} <ArrowRight className="ms-2 h-4 w-4 rtl-flip" />
                  </Link>
                </Button>
                {/* Straight to the gear — the settings section is where most
                    return visits go, and the workspace reads the section from
                    the URL, so this deep link lands exactly there. */}
                <Button variant="ghost" size="icon" className="mt-4 shrink-0" asChild title={t.botSettingsShortcut}>
                  <Link href={`/bots/${bot.id}?section=settings`} aria-label={t.botSettingsShortcut}>
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-card rounded-lg border border-dashed">
          <BotIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t.noBotsTitle}</h2>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            {t.noBotsDesc}
          </p>
          <Button asChild>
            <Link href="/buy-bot">
              <Plus className="me-2 h-4 w-4" /> {t.createFirstBot}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
