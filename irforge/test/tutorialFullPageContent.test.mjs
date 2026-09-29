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
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { FULL_PAGE_TUTORIALS, FULL_PAGE_META } = await import("../src/lib/tutorials/fullPageContent.ts");

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

test("پنل‌ها، فرم‌ها و کارت‌به‌کارت در FULL_PAGE_TUTORIALS تعریف شده‌اند", () => {
  assert.ok(Array.isArray(FULL_PAGE_TUTORIALS.panels) && FULL_PAGE_TUTORIALS.panels.length > 0);
  assert.ok(Array.isArray(FULL_PAGE_TUTORIALS.forms) && FULL_PAGE_TUTORIALS.forms.length > 0);
  assert.ok(Array.isArray(FULL_PAGE_TUTORIALS.cardpay) && FULL_PAGE_TUTORIALS.cardpay.length >= 6);
});

test("کارت‌به‌کارت: عنوان/مقدمه دارد و هر عکسِ پوشه‌یِ tutorials/cardpay در آموزش استفاده شده", () => {
  const meta = FULL_PAGE_META.cardpay;
  assert.ok(meta?.title?.trim() && meta?.intro?.trim(), "عنوان و مقدمه‌یِ cardpay خالی است");
  const used = new Set(
    FULL_PAGE_TUTORIALS.cardpay.flatMap((sec) => sec.steps.map((st) => st.image.replace(/^\/tutorials\/cardpay\//, ""))),
  );
  const onDisk = readdirSync(path.join(PUBLIC_DIR, "tutorials", "cardpay")).filter((f) => f.endsWith(".png"));
  const unused = onDisk.filter((f) => !used.has(f));
  assert.deepEqual(unused, [], `عکس‌هایِ استفاده‌نشده: ${unused.join(", ")}`);
});

test("کارت‌به‌کارت: فصل‌هایِ اصلی هست و «راه‌اندازی برایِ سایتِ خودتان» و «عیب‌یابی» جزوشان است", () => {
  const headings = FULL_PAGE_TUTORIALS.cardpay.map((s) => s.heading).join(" | ");
  for (const needle of ["راه‌اندازی برایِ سایتِ خودتان", "وصل کردنِ گوشی", "فروشنده", "مدیریتِ روزمره", "عیب‌یابی"]) {
    assert.ok(headings.includes(needle), `فصلِ «${needle}» در آموزشِ cardpay نیست: ${headings}`);
  }
});

test("کارت‌به‌کارت: در متنِ آموزش هیچ کلیدِ امنیتیِ کامل، شماره‌کارتِ کامل یا CVV/رمز نیست", () => {
  const blob = JSON.stringify(FULL_PAGE_TUTORIALS.cardpay) + JSON.stringify(FULL_PAGE_META.cardpay);
  assert.ok(!/irfsms_[A-Za-z0-9_-]{16,}/.test(blob), "کلیدِ امنیتیِ کامل در متن دیده شد");
  assert.ok(!/\b\d{16}\b/.test(blob.replace(/\d{4}-\*{4}/g, "")), "شماره‌کارتِ ۱۶رقمی در متن دیده شد");
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
