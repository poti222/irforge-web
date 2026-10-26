/**
 * lib/sheetsForceCutover.ts — دکمه‌ی «اجبارِ همه به Postgres» در صفحه‌ی Sheets Import.
 *
 * مشکل: ایمپورتِ عادی (worker بات) برای خیلی از بات‌ها «Partial» تمام می‌شود (مثلاً ۶۹/۸۳ یا ۰/۸۳) و entityهای
 * ناموفق هیچ‌وقت روی Postgres نمی‌روند. این ماژول برای هر تننت **همه‌ی** entityهایی را که هنوز `use_db=true` نیستند
 * روشن می‌کند: هرچه قبلاً از شیت کپی شده سر جایش می‌ماند، و entityهایی که دیتایی روی Postgres ندارند خالی ساخته
 * می‌شوند (بدونِ خطا). شیت دست‌نخورده می‌ماند (بکاپ) و پرچم‌ها از صفحه‌ی Cutover Flags برگشت‌پذیرند.
 */
import { getCutoverPool, invalidateCutoverCache } from "./botConfig.js";
import { CUTOVER_ENTITIES } from "./cutoverEntities.js";

export { planForce, type ForcePlan } from "./sheetsForcePlan.js";

/**
 * همه‌ی entityهای این تننت را `use_db=true` می‌کند (override تک‌تننتی). یک statement، اتمیک و مستقل از اینکه
 * ایندکسِ یکتای ردیف‌های تننت‌دار چیست (UPDATE + INSERT … WHERE NOT EXISTS). تعدادِ ردیف‌های تغییرکرده را برمی‌گرداند.
 * روی خطا throw می‌کند — مثل `setEntityUseDb`، سکوت در یک نوشتنِ ادمین بدتر از خطای صریح است.
 */
export async function forceTenantToPostgres(tenantId: string): Promise<number> {
  const pool = getCutoverPool();
  if (!pool) {
    throw new Error("BUSINESS_DATABASE_URL روی این محیط تنظیم نشده — نوشتنِ cutover flag ممکن نیست.");
  }
  const { rows } = await pool.query(
    `WITH upd AS (
       UPDATE entity_cutover_flags SET use_db = true, updated_at = now()
       WHERE tenant_id = $1 AND use_db = false
       RETURNING entity_name
     ), ins AS (
       INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db, updated_at)
       SELECT e, $1, true, now() FROM unnest($2::text[]) AS e
       WHERE NOT EXISTS (SELECT 1 FROM entity_cutover_flags f WHERE f.tenant_id = $1 AND f.entity_name = e)
       RETURNING entity_name
     )
     SELECT (SELECT count(*) FROM upd) + (SELECT count(*) FROM ins) AS flipped`,
    [tenantId, [...CUTOVER_ENTITIES]]
  );
  invalidateCutoverCache();
  return Number(rows[0]?.flipped ?? 0);
}

/** حذفِ همه‌ی پرچم‌های cutoverِ یک تننت (هنگامِ حذفِ باتِ `pg_…`، تا ردیفِ یتیم نماند). */
export async function removeTenantCutoverFlags(tenantId: string): Promise<number> {
  const pool = getCutoverPool();
  if (!pool) return 0;
  const res = await pool.query("DELETE FROM entity_cutover_flags WHERE tenant_id = $1", [tenantId]);
  invalidateCutoverCache();
  return res.rowCount ?? 0;
}
