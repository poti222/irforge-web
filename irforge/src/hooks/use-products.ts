/**
 * use-products.ts — محصولات پلتفرم (بات، اکانت مجازی، کارت مجازی، API، حسابیار، مدرسه).
 *
 * IRFORGE_PRODUCTS_SECTION_PROMPT Phase 3 — `GET /api/products`/`GET
 * /api/products/:id`/`GET /api/product-categories` (api-server/src/routes/products.ts,
 * Phase 2) جایگزینِ `irforge/src/lib/bot-tiers.ts`ی هاردکد شدند: همان جدولی
 * که سرور موقعِ خرید/ارتقا از آن قیمت می‌گیرد (`getBotTierProduct()`)، حالا
 * منبعِ نمایش هم هست — عددی که کاربر می‌بیند و عددی که پرداخت می‌شود دیگر دو
 * جای جدا نیستند.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type ProductCategory = {
  id: string;
  labelFa: string;
  labelEn: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type Product = {
  id: string;
  categoryId: string;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  /** Toman — همان چیزی که formatToman انتظار دارد، سرور خودش از ریال تبدیل کرده. */
  price: number;
  isActive: boolean;
  icon: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export function useListProductCategories() {
  return useQuery({
    queryKey: ["product-categories"],
    queryFn: () => customFetch<ProductCategory[]>("/api/product-categories"),
    staleTime: 5 * 60_000,
  });
}

export function useListProducts(categoryId?: string) {
  return useQuery({
    queryKey: ["products", categoryId ?? "all"],
    queryFn: () =>
      customFetch<Product[]>(`/api/products${categoryId ? `?category=${encodeURIComponent(categoryId)}` : ""}`),
    staleTime: 60_000,
  });
}

export function useGetProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["product", id],
    queryFn: () => customFetch<Product>(`/api/products/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}
