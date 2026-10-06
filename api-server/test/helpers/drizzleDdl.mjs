/**
 * test/helpers/drizzleDdl.mjs — DDLِ ساده از روی تعریفِ drizzleِ جدول‌ها (برایِ تست‌هایِ زنده‌ی روت‌هایی که
 * `db` را از `@workspace/db` می‌گیرند و جدولِ آن‌ها در migrationهایِ آینه‌یِ test/helpers/cardPayDdl.mjs نیست).
 *
 * عمداً ساده: همه‌ی ستون‌ها nullable (به‌جز کلیدِ اصلی)، بدونِ FK و CHECK. فقط defaultهایِ ساده (now()/boolean/عدد/رشته)
 * ساخته می‌شوند تا `INSERT` هایِ drizzle (که ستونِ بی‌مقدار را DEFAULT می‌فرستد) مثلِ پروداکشن کار کنند.
 */
import { getTableConfig } from "drizzle-orm/pg-core";

export function ddlFor(...tables) {
  return tables.map((t) => {
    const cfg = getTableConfig(t);
    const cols = cfg.columns.map((c) => {
      let def = "";
      if (c.hasDefault) {
        const d = c.default;
        if (d && typeof d === "object") def = " DEFAULT now()";           // defaultNow()
        else if (typeof d === "boolean") def = ` DEFAULT ${d}`;
        else if (typeof d === "number") def = ` DEFAULT ${d}`;
        else if (typeof d === "string") def = ` DEFAULT '${d.replace(/'/g, "''")}'`;
      }
      return `  "${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.isUnique ? " UNIQUE" : ""}${def}`;
    });
    return `CREATE TABLE "${cfg.name}" (\n${cols.join(",\n")}\n);`;
  }).join("\n");
}
