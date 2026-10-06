/**
 * lib/bot-lifetime.ts — برچسبِ «عمرِ بات» روی کارتِ لیستِ بات‌ها (منطقِ خالص، قابلِ تست).
 *
 * لایوباگ ۲۰۲۶-۱۰-۰۶: «پرو و استاندارد اصلاً زمان ندارند؛ تریال ۷ روز، استاندارد و پرو ۳۰ روز؛ بات‌ها وقتی زمانشان
 * تمام می‌شود پاک نمی‌شوند». لیست فقط تریال را نشان می‌داد؛ حالا هر سه حالت + شمارشِ معکوسِ حذفِ نهایی.
 */
import type { Bot } from "@workspace/api-client-react";
import type { Lang } from "@/lib/i18n";

export type LifetimeTone = "danger" | "warn" | "ok";
export type LifetimeBadge = { text: string; tone: LifetimeTone };

export const LIFETIME_TONE: Record<LifetimeTone, string> = {
  danger: "border-red-500/40 text-red-500",
  warn: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  ok: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
};

/** روزِ هشدار: این تعداد روز یا کمتر مانده ⇒ زرد. */
export const LIFETIME_WARN_DAYS = 3;

type T = {
  trialDays: string; trialEnded: string; tierDays: string; tierEnded: string; purge: string; standard: string; pro: string;
};
const TEXTS: Record<Lang, T> = {
  fa: { trialDays: "تریال · {n} روز مانده", trialEnded: "تریال تمام شده", tierDays: "{tier} · {n} روز مانده", tierEnded: "پکیج تمام شده", purge: "حذف دائمی تا {n} روز دیگر", standard: "استاندارد", pro: "پرو" },
  en: { trialDays: "Trial · {n}d left", trialEnded: "Trial ended", tierDays: "{tier} · {n}d left", tierEnded: "Package ended", purge: "Deleted in {n}d", standard: "Standard", pro: "Pro" },
  ar: { trialDays: "تجريبي · {n} يوم متبقٍ", trialEnded: "انتهت التجربة", tierDays: "{tier} · {n} يوم متبقٍ", tierEnded: "انتهت الباقة", purge: "حذف نهائي بعد {n} يوم", standard: "Standard", pro: "Pro" },
  tr: { trialDays: "Deneme · {n} gün kaldı", trialEnded: "Deneme bitti", tierDays: "{tier} · {n} gün kaldı", tierEnded: "Paket bitti", purge: "{n} gün sonra silinecek", standard: "Standard", pro: "Pro" },
  ru: { trialDays: "Пробный · {n} дн.", trialEnded: "Пробный период закончился", tierDays: "{tier} · {n} дн.", tierEnded: "Пакет закончился", purge: "Удаление через {n} дн.", standard: "Standard", pro: "Pro" },
};

type LifetimeBot = Pick<Bot, "status" | "isTrial" | "trialDaysLeft"> &
  Partial<Pick<Bot, "tier" | "tierExpiresAt" | "tierDaysLeft" | "purgeDaysLeft">>;

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);

export function botLifetime(bot: LifetimeBot, lang: Lang): LifetimeBadge | null {
  const t = TEXTS[lang] ?? TEXTS.en;
  // ۱) منقضی‌شده و شمارشِ معکوسِ حذفِ نهایی فعال است — مهم‌ترین چیزی که مالک باید ببیند.
  if (bot.purgeDaysLeft != null) return { text: fill(t.purge, { n: bot.purgeDaysLeft }), tone: "danger" };
  // ۲) تریال
  if (bot.isTrial) {
    if (bot.status === "expired") return { text: t.trialEnded, tone: "danger" };
    const n = bot.trialDaysLeft ?? 0;
    return { text: fill(t.trialDays, { n }), tone: n <= LIFETIME_WARN_DAYS ? "warn" : "ok" };
  }
  // ۳) پکیجِ ۳۰ روزه‌یِ استاندارد/پرو
  if (bot.tier === "standard" || bot.tier === "pro") {
    if (bot.status === "tier_expired") return { text: t.tierEnded, tone: "danger" };
    if (bot.tierExpiresAt && bot.tierDaysLeft != null) {
      const n = Math.max(0, bot.tierDaysLeft);
      return { text: fill(t.tierDays, { tier: bot.tier === "pro" ? t.pro : t.standard, n }), tone: n <= LIFETIME_WARN_DAYS ? "warn" : "ok" };
    }
  }
  return null;
}
