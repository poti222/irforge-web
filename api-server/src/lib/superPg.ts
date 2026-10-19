/**
 * lib/superPg.ts — توابعِ خالصِ (بدونِ DB) بخشِ «دیتابیس Postgres» در /super.
 * جدا شده تا بدونِ اتصال قابلِ تست باشد. هیچ ورودیِ کاربر هرگز مستقیم داخل SQL نمی‌رود:
 * نامِ جدول/ستون فقط وقتی استفاده می‌شود که در فهرستِ واقعیِ دیتابیس باشد و با `quoteIdent` quote شود.
 */

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** ستون‌هایی که مقدارشان هرگز به مرورگر نمی‌رسد و از UI هم قابل‌نوشتن نیست. */
const SENSITIVE_RE = /(token|password|passwd|secret|hash|api_?key|private|credential|otp|session|salt|cookie|authorization)/i;
export function isSensitiveColumn(name: string): boolean {
  return SENSITIVE_RE.test(name);
}

export interface TableGroup {
  id: string;
  fa: string;
  order: number;
}

const GROUPS: { id: string; fa: string; test: RegExp }[] = [
  { id: "schools", fa: "مدارس", test: /^(schools?|school_|class_|classes$|exam|homework|attendance)/i },
  { id: "bots", fa: "ربات‌ها", test: /^(bots?|bot_|tenant|plugin|workflow|panel|form_|command)/i },
  { id: "users", fa: "کاربران و ورود", test: /^(users?|user_|sessions?|auth_|oauth|telegram|otp|login|identity|test_identit)/i },
  { id: "money", fa: "مالی و فروش", test: /^(wallet|payment|plans?|products?|discount|coupon|exchange|invoice|order|card_|transaction)/i },
  { id: "content", fa: "محتوا و اعلان", test: /^(announcement|update|notification|release|plugin_release|email)/i },
  { id: "support", fa: "پشتیبانی و ثبت‌نام", test: /^(tickets?|ticket_|pending_|registration|support)/i },
  { id: "infra", fa: "زیرساخت و ردپا", test: /^(sheet|sheets_|registry|entity_|cutover|admin_audit|audit|settings?|site_|super_|__)/i },
];

export function classifyTable(name: string): TableGroup {
  const idx = GROUPS.findIndex((g) => g.test.test(name));
  if (idx === -1) return { id: "other", fa: "سایر", order: GROUPS.length };
  return { id: GROUPS[idx]!.id, fa: GROUPS[idx]!.fa, order: idx };
}

export interface ColumnInfo {
  name: string;
  type: string;
  udt: string;
  nullable: boolean;
  hasDefault: boolean;
  isPk: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
}

export function isTextLike(udt: string): boolean {
  return ["text", "varchar", "bpchar", "citext", "name", "uuid", "int2", "int4", "int8", "numeric", "bool"].includes(udt);
}

/** `WHERE` برای جستجوی آزاد: OR روی همه‌ی ستون‌های غیرحساس (cast به text). */
export function buildSearchWhere(
  cols: ColumnInfo[],
  q: string,
  startIdx: number,
): { sql: string; params: unknown[] } | null {
  const term = q.trim();
  if (!term) return null;
  const searchable = cols.filter((c) => !isSensitiveColumn(c.name) && c.udt !== "bytea").slice(0, 25);
  if (searchable.length === 0) return null;
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const parts = searchable.map((c) => `${quoteIdent(c.name)}::text ILIKE $${startIdx}`);
  return { sql: `(${parts.join(" OR ")})`, params: [like] };
}

/** `ORDER BY` امن؛ ستونِ ناشناس نادیده گرفته می‌شود. */
export function buildOrderBy(cols: ColumnInfo[], sort: string | undefined, dir: string | undefined): string {
  const known = sort ? cols.find((c) => c.name === sort && !isSensitiveColumn(c.name)) : undefined;
  const direction = String(dir).toLowerCase() === "desc" ? "DESC" : "ASC";
  if (known) return `ORDER BY ${quoteIdent(known.name)} ${direction} NULLS LAST`;
  const pk = cols.filter((c) => c.isPk);
  if (pk.length > 0) return `ORDER BY ${pk.map((c) => quoteIdent(c.name)).join(", ")}`;
  return "";
}

/** ورودیِ UI → مقدارِ پارامتر. json/jsonb اگر رشته نباشد stringify می‌شود. */
export function coerceValue(col: ColumnInfo, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.udt === "json" || col.udt === "jsonb") return typeof v === "string" ? v : JSON.stringify(v);
  if (typeof v === "string" && v === "" && !["text", "varchar", "bpchar", "citext", "name"].includes(col.udt)) return null;
  return v;
}

/**
 * یک دستور (بدونِ `;` وسط). `;` پایانی حذف می‌شود. هر `;` دیگر — حتی داخل رشته — رد می‌شود
 * تا «COMMIT; …» نتواند تراکنشِ فقط‌خواندنی را بشکند.
 */
export function normalizeSingleStatement(sql: string): { ok: true; sql: string } | { ok: false; error: string } {
  let s = sql.trim();
  while (s.endsWith(";")) s = s.slice(0, -1).trimEnd();
  if (!s) return { ok: false, error: "دستور خالی است" };
  if (s.includes(";")) return { ok: false, error: "فقط یک دستور در هر اجرا مجاز است (علامت ; وسط دستور ممنوع است)" };
  return { ok: true, sql: s };
}

export function isReadQuery(sql: string): boolean {
  return /^\s*(select|with|values|table)\b/i.test(sql);
}
