/**
 * lib/emojiPackPricing.ts — منطقِ خالصِ (بدونِ DB) ترتیب و دسترسیِ پک‌هایِ ایموجی؛ جدا از مسیرها تا بدونِ pool تست شود.
 */

/** رایگان‌ها همیشه بالایِ پولی‌ها؛ داخلِ هر گروه ترتیبِ ورودی (sort_order) حفظ می‌شود (sort پایدار است). */
export function sortFreeFirst<T extends { free: boolean }>(packs: readonly T[]): T[] {
  return [...packs].sort((a, b) => Number(b.free) - Number(a.free));
}

/** آیا این کاربر می‌تواند پک را بدونِ پرداخت اضافه کند؟ رایگان، قبلاً خریده‌شده برایِ همین بات، یا سوپرادمین. */
export function canAddWithoutPaying(i: { priceToman: number; owned: boolean; isSuperAdmin: boolean }): boolean {
  return i.priceToman <= 0 || i.owned || i.isSuperAdmin;
}
