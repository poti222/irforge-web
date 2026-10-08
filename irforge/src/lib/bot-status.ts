import type { Lang } from "@/hooks/use-language";
import type { Tone } from "@/components/forge-ui/LiveDot";

/**
 * Human labels + tone for `bot.status`. The raw enum ("active", "inactive",
 * "pending_payment"…) used to be printed as-is, in English, on every Persian
 * page; this is the one place that turns it into something a user can read.
 */
type Labels = { active: string; inactive: string; pending: string; rejected: string; expired: string; error: string; tokenInvalid: string };

const LABELS: Record<Lang, Labels> = {
  fa: { active: "فعال", inactive: "خاموش", pending: "در انتظار پرداخت", rejected: "پرداخت ردشده", expired: "منقضی‌شده", error: "خطا", tokenInvalid: "توکن نامعتبر" },
  en: { active: "Active", inactive: "Stopped", pending: "Awaiting payment", rejected: "Payment rejected", expired: "Expired", error: "Error", tokenInvalid: "Invalid token" },
  ar: { active: "نشط", inactive: "متوقف", pending: "بانتظار الدفع", rejected: "الدفع مرفوض", expired: "منتهي", error: "خطأ", tokenInvalid: "رمز غير صالح" },
  tr: { active: "Aktif", inactive: "Durduruldu", pending: "Ödeme bekleniyor", rejected: "Ödeme reddedildi", expired: "Süresi doldu", error: "Hata", tokenInvalid: "Geçersiz belirteç" },
  ru: { active: "Активен", inactive: "Остановлен", pending: "Ожидает оплаты", rejected: "Оплата отклонена", expired: "Истёк", error: "Ошибка", tokenInvalid: "Недействительный токен" },
};

export function botStatusMeta(status: string, lang: Lang): { label: string; tone: Tone; pulse: boolean } {
  const l = LABELS[lang] ?? LABELS.en;
  switch (status) {
    case "active":
      return { label: l.active, tone: "ok", pulse: true };
    case "inactive":
      return { label: l.inactive, tone: "idle", pulse: false };
    case "pending_payment":
      return { label: l.pending, tone: "warn", pulse: false };
    case "payment_rejected":
      return { label: l.rejected, tone: "bad", pulse: false };
    case "expired":
    case "tier_expired":
      return { label: l.expired, tone: "bad", pulse: false };
    case "token_invalid":
      return { label: l.tokenInvalid, tone: "bad", pulse: false };
    case "error":
      return { label: l.error, tone: "bad", pulse: false };
    default:
      return { label: status, tone: "idle", pulse: false };
  }
}
