/**
 * scripts/migrateWalletTopups.mjs — مهاجرتِ شارژِ کیف‌پولِ قدیمیِ پلتفرم به ماژولِ کارت‌به‌کارتِ خودکار (فاز ۸).
 *
 *   DATABASE_URL=… node --import tsx/esm scripts/migrateWalletTopups.mjs [--dry-run] [--report path.md] [--json]
 *
 * idempotent است (اجرای دوباره چیزی نمی‌سازد)، `--dry-run` گزارشِ واقعی می‌دهد ولی rollback می‌کند.
 * کد خروج: ۰ = کامل و بدونِ ردیفِ یتیم؛ ۱ = ناقص/یتیم؛ ۲ = خطا. (سرور هم همین کار را در بوت انجام می‌دهد —
 * این اسکریپت برایِ گرفتنِ گزارشِ قابل‌آرشیو و اجرای دستی است.)
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL لازم است"); process.exit(2); }
const { migrateLegacyWalletTopups, formatMigrationReport } = await import("../src/lib/walletTopupMigration.ts");
const pg = await import("pg");
const Pool = pg.default?.Pool ?? pg.Pool;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const report = await migrateLegacyWalletTopups(pool, { dryRun: flag("--dry-run") });
  const md = formatMigrationReport(report);
  if (flag("--json")) console.log(JSON.stringify(report, null, 2)); else console.log(md);
  const out = val("--report");
  if (out) { fs.writeFileSync(out, md); console.error(`گزارش نوشته شد: ${out}`); }
  process.exitCode = report.ok || report.skipped ? 0 : 1;
} catch (err) {
  console.error("مهاجرت با خطا مواجه شد:", err);
  process.exitCode = 2;
} finally {
  await pool.end();
}
