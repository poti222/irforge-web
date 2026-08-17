/**
 * use-plugin-pricing.ts — قیمت‌نامه، از سرور.
 *
 * هیچ عددی اینجا هاردکد نیست و نباید بشود. `GET /api/marketplace/pricing`
 * همان جدولی را می‌دهد که `POST /bots/wallet-purchase` هم موقع کم‌کردن پول
 * از آن استفاده می‌کند (`api-server/src/lib/pluginPricing.ts`) — پس عددی که
 * کاربر می‌بیند و عددی که پرداخت می‌شود ساختاراً یکی‌اند.
 *
 * قبلاً صفحه‌ی بات سفارشی می‌گفت «قیمت‌گذاری به‌زودی» و با مبلغ صفر به سبد
 * می‌رفت؛ حالا قیمت واقعی دارد و با هر تغییر انتخاب، بالا و پایین می‌رود.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type PluginPrice = {
  id: string;
  /**
   * نام و توضیح، هر دو زبان. سرور از همان اول این چهار فیلد را می‌فرستاد ولی
   * این تایپ فقط دوتای انگلیسی را داشت، پس انتخابگر پلاگین در صفحه‌ی خرید
   * همیشه انگلیسی درمی‌آمد.
   */
  name: string;
  name_fa: string;
  description: string;
  description_fa: string;
  version: string;
  price: number;
  webSection: string | null;
};

export type CustomBuildPricing = {
  basePrice: number;
  includedRamGb: number;
  includedCpuCores: number;
  pricePerRamGb: number;
  pricePerCpuCore: number;
  maxRamGb: number;
  maxCpuCores: number;
};

export type PricingCatalog = {
  plugins: PluginPrice[];
  customBuild: CustomBuildPricing;
  catalogPublished: boolean;
};

export function usePluginPricing() {
  return useQuery({
    queryKey: ["marketplace-pricing"],
    queryFn: () => customFetch<PricingCatalog>("/api/marketplace/pricing"),
    // قیمت‌نامه از کد سرور می‌آید و بین دیپلوی‌ها ثابت است.
    staleTime: 5 * 60_000,
  });
}

/**
 * جمع قیمت یک بات سفارشی — **آینه‌ی دقیق `quoteCustomBuild` سرور.**
 *
 * محاسبه‌ی سمت کلاینت فقط برای این است که عدد **همان لحظه** با حرکت اسلایدر و
 * تیک‌خوردن پلاگین عوض شود؛ مبلغی که واقعاً کم می‌شود را سرور خودش از همان
 * فرمول حساب می‌کند و به این اعداد اعتماد نمی‌کند. اگر این دو از هم فاصله
 * بگیرند، کاربر یک عدد می‌بیند و عدد دیگری پرداخت می‌کند — پس فرمول باید
 * مو‌به‌مو یکی بماند.
 */
export function quoteCustom(
  pricing: CustomBuildPricing | undefined,
  ramGb: number,
  cpuCores: number,
  selectedPlugins: Array<{ id: string; price: number }>,
): { base: number; resources: number; pluginsTotal: number; total: number } {
  if (!pricing) return { base: 0, resources: 0, pluginsTotal: 0, total: 0 };

  const extraRam = Math.max(0, ramGb - pricing.includedRamGb);
  const extraCpu = Math.max(0, cpuCores - pricing.includedCpuCores);
  const resources = extraRam * pricing.pricePerRamGb + extraCpu * pricing.pricePerCpuCore;
  const pluginsTotal = selectedPlugins.reduce((sum, plugin) => sum + plugin.price, 0);

  return {
    base: pricing.basePrice,
    resources,
    pluginsTotal,
    total: pricing.basePrice + resources + pluginsTotal,
  };
}
