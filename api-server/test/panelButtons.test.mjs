/**
 * test/panelButtons.test.mjs — round-trip چیدمان دکمه‌های پنل (فاز ۹).
 *
 * معیار پایان فاز ۹: «تست واحد بگذار که round-trip بدون تغییر باشد».
 *
 * چرا اینجا و نه کنار خود کامپوننت: پکیج `irforge` هیچ test runnerی ندارد
 * (`package.json`ش فقط dev/build/typecheck دارد) و اضافه‌کردن یکی، کاری خارج از
 * این فاز است. `api-server` از قبل `node --test` با لودر tsx دارد، پس ماژول
 * فرانت مستقیم از روی سورس import می‌شود.
 *
 * این تست هم‌زمان **هم‌ارزی دو پیاده‌سازی** را هم چک می‌کند: ماژول کلاینت
 * (`irforge/src/lib/panel-buttons.ts`) و ماژول سرور (`botTypes.ts`) باید روی
 * هر ورودی خروجی یکسان بدهند، وگرنه UI چیزی نشان می‌دهد که سرور جور دیگری
 * ذخیره می‌کند.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const client = await import("../../irforge/src/lib/panel-buttons.ts");
const server = await import("../src/lib/botTypes.ts");

const b = (label, extra = {}) => client.emptyButton({ label, ...extra });

test("round-trip: rows → flat → rows بدون تغییر", () => {
  const rows = [
    [b("الف"), b("ب")],
    [b("ج")],
    [b("د"), b("ه"), b("و")],
  ];
  const flat = client.rowsToButtons(rows);
  const back = client.buttonsToRows(flat);
  assert.deepEqual(
    back.map((r) => r.map((x) => x.label)),
    rows.map((r) => r.map((x) => x.label))
  );
  // و دوباره: باید idempotent باشد.
  assert.deepEqual(client.rowsToButtons(back), flat);
});

test("round-trip: flat → rows → flat بدون تغییر", () => {
  const flat = client.normalizeButtonLayout([
    b("۱", { row_start: true }),
    b("۲", { row_start: false }),
    b("۳", { row_start: true }),
  ]);
  assert.deepEqual(client.rowsToButtons(client.buttonsToRows(flat)), flat);
});

test("row/col از row_start بازسازی می‌شوند (معادل _apply_row_starts)", () => {
  const flat = client.rowsToButtons([[b("الف"), b("ب")], [b("ج")]]);
  assert.deepEqual(
    flat.map((x) => [x.label, x.row, x.col, x.row_start]),
    [
      ["الف", 0, 0, true],
      ["ب", 0, 1, false],
      ["ج", 1, 0, true],
    ]
  );
});

test("دکمه‌های قدیمیِ بدون row_start از روی row گروه می‌شوند (معادل _migrate_row_starts)", () => {
  const legacy = [
    { label: "۱", action: "panel", value: "", row: 0, col: 0, style: "" },
    { label: "۲", action: "panel", value: "", row: 0, col: 1, style: "" },
    { label: "۳", action: "panel", value: "", row: 1, col: 0, style: "" },
    { label: "۴", action: "panel", value: "", row: 3, col: 0, style: "" },
  ];
  assert.deepEqual(
    client.buttonsToRows(legacy).map((r) => r.map((x) => x.label)),
    [["۱", "۲"], ["۳"], ["۴"]],
    "شکاف در شماره‌ی ردیف (۱ → ۳) نباید ردیف خالی بسازد"
  );
});

test("کلاینت و سرور دقیقاً یک خروجی می‌دهند", () => {
  const inputs = [
    [],
    [b("تک")],
    client.rowsToButtons([[b("الف"), b("ب")], [b("ج")]]),
    [
      { label: "۱", action: "panel", value: "p", row: 5, col: 9, style: "success" },
      { label: "۲", action: "url", value: "https://x.dev", row: 5, col: 0, style: "" },
      { label: "۳", action: "phone", value: "", row: 7, col: 0, style: "danger" },
    ],
  ];
  for (const input of inputs) {
    assert.deepEqual(
      client.normalizeButtonLayout(input),
      server.normalizeButtonLayout(input),
      "normalizeButtonLayout کلاینت و سرور باید یکی باشند"
    );
    assert.deepEqual(client.rowsToButtons(client.buttonsToRows(input)), server.rowsToButtons(server.buttonsToRows(input)));
  }
});

test("style و icon_custom_emoji_id در round-trip گم نمی‌شوند", () => {
  const flat = client.rowsToButtons([
    [b("خرید", { style: "success", icon_custom_emoji_id: "5368324170671202286" })],
  ]);
  assert.equal(flat[0].style, "success");
  assert.equal(flat[0].icon_custom_emoji_id, "5368324170671202286");
  assert.equal(client.buttonsToRows(flat)[0][0].icon_custom_emoji_id, "5368324170671202286");
});

test("ردیف خالی در ذخیره حذف می‌شود و شماره‌ی ردیف‌ها را نمی‌شکند", () => {
  const rows = [[b("الف")], [], [b("ب")]];
  const flat = client.rowsToButtons(rows);
  assert.deepEqual(
    flat.map((x) => [x.label, x.row]),
    [["الف", 0], ["ب", 1]],
    "ردیف خالی نباید یک شماره‌ی ردیفِ خالی روی شیت بسازد"
  );
});

test("جابه‌جایی عمودی: دکمه به ردیف بالا/پایین می‌رود و ردیف خالی جمع می‌شود", () => {
  let rows = [[b("الف"), b("ب")], [b("ج")]];

  // «ب» به ردیف پایین
  rows = client.moveButtonVertically(rows, 0, 1, 1);
  assert.deepEqual(rows.map((r) => r.map((x) => x.label)), [["الف"], ["ج", "ب"]]);

  // «الف» به بالا → یک ردیف جدید بالای همه ساخته می‌شود
  rows = client.moveButtonVertically(rows, 0, 0, -1);
  assert.deepEqual(rows.map((r) => r.map((x) => x.label)), [["الف"], ["ج", "ب"]], "ردیفِ خالی‌شده حذف می‌شود");

  // «ج» به بالا
  rows = client.moveButtonVertically(rows, 1, 0, -1);
  assert.deepEqual(rows.map((r) => r.map((x) => x.label)), [["الف", "ج"], ["ب"]]);
});

test("جابه‌جایی افقی فقط داخل همان ردیف و بدون خروج از مرز", () => {
  const rows = [[b("الف"), b("ب"), b("ج")]];
  assert.deepEqual(
    client.moveButtonHorizontally(rows, 0, 0, 1).map((r) => r.map((x) => x.label)),
    [["ب", "الف", "ج"]]
  );
  assert.deepEqual(
    client.moveButtonHorizontally(rows, 0, 0, -1).map((r) => r.map((x) => x.label)),
    [["الف", "ب", "ج"]],
    "حرکت به بیرون از مرز باید no-op باشد"
  );
});

test("overfullRows ردیف پر از حد را پیدا می‌کند", () => {
  const many = Array.from({ length: 9 }, (_, i) => b(`b${i}`));
  assert.deepEqual(client.overfullRows([[b("ok")], many]), [1]);
  assert.deepEqual(client.overfullRows([[b("ok")]]), []);
});
