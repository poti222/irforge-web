/** lib/sheetsForcePlan.ts — منطقِ خالصِ (بدونِ import و DB) تصمیمِ «اجبارِ همه به Postgres»؛ جدا از
 * sheetsForceCutover.ts تا بدونِ pool تست شود. */
export type ForcePlan = "no_sheet" | "in_flight" | "already_complete" | "never_imported" | "force_switch";

/**
 * تصمیمِ خالص (بدونِ DB) برای هر تننت:
 *  - بدونِ شیت → رد.
 *  - ایمپورت در جریان → دست نمی‌زنیم (worker وسطِ کپی است؛ فلیپِ هم‌زمان ممکن است entity را از کپی بیندازد).
 *  - همه‌ی entityها از قبل روی Postgres → کاری نیست.
 *  - هیچ‌وقت ایمپورت نشده و هیچ پرچمی روشن نیست → فقط صفِ ایمپورت (وگرنه دیتای شیتش بدونِ حتی یک تلاش رها می‌شد).
 *  - بقیه (Partial / Failed / ۰ از N بعد از تلاش) → فلیپِ اجباریِ همه.
 */
export function planForce(i: {
  hasSheet: boolean;
  inFlight: boolean;
  hasAnyRequest: boolean;
  postgresEntityCount: number;
  totalEntityCount: number;
}): ForcePlan {
  if (!i.hasSheet) return "no_sheet";
  if (i.inFlight) return "in_flight";
  if (i.totalEntityCount > 0 && i.postgresEntityCount >= i.totalEntityCount) return "already_complete";
  if (!i.hasAnyRequest && i.postgresEntityCount === 0) return "never_imported";
  return "force_switch";
}
