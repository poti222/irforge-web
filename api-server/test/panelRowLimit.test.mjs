/**
 * test/panelRowLimit.test.mjs — سقف ۴ دکمه در هر ردیف.
 *
 * سقف در **دو جا** تعریف شده — یکی برای UI و یکی برای سرور — چون کلاینت و
 * سرور یک ماژول مشترک ندارند. این تست تضمین می‌کند آن دو از هم جدا نیفتند:
 * اگر کسی فقط یکی را عوض کند، یا UI اجازه‌ی چیزی را می‌دهد که سرور ذخیره‌اش
 * را رد می‌کند، یا برعکس، UI جلوی چیزی را می‌گیرد که کاملاً مجاز است.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const client = await import("../../irforge/src/lib/panel-buttons.ts");
const server = await import("../src/lib/botTypes.ts");

const b = (label) => client.emptyButton({ label });

test("سقف کلاینت و سرور یکی است", () => {
  assert.equal(client.MAX_BUTTONS_PER_ROW, server.MAX_BUTTONS_PER_ROW);
  assert.equal(server.MAX_BUTTONS_PER_ROW, 4);
});

test("ردیف پر، دکمه‌ی جدید نمی‌پذیرد", () => {
  const full = [[b("۱"), b("۲"), b("۳"), b("۴")]];
  assert.equal(client.canAddToRow(full, 0), false);
  // no-op است، نه throw — و آرایه‌ی قبلی دست‌نخورده برمی‌گردد.
  assert.equal(client.addButton(full, 0, b("۵")), full);
});

test("ردیفی که هنوز جا دارد، دکمه را می‌پذیرد", () => {
  const rows = [[b("۱"), b("۲"), b("۳")]];
  assert.equal(client.canAddToRow(rows, 0), true);
  assert.equal(client.addButton(rows, 0, b("۴"))[0].length, 4);
});

test("جابه‌جایی عمودی نمی‌تواند ردیف مقصد را از سقف رد کند", () => {
  const rows = [
    [b("۱"), b("۲"), b("۳"), b("۴")],
    [b("۵")],
  ];
  // بردن «۵» به ردیف بالا آن را ۵تایی می‌کرد — باید بی‌اثر باشد.
  assert.equal(client.moveButtonVertically(rows, 1, 0, -1), rows);
});

test("جابه‌جایی عمودی به ردیفی که جا دارد کار می‌کند", () => {
  const rows = [
    [b("۱"), b("۲")],
    [b("۳")],
  ];
  const moved = client.moveButtonVertically(rows, 1, 0, -1);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].length, 3);
});

test("findOverfullRow سرور ردیف متخلف را با شماره‌ی ۱-پایه پیدا می‌کند", () => {
  const ok = client.rowsToButtons([[b("۱"), b("۲")], [b("۳")]]);
  assert.equal(server.findOverfullRow(ok), null);

  // ردیف دوم ۵ دکمه دارد.
  const bad = client.rowsToButtons([
    [b("۱")],
    [b("۲"), b("۳"), b("۴"), b("۵"), b("۶")],
  ]);
  assert.deepEqual(server.findOverfullRow(bad), { row: 2, count: 5 });
});

test("ردیفِ دقیقاً پر (۴تایی) مجاز است", () => {
  const exact = client.rowsToButtons([[b("۱"), b("۲"), b("۳"), b("۴")]]);
  assert.equal(server.findOverfullRow(exact), null);
});

test("سقف روی لیست تختِ خام هم اعمال می‌شود، نه فقط روی مدل ردیف‌ها", () => {
  // شکلی که مستقیم از API می‌آید: بدون row_start، فقط با row.
  const flat = Array.from({ length: 5 }, (_, i) => ({
    label: `د${i}`, action: "panel", value: "", row: 0, col: i, row_start: i === 0, style: "",
  }));
  assert.deepEqual(server.findOverfullRow(flat), { row: 1, count: 5 });
});
