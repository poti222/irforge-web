/**
 * test/tutorialContent.test.mjs — IRFORGE_TUTORIAL_SYSTEM_PROMPT.
 *
 * محتوایِ TUTORIALS (lib/tutorials/content.ts) و کلیدهایِ i18n مشترکِ
 * TutorialButton/TutorialDrawer را قفل می‌کند: هر بخش حداقل یک قدم دارد، هر
 * قدم عنوان/تصویر/متن دارد، تصویرها واقعاً روی دیسک هستند (اسکرین‌شاتِ
 * واقعی، نه یک مسیرِ تایپی که هیچ‌وقت لود نمی‌شود)، و namespace «tutorial»
 * دقیقاً همان کلیدها را در هر پنج locale دارد.
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { TUTORIALS } = await import("../src/lib/tutorials/content.ts");

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

test("هر بخشِ آموزشی حداقل یک قدم دارد", () => {
  for (const [section, steps] of Object.entries(TUTORIALS)) {
    assert.ok(Array.isArray(steps) && steps.length > 0, `${section} باید حداقل یک قدم داشته باشد`);
  }
});

test("هر قدم عنوان/تصویر/متنِ غیرخالی دارد", () => {
  for (const [section, steps] of Object.entries(TUTORIALS)) {
    for (const [i, step] of steps.entries()) {
      assert.ok(step.title?.trim(), `${section}[${i}].title خالی است`);
      assert.ok(step.image?.trim(), `${section}[${i}].image خالی است`);
      assert.ok(step.body?.trim(), `${section}[${i}].body خالی است`);
    }
  }
});

test("تصویرِ هر قدم واقعاً روی دیسک هست — نه یک mockup، نه یک مسیرِ شکسته", () => {
  for (const [section, steps] of Object.entries(TUTORIALS)) {
    for (const [i, step] of steps.entries()) {
      const onDisk = path.join(PUBLIC_DIR, step.image.replace(/^\//, ""));
      assert.ok(existsSync(onDisk), `${section}[${i}].image (${step.image}) روی دیسک نیست: ${onDisk}`);
    }
  }
});

test("namespace «tutorial» در هر پنج locale دقیقاً همان کلیدها را دارد", async () => {
  const langs = ["en", "fa", "ar", "tr", "ru"];
  const locales = await Promise.all(langs.map((l) => import(`../src/locales/${l}.json`, { with: { type: "json" } })));
  const [enKeys, ...rest] = locales.map((m) => Object.keys(m.default.tutorial ?? {}).sort());
  assert.ok(enKeys.length > 0, "en.json باید namespace «tutorial» داشته باشد");
  rest.forEach((keys, i) => {
    assert.deepEqual(keys, enKeys, `کلیدهایِ tutorial در ${langs[i + 1]}.json با en.json فرق دارد`);
  });
});
