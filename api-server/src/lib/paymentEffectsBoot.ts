/**
 * lib/paymentEffectsBoot.ts — ثبتِ effectهای پیش‌فرضِ ماژولِ پرداخت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۵).
 *
 * scope=bot: اثرِ تجاری (شارژ کیف‌پولِ همان بات / علامت‌گذاریِ سفارشِ پرداخت‌شده)
 * در خودِ بات اجرا می‌شود؛ سایت فقط «تأیید» را ثبت می‌کند و بات با claimِ یک‌باره
 * (`paymentBotApi.claimBotEffect`) آن را برمی‌دارد. پس effectِ سمتِ سایت عمداً
 * «فقط تغییرِ وضعیت» است — و صریحاً ثبت می‌شود تا fail-closedِ موتور (`paymentEffects`)
 * برای این دو نوع باز شود، نه برایِ هر چیزِ ثبت‌نشده.
 *
 * scope=platform (کیف‌پولِ خودِ IrForge): فاز ۸ — کیف‌پول **داخلِ همان تراکنشِ تأیید** شارژ می‌شود
 * (`platformWalletEffect.ts`)؛ برخلافِ bot، اینجا claim/رفت‌وبرگشت نیست.
 */
import { registerPaymentEffect } from "./paymentEffects";
import { platformWalletTopupEffect } from "./platformWalletEffect";
import { schoolWalletTopupEffect } from "./schoolWalletEffect";

const stateOnly = async () => { /* بات از طریقِ claim اثرِ تجاری را اعمال می‌کند */ };

/** idempotent: ثبتِ همان تابع دوباره بی‌خطاست (و پس از clearPaymentEffects در تست دوباره کار می‌کند). */
export function registerDefaultPaymentEffects(): void {
  registerPaymentEffect("bot", "wallet_topup", stateOnly);
  registerPaymentEffect("bot", "order", stateOnly);
  registerPaymentEffect("platform", "wallet_topup", platformWalletTopupEffect);
  // کیف‌پولِ مدرسه: همان الگوی platform، ولی school_wallets را شارژ می‌کند (schoolWalletEffect.ts).
  registerPaymentEffect("platform", "school_wallet_topup", schoolWalletTopupEffect);
}
