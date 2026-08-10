import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

/** جزئیات کامل یک آپدیت، همراه بدنه‌ی عکس‌ها (فقط endpointهای جزئیات). */
export type SiteUpdateDetail = {
  id: string;
  version: string | null;
  title: string;
  body: string;
  publishedAt: string | null;
  images: string[];
};

/**
 * جدیدترین آپدیتِ منتشرشده‌ای که کاربر فعلی ندیده.
 *
 * سرور `{ update: null }` با ۲۰۰ برمی‌گرداند وقتی چیزی برای نشان‌دادن نیست،
 * پس «هیچ آپدیتی نیست» یک حالت عادی است و نه خطا. staleTime بلند است چون
 * این پاسخ فقط با انتشار یک آپدیت جدید عوض می‌شود.
 */
export function useUnseenUpdate() {
  return useQuery({
    queryKey: ["update-unseen"],
    queryFn: () => customFetch<{ update: SiteUpdateDetail | null }>("/api/updates/unseen"),
    staleTime: 5 * 60_000,
  });
}
