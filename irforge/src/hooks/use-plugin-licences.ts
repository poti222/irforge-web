/**
 * use-plugin-licences.ts — «چه پلاگین‌هایی دارم و روی کدام بات نشسته‌اند».
 *
 * یک درخواست، هر دو بخشِ UI: پلاگین‌های داشته (بالا) و نداشته (پایین)، به‌علاوه‌ی
 * فهرست بات‌ها برای انتخابگر. مرز دو بخش `owned` است — به‌محض خرید، پلاگین از
 * بخش پایین بیرون می‌رود و بالا ظاهر می‌شود.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type PluginLicence = {
  licenceId: string;
  botId: string;
  botName: string;
  installedAt: string;
};

export type LicencedPlugin = {
  id: string;
  name: string;
  name_fa: string;
  description: string;
  description_fa: string;
  version: string;
  required_sheets: string[];
  webSection: string | null;
  price: number;
  isFree: boolean;
  marketplaceItemId: string;
  /** روی *هر* باتی داردش — مرز دو بخش UI. */
  owned: boolean;
  licences: PluginLicence[];
};

export type LicenceBot = { id: string; name: string; status: string };

export type LicencesResponse = {
  plugins: LicencedPlugin[];
  bots: LicenceBot[];
  catalogPublished: boolean;
};

export const PLUGIN_LICENCES_KEY = ["plugin-licences"] as const;

export function usePluginLicences() {
  return useQuery({
    queryKey: PLUGIN_LICENCES_KEY,
    queryFn: () => customFetch<LicencesResponse>("/api/plugin-licences"),
  });
}

/**
 * هر چیزی که وضعیت مالکیت/نصب را عوض می‌کند باید این‌ها را باطل کند، وگرنه
 * پلاگینِ تازه‌خریده‌شده تا رفرش دستی در بخش «نداشته‌ها» می‌ماند.
 */
export function useInvalidateLicences() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: PLUGIN_LICENCES_KEY });
    qc.invalidateQueries({ queryKey: ["bot-plugins"] });
    qc.invalidateQueries({ queryKey: ["bot-plugin-collections"] });
    qc.invalidateQueries({ queryKey: ["marketplace-pricing"] });
  };
}

/** انتقال یک لایسنس به بات دیگر. */
export function useMoveLicence() {
  const invalidate = useInvalidateLicences();
  return useMutation({
    mutationFn: ({ licenceId, botId }: { licenceId: string; botId: string }) =>
      customFetch<{ moved: boolean }>(`/api/plugin-licences/${licenceId}`, {
        method: "PATCH",
        body: JSON.stringify({ botId }),
      }),
    onSuccess: invalidate,
  });
}

/** خرید/نصب یک پلاگین روی یک باتِ انتخاب‌شده، با پرداخت از کیف پول. */
export function useBuyPluginForBot() {
  const invalidate = useInvalidateLicences();
  return useMutation({
    mutationFn: ({ botId, marketplaceItemId }: { botId: string; marketplaceItemId: string }) =>
      customFetch(`/api/bots/${botId}/plugins`, {
        method: "POST",
        body: JSON.stringify({ marketplaceItemId, payFromWallet: true }),
      }),
    onSuccess: invalidate,
  });
}

/** حذف یک لایسنس از یک بات (بدون بازگشت پول — همان رفتار قبلی). */
export function useRemoveLicence() {
  const invalidate = useInvalidateLicences();
  return useMutation({
    mutationFn: ({ botId, licenceId }: { botId: string; licenceId: string }) =>
      customFetch(`/api/bots/${botId}/plugins/${licenceId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
