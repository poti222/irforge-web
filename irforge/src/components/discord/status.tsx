import { StatusPill, type Tone } from "@/components/forge-ui/LiveDot";
import { discordErrorText, type DiscordBotSummary } from "@/lib/discord-bots-api";

export function botStatusInfo(bot: Pick<DiscordBotSummary, "status" | "desiredState" | "runtimeState" | "runnerStale" | "runtimeErrorCode" | "tokenSet">, fa: boolean): { tone: Tone; text: string; pulse: boolean } {
  const t = (a: string, b: string) => (fa ? a : b);
  if (bot.status === "suspended") return { tone: "bad", text: t("تعلیق‌شده", "Suspended"), pulse: false };
  if (!bot.tokenSet) return { tone: "idle", text: t("توکن ثبت نشده", "No token"), pulse: false };
  if (bot.desiredState === "running" && bot.runnerStale) return { tone: "warn", text: t("اجراکننده پاسخ نمی‌دهد", "Runner not responding"), pulse: false };
  if (bot.runtimeState === "error") return { tone: "bad", text: t("خطا", "Error"), pulse: false };
  if (bot.desiredState === "stopped") return { tone: bot.runtimeState === "online" ? "warn" : "idle", text: bot.runtimeState === "online" ? t("در حال خاموش‌شدن…", "Stopping…") : t("خاموش", "Offline"), pulse: false };
  if (bot.runtimeState === "online") return { tone: "ok", text: t("آنلاین", "Online"), pulse: true };
  return { tone: "warn", text: t("در حال اتصال…", "Connecting…"), pulse: true };
}

export function BotStatusPill({ bot, fa }: { bot: Parameters<typeof botStatusInfo>[0]; fa: boolean }) {
  const s = botStatusInfo(bot, fa);
  return <StatusPill tone={s.tone} pulse={s.pulse}>{s.text}</StatusPill>;
}

export function runtimeErrorMessage(bot: Pick<DiscordBotSummary, "runtimeErrorCode" | "runtimeError">, fa: boolean): string | null {
  if (!bot.runtimeErrorCode && !bot.runtimeError) return null;
  return bot.runtimeErrorCode ? discordErrorText(bot.runtimeErrorCode, fa) : bot.runtimeError;
}
