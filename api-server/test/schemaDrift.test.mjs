/**
 * test/schemaDrift.test.mjs — اسکیمای Drizzle و migrate.mjs باید یکی بمانند.
 *
 * چرا این تست وجود دارد
 * ─────────────────────
 * جدول `marketplace_items` در `migrate.mjs` با یک مجموعه‌ستون ساخته می‌شد و در
 * `lib/db/src/schema/marketplace.ts` با یک مجموعه‌ی دیگر اعلام شده بود. شش ستونی
 * که اسکیما اعلام می‌کرد (`is_free`, `author`, `install_count`, `tags`, `icon`,
 * `featured`) هرگز در دیتابیس ساخته نشده بودند.
 *
 * هیچ‌کس متوجه نشد چون هیچ‌چیز روی آن جدول نمی‌نوشت. و چون Drizzle در SELECT هم
 * نام همه‌ی ستون‌ها را صریح می‌آورد، `GET /marketplace/items` عملاً **خطا**
 * می‌داد نه «لیست خالی». تنها چیزی که آشکارش کرد، اضافه‌شدن sync پلاگین‌ها بود —
 * یعنی این drift می‌توانست ماه‌ها بی‌صدا بماند.
 *
 * این تست فایل‌محور است (نه دیتابیس‌محور) تا مثل بقیه‌ی تست‌های این پروژه بدون
 * Postgres واقعی اجرا شود: ستون‌های اعلام‌شده در اسکیما را از سورس درمی‌آورد و
 * چک می‌کند مایگریشن تضمینشان کرده باشد.
 *
 * ⚠️ **دو فایل `migrate.mjs` وجود دارد** و این تله‌ای است که یک بار افتادم:
 * `api-server/migrate.mjs` آن است که `start.sh` اجرا می‌کند، و `migrate.mjs`
 * در ریشه یک نسخه‌ی کهنه‌ی بی‌استفاده است. اصلاح اول من به فایل ریشه رفت،
 * دیپلوی شد، `[migrate] Done.` چاپ شد و ستون همچنان وجود نداشت. پس مسیر
 * مایگریشن اینجا **از خودِ start.sh استخراج می‌شود**، نه هاردکد — تا این تست
 * هرگز فایل اشتباهی را تأیید نکند.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const schemaDir = new URL("../../lib/db/src/schema/", import.meta.url);

/**
 * مسیر مایگریشنی که واقعاً در پروداکشن اجرا می‌شود — از `start.sh` خوانده
 * می‌شود تا اگر روزی عوض شد، این تست هم با آن جابه‌جا شود.
 */
function resolveMigratePath() {
  const startSh = fs.readFileSync(new URL("../../start.sh", import.meta.url), "utf8");
  const match = startSh.match(/node\s+\S*?([\w./-]*migrate\.mjs)/);
  assert.ok(match, "در start.sh دستور اجرای migrate.mjs پیدا نشد");
  // مسیر داخل کانتینر (/app/api-server/migrate.mjs) → مسیر معادل در ریپو.
  const inRepo = match[1].replace(/^\/app\//, "");
  return new URL(`../../${inRepo}`, import.meta.url);
}

const migratePath = resolveMigratePath();
const migrateSql = fs.readFileSync(migratePath, "utf8");

/** ستون‌هایی که migrate.mjs برای یک جدول تضمین می‌کند (CREATE + ALTER). */
function migratedColumns(table) {
  const columns = new Set();

  // بدنه‌ی CREATE TABLE
  const created = migrateSql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([^;]*)\\)\\s*;`, "i"),
  );
  if (created) {
    for (const line of created[1].split("\n")) {
      const match = line.match(/^\s*([a-z_]+)\s+(TEXT|REAL|INTEGER|BIGINT|BOOLEAN|TIMESTAMPTZ|JSONB|SERIAL)/i);
      if (match) columns.add(match[1]);
    }
  }

  // هر ALTER … ADD COLUMN روی همین جدول
  const alterPattern = new RegExp(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ([a-z_]+)`, "gi",
  );
  for (const match of migrateSql.matchAll(alterPattern)) columns.add(match[1]);

  return columns;
}

/** ستون‌هایی که یک جدولِ Drizzle اعلام می‌کند. */
function schemaColumns(file, tableConst) {
  const source = fs.readFileSync(new URL(file, schemaDir), "utf8");
  const start = source.indexOf(`export const ${tableConst}`);
  assert.ok(start >= 0, `${tableConst} در ${file} پیدا نشد`);

  // تا اولین `export const` بعدی، یعنی فقط همین جدول.
  const rest = source.slice(start + 10);
  const end = rest.indexOf("export const");
  const block = end >= 0 ? rest.slice(0, end) : rest;

  // الگو: fieldName: type("column_name" …)
  const columns = new Set();
  for (const match of block.matchAll(/^\s+\w+:\s*\w+\(\s*"([a-z_]+)"/gm)) {
    columns.add(match[1]);
  }
  return columns;
}

/**
 * جدول‌هایی که این تست پوشش می‌دهد.
 *
 * عمداً محدود به جدول‌هایی است که کد این فاز رویشان می‌نویسد. بردن این تست روی
 * *همه‌ی* جدول‌ها احتمالاً drift های قدیمیِ دیگری را هم بیرون می‌آورد — که خبر
 * خوبی است، ولی دامنه‌ی این تغییر نیست و نباید سوییت را با چیزی که این فاز
 * نشکسته قرمز کند.
 */
const COVERED = [
  { file: "marketplace.ts", table: "marketplace_items", constName: "marketplaceItemsTable" },
  { file: "marketplace.ts", table: "installed_plugins", constName: "installedPluginsTable" },
];

for (const { file, table, constName } of COVERED) {
  test(`هر ستونِ ${constName} در migrate.mjs تضمین شده`, () => {
    const declared = schemaColumns(file, constName);
    const migrated = migratedColumns(table);

    assert.ok(declared.size > 0, `هیچ ستونی از ${constName} استخراج نشد`);
    assert.ok(migrated.size > 0, `جدول ${table} در migrate.mjs پیدا نشد`);

    const missing = [...declared].filter((column) => !migrated.has(column));
    assert.deepEqual(
      missing, [],
      `این ستون‌ها در اسکیما هستند ولی migrate.mjs نمی‌سازدشان: ${missing.join(", ")}. ` +
      `یک INSERT/SELECT روی ${table} در پروداکشن خطا می‌دهد.`,
    );
  });
}

test("مسیر مایگریشنِ تست، همانی است که start.sh اجرا می‌کند", () => {
  // نگهبانِ همان اشتباه: اصلاح به فایل ریشه رفت و تست سبز بود، در حالی که
  // پروداکشن فایل دیگری را اجرا می‌کرد.
  assert.match(
    migratePath.pathname, /api-server\/migrate\.mjs$/,
    "تست باید همان فایلی را بخواند که start.sh اجرا می‌کند",
  );
});

test("ستون‌هایی که این باگ را ساختند، مشخصاً پوشش داده شده‌اند", () => {
  // نگهبانِ صریح برای همان شش ستون، تا اگر روزی حلقه‌ی بالا عوض/ساده شد،
  // این مورد خاص بی‌محافظ نماند.
  const migrated = migratedColumns("marketplace_items");
  for (const column of ["is_free", "author", "install_count", "tags", "icon", "featured"]) {
    assert.ok(migrated.has(column), `ستون ${column} باید در migrate.mjs باشد`);
  }
});
