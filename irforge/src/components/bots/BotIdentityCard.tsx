import { useState } from "react";
import { Bot as BotIcon, Copy, Check, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Bot } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

/**
 * Overview identity block: avatar + name + @username, a scannable QR to the
 * bot's Telegram link, copy buttons for the bot's internal ID and its
 * Telegram @username, and an "Open in Telegram" shortcut.
 *
 * `bot.username` (and therefore the QR / open-in-Telegram affordances) is
 * only populated once Telegram identity sync (Phase 7) has run for this bot.
 * Until then we still show the avatar/name row and the bot-ID copy button —
 * those never depend on Telegram — but we render a short muted explanation
 * instead of a QR that would point at `t.me/null`.
 */
export function BotIdentityCard({ bot }: { bot: Bot }) {
  const t = useT("botWorkspace");
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<"id" | "username" | null>(null);

  const hasUsername = Boolean(bot.username);
  const handle = hasUsername ? `@${bot.username}` : null;
  const link = hasUsername ? `https://t.me/${bot.username}` : null;

  function copy(field: "id" | "username", value: string, toastMessage: string) {
    // writeText rejects when the page isn't a secure context or the
    // permission is denied; unhandled that surfaces as an uncaught rejection
    // in the console. The visual confirmation is best-effort either way.
    void navigator.clipboard?.writeText(value).catch(() => {});
    toast({ title: toastMessage });
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t.identityTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {bot.avatar ? (
            <img
              src={bot.avatar}
              alt={t.botAvatarAlt}
              loading="lazy"
              className="size-12 shrink-0 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BotIcon className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-semibold">{bot.name}</div>
            {handle ? (
              <div dir="ltr" className="truncate font-mono text-sm text-muted-foreground">
                {handle}
              </div>
            ) : null}
          </div>
        </div>

        {link && handle ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <div className="rounded-lg bg-white p-2">
              {/* fixed white plate: a QR on a dark card is unreadable to scanners */}
              <QRCodeSVG value={link} size={116} level="M" marginSize={0} />
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
              <p className="text-xs text-muted-foreground">{t.qrHint}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy("id", bot.id, t.botIdCopiedToast)}
                >
                  {copiedField === "id" ? (
                    <Check className="me-1.5 size-3.5" />
                  ) : (
                    <Copy className="me-1.5 size-3.5" />
                  )}
                  {copiedField === "id" ? t.copied : t.copyBotId}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy("username", handle, t.usernameCopiedToast)}
                >
                  {copiedField === "username" ? (
                    <Check className="me-1.5 size-3.5" />
                  ) : (
                    <Copy className="me-1.5 size-3.5" />
                  )}
                  {copiedField === "username" ? t.copied : t.copyUsername}
                </Button>
                <Button type="button" size="sm" asChild>
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="me-1.5 size-3.5" />
                    {t.openInTelegram}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{t.noTelegramIdentity}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => copy("id", bot.id, t.botIdCopiedToast)}
            >
              {copiedField === "id" ? (
                <Check className="me-1.5 size-3.5" />
              ) : (
                <Copy className="me-1.5 size-3.5" />
              )}
              {copiedField === "id" ? t.copied : t.copyBotId}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
