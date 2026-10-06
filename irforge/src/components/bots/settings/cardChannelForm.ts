/**
 * settings/cardChannelForm.ts — منطقِ خالصِ فرمِ «کارت‌به‌کارت خودکار» (بدونِ React، قابلِ تست).
 *
 * لینکِ پرداخت و شماره‌کارت **هر دو اختیاری‌اند ولی حداقل یکی لازم است** (هر دو هم‌زمان هم مجاز).
 * نوعِ کانال را فروشنده انتخاب نمی‌کند؛ از روی محتوا می‌آید — همان قاعده‌ی `deriveKind` در
 * `api-server/src/lib/paymentChannelAdmin.ts` (سرور هم دوباره می‌سنجد؛ این فقط برایِ پیامِ فوری و دکمه‌ی ذخیره است).
 */
import type { ChannelKind } from "./cardChannelsApi";

export type LinkType = "fixed_link" | "open_link";

/**
 * - فقط کارت → `card_manual`
 * - فقط لینک → همان «نوعِ لینک» که فروشنده گفته (مبلغ ثابت/باز)
 * - کارت + لینک → همیشه `open_link` (لینکِ مبلغ‌ثابت پسوندِ یکتا ندارد، با کارت ترکیب نمی‌شود)
 * - هیچ‌کدام → `null` (فرم نامعتبر است)
 */
export function deriveFormKind(hasCard: boolean, hasUrl: boolean, linkType: LinkType): ChannelKind | null {
  if (!hasCard && !hasUrl) return null;
  if (hasCard && !hasUrl) return "card_manual";
  if (hasCard) return "open_link";
  return linkType;
}

export type FormProblem = "need_one" | "holder_required";

/** مشکل‌هایِ فرم؛ خالی = قابلِ ذخیره. نامِ صاحبِ کارت فقط وقتی کارت هست لازم است. */
export function formProblems(i: { hasCard: boolean; hasUrl: boolean; holderName: string }): FormProblem[] {
  const out: FormProblem[] = [];
  if (!i.hasCard && !i.hasUrl) out.push("need_one");
  if (i.hasCard && !i.holderName.trim()) out.push("holder_required");
  return out;
}

/** کارتِ «بعد از ذخیره»: کارتِ تازه، یا کارتِ فعلی که برداشته نشده. */
export function willHaveCard(i: { newCardDigits: string; existingCard: boolean; removeCard: boolean }): boolean {
  return i.newCardDigits.length > 0 || (i.existingCard && !i.removeCard);
}
