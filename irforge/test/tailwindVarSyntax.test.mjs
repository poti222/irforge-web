/**
 * test/tailwindVarSyntax.test.mjs — لیست‌هایِ بازشونده (Select/Popover/Dropdown…) باید سقفِ ارتفاع و اسکرول داشته باشند.
 *
 * باگِ واقعی («وقتی می‌خواهی دکمه/پنل انتخاب کنی همه‌چیز می‌آید و اسکرول نمی‌شود»): پروژه Tailwind v4 است ولی
 * کلاس‌هایِ shadcn با سینتکسِ v3 نوشته شده بودند — `max-h-[--radix-select-content-available-height]`. در v4 این شکل
 * دیگر خودکار `var()` نمی‌شود و CSSِ نامعتبر می‌سازد (`max-height: --radix-…`)؛ پس لیست سقف نداشت، از صفحه بیرون
 * می‌زد و اسکرول نمی‌شد (موبایل و دسکتاپ). شکلِ درست: `max-h-[var(--x)]` یا `max-h-(--x)`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("هیچ کلاسِ Tailwind با سینتکسِ v3 برایِ متغیرِ CSS (`[--x]`) باقی نمانده است", () => {
  const bad = [];
  for (const f of walk(SRC)) {
    const text = fs.readFileSync(f, "utf8");
    // `[--x]` یا `[--x_y]` ؛ اعلانِ مستقیمِ متغیر (`[--cell-size:2rem]`) با «:» معتبر است و نمی‌خورد.
    for (const m of text.matchAll(/\[(--[A-Za-z0-9_-]+)\]/g)) bad.push(`${path.relative(SRC, f)}: ${m[0]}`);
  }
  assert.deepEqual(bad, [], `از [var(--x)] یا (--x) استفاده کنید:\n${bad.join("\n")}`);
});

test("Select/Popover/DropdownMenu: سقفِ ارتفاعِ معتبر + اسکرول", () => {
  const read = (n) => fs.readFileSync(path.join(SRC, "components/ui", n), "utf8");
  assert.match(read("select.tsx"), /max-h-\[min\(var\(--radix-select-content-available-height\),24rem\)\]/);
  assert.match(read("select.tsx"), /overflow-y-auto/);
  assert.match(read("popover.tsx"), /max-h-\[var\(--radix-popover-content-available-height\)\]/);
  assert.match(read("dropdown-menu.tsx"), /max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/);
  assert.match(read("context-menu.tsx"), /max-h-\[var\(--radix-context-menu-content-available-height\)\]/);
  assert.match(read("menubar.tsx"), /max-h-\[var\(--radix-menubar-content-available-height\)\]/);
});
