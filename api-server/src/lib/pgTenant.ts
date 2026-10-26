/**
 * lib/pgTenant.ts — تننتِ «فقط-Postgres» (بدونِ Google Sheet).
 *
 * باتِ جدید دیگر شیتی از pool نمی‌گیرد. ستونِ `bots.sheet_id` برایش یک شناسه‌ی داخلیِ
 * `pg_<botId بدون خط‌تیره>` نگه می‌دارد که فقط «کلیدِ تننت» است (همان `tenant_id` در جدول‌های
 * Postgres و در `entity_cutover_flags`) و به هیچ اسپردشیتی اشاره نمی‌کند.
 *
 * قرارداد: برای چنین تننتی هیچ کدی اجازه ندارد به Google Sheets دست بزند؛ همه‌ی entityها همیشه
 * روی Postgres هستند و پرچم‌های cutover هم در لحظه‌ی ساخت با `forceTenantToPostgres` ست می‌شوند
 * (تا mainbot هم که فقط پرچم‌ها را می‌خواند همان مسیر را برود).
 */
export const PG_TENANT_PREFIX = "pg_";

export function newPgTenantId(botId: string): string {
  return `${PG_TENANT_PREFIX}${botId.replace(/-/g, "")}`;
}

export function isPgTenant(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PG_TENANT_PREFIX);
}
