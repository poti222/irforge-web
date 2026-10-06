/**
 * test/commandsMenu.test.mjs — منطقِ خالصِ ویرایشگرِ منوی «/»ِ تلگرام (`components/bots/commandsMenu.ts`).
 * لایوباگ ۲۰۲۶-۱۰-۰۶: منو باید همان‌طور که روی تلگرام هست دیده و قابلِ اضافه/حذف/ترتیب باشد.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const M = await import("../src/components/bots/commandsMenu.ts");
const e = (command, description = `d-${command}`) => ({ command, description });

test("addEntry: ته منو؛ تکراری/نامِ نامعتبر/سقف بدونِ تغییر؛ توضیحِ خالی = /نام", () => {
  const base = [e("a"), e("b")];
  assert.deepEqual(M.addEntry(base, "c", " توضیح ").map((m) => m.command), ["a", "b", "c"]);
  assert.equal(M.addEntry(base, "c", " توضیح ")[2].description, "توضیح");
  assert.equal(M.addEntry(base, "c", "")[2].description, "/c");
  assert.deepEqual(M.addEntry(base, "a", "x"), base, "تکراری");
  for (const bad of ["Bad", "با-فارسی", "a b", "", "x".repeat(33)]) assert.deepEqual(M.addEntry(base, bad, "x"), base, bad);
  const full = Array.from({ length: M.MENU_MAX }, (_, i) => e(`c${i}`));
  assert.equal(M.addEntry(full, "extra", "x").length, M.MENU_MAX, "سقفِ ۱۰۰");
  assert.equal(base.length, 2, "ورودی تغییر نمی‌کند");
});

test("removeEntry / setEntryDescription / moveEntry", () => {
  const base = [e("a"), e("b"), e("c")];
  assert.deepEqual(M.removeEntry(base, "b").map((m) => m.command), ["a", "c"]);
  assert.deepEqual(M.removeEntry(base, "zzz"), base);
  assert.equal(M.setEntryDescription(base, "b", "نو")[1].description, "نو");
  assert.equal(M.setEntryDescription(base, "b", "x".repeat(400))[1].description.length, M.MENU_DESC_MAX);
  assert.deepEqual(M.moveEntry(base, "c", "up").map((m) => m.command), ["a", "c", "b"]);
  assert.deepEqual(M.moveEntry(base, "a", "down").map((m) => m.command), ["b", "a", "c"]);
  assert.deepEqual(M.moveEntry(base, "a", "up"), base, "لبه‌یِ بالا");
  assert.deepEqual(M.moveEntry(base, "c", "down"), base, "لبه‌یِ پایین");
  assert.deepEqual(M.moveEntry(base, "zzz", "up"), base);
});

test("sameMenu: ترتیب و توضیح مهم است (dirty درست تشخیص داده شود)", () => {
  assert.equal(M.sameMenu([e("a"), e("b")], [e("a"), e("b")]), true);
  assert.equal(M.sameMenu([e("a"), e("b")], [e("b"), e("a")]), false);
  assert.equal(M.sameMenu([e("a")], [e("a", "other")]), false);
  assert.equal(M.sameMenu([], [e("a")]), false);
  assert.equal(M.sameMenu([], []), true);
});

test("toPayload: توضیحِ خالی با /نام پر می‌شود", () => {
  assert.deepEqual(M.toPayload([e("a", "  "), e("b", " x ")]), [e("a", "/a"), e("b", "x")]);
});

test("قاعده‌یِ نام با سرور یکی است (MENU_NAME_RE ≡ api-server MENU_NAME_RE)", () => {
  const server = fs.readFileSync(new URL("../../api-server/src/routes/botCommands.ts", import.meta.url), "utf8");
  assert.ok(server.includes(`const MENU_NAME_RE = ${M.MENU_NAME_RE.toString()};`), "MENU_NAME_RE در سرور فرق کرده");
  assert.ok(server.includes(`const MENU_MAX = ${M.MENU_MAX};`));
});

test("CommandsEditor هیچ‌جا ردیفِ خودکار نمی‌سازد: فقط روت‌هایِ صریحِ مالک را صدا می‌زند", () => {
  const src = fs.readFileSync(new URL("../src/components/bots/CommandsEditor.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("/commands/menu"), "ذخیره‌یِ کلِ منو");
  assert.ok(!src.includes("/commands/${command}/menu"), "سوییچ‌ها دیگر تکی روی تلگرام نمی‌نویسند؛ پیش‌نویس + ذخیره");
});
