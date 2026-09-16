/**
 * test/tutorialFullPageContent.test.mjs — IRFORGE_TUTORIAL_SYSTEM_PROMPT
 * (full-page variant for Panels/Forms).
 *
 * همان قفلِ tutorialContent.test.mjs، برایِ FULL_PAGE_TUTORIALS
 * (lib/tutorials/fullPageContent.ts): هر بخش حداقل یک زیربخش دارد، هر
 * زیربخش حداقل یک قدم، هر قدم عنوان/تصویر/متنِ غیرخالی دارد، و تصویرها
 * واقعاً روی دیسک‌اند.
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { FULL_PAGE_TUTORIALS } = await import("../src/lib/tutorials/fullPageContent.ts");

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

test("پنل‌ها و فرم‌ها هر دو در FULL_PAGE_TUTORIALS تعریف شده‌اند", () => {
  assert.ok(Array.isArray(FULL_PAGE_TUTORIALS.panels) && FULL_PAGE_TUTORIALS.panels.length > 0);
  assert.ok(Array.isArray(FULL_PAGE_TUTORIALS.forms) && FULL_PAGE_TUTORIALS.forms.length > 0);
});

test("هر بخش حداقل یک زیربخش دارد و هر زیربخش حداقل یک قدم", () => {
  for (const [section, subsections] of Object.entries(FULL_PAGE_TUTORIALS)) {
    assert.ok(subsections.length > 0, `${section} باید حداقل یک زیربخش داشته باشد`);
    for (const [i, sub] of subsections.entries()) {
      assert.ok(sub.heading?.trim(), `${section}[${i}].heading خالی است`);
      assert.ok(Array.isArray(sub.steps) && sub.steps.length > 0, `${section}[${i}] باید حداقل یک قدم داشته باشد`);
    }
  }
});

test("هر قدم عنوان/تصویر/متنِ غیرخالی دارد", () => {
  for (const [section, subsections] of Object.entries(FULL_PAGE_TUTORIALS)) {
    for (const sub of subsections) {
      for (const [i, step] of sub.steps.entries()) {
        assert.ok(step.title?.trim(), `${section}/${sub.heading}[${i}].title خالی است`);
        assert.ok(step.image?.trim(), `${section}/${sub.heading}[${i}].image خالی است`);
        assert.ok(step.body?.trim(), `${section}/${sub.heading}[${i}].body خالی است`);
      }
    }
  }
});

test("تصویرِ هر قدم واقعاً روی دیسک هست — نه یک mockup، نه یک مسیرِ شکسته", () => {
  for (const [section, subsections] of Object.entries(FULL_PAGE_TUTORIALS)) {
    for (const sub of subsections) {
      for (const [i, step] of sub.steps.entries()) {
        const onDisk = path.join(PUBLIC_DIR, step.image.replace(/^\//, ""));
        assert.ok(existsSync(onDisk), `${section}/${sub.heading}[${i}].image (${step.image}) روی دیسک نیست: ${onDisk}`);
      }
    }
  }
});
