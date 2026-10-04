/**
 * lib/schools-content-sections.ts — تقسیمِ آیتم‌هایِ یک درس به «بخش»هایِ
 * ۲۰تایی، طبقِ قاعده‌یِ خودِ ریپویِ dars (CONFIGِ قدیمی‌اش واژگان را به
 * «بخش»هایِ تب‌دار تقسیم می‌کرد تا دانش‌آموز هیچ‌وقت با یک لیستِ یک‌تکه‌ی
 * بزرگ روبه‌رو نشود) — گزارشِ مستقیمِ کاربر: «اگر بیشتر از ۲۰ تا بود، به
 * گروه‌هایِ ۲۰تایی تقسیم کن».
 *
 * این قاعده فقط برایِ *مطالعه/نمایشِ دانش‌آموزی* است، نه مدیریتِ معلم — طبقِ
 * اسپک صریحاً: «لیستِ مدیریتیِ معلم می‌تواند یک‌لیستِ‌کامل بماند».
 */
export const CONTENT_SECTION_SIZE = 20;

export function chunkIntoSections<T>(items: T[], size: number = CONTENT_SECTION_SIZE): T[][] {
  if (items.length === 0) return [];
  const sections: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    sections.push(items.slice(i, i + size));
  }
  return sections;
}
