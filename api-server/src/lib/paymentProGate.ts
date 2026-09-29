/**
 * lib/paymentProGate.ts — قلابِ آینده‌ی «payment_pro»
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۷: «این قابلیت در هسته و رایگان است؛ فقط قلاب `payment_pro`
 * را برایِ آینده باز بگذار»).
 *
 * امروز همه‌ی فروشنده‌ها همه‌ی قابلیت‌های کارت‌به‌کارتِ خودکار را رایگان دارند و فقط یک سقفِ منطقیِ
 * تعدادِ کانال در هر بات برقرار است (جلوگیریِ سوءاستفاده/خطای کاربر). اگر روزی این قابلیت به پلنِ
 * پولی گره بخورد، **فقط همین تابع** عوض می‌شود (مثلاً `isPluginEnabled(botId, "payment_pro")` را
 * بخواند)؛ هیچ route/UIی نباید خودش سقف یا پلن را حدس بزند.
 */
export interface PaymentChannelLimits {
  /** حداکثرِ تعدادِ کانال (فعال یا غیرفعال) به‌ازای هر بات. */
  maxChannels: number;
  /** آیا این بات مشمولِ پلنِ payment_pro است؟ امروز همیشه false (همه چیز رایگان است). */
  pro: boolean;
}

export const FREE_MAX_CHANNELS = 3;

export async function getPaymentChannelLimits(_botId: string): Promise<PaymentChannelLimits> {
  return { maxChannels: FREE_MAX_CHANNELS, pro: false };
}
