/**
 * test/localeParity.test.mjs — IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۳.
 *
 * جلوگیری از تکرارِ یک خانواده‌باگِ دیگر: یک کلیدِ locale که فقط به fa.json
 * اضافه شود و در چهار زبانِ دیگر فراموش شود، ساکت می‌ماند — کاربرِ آن زبان
 * فقط یک شناسه‌ی خام یا رشته‌ی خالی می‌بیند، نه خطا. این تست هر پنج فایلِ
 * locale (`src/locales/*.json`) را با هم مقایسه می‌کند و روی هر مسیرِ کلیدِ
 * تودرتو که فقط در بعضی زبان‌ها هست fail می‌کند — از جمله دقیقاً همان کلاسِ
 * باگی که این پرامپت خودش پوشش می‌دهد (`botPanels.type_wallet`,
 * `botCatalog.fulfillment_pool`, ...).
 *
 * عمداً محتوا را مقایسه نمی‌کند (ترجمه‌ها طبیعتاً متفاوتند) — فقط ساختار
 * (مجموعه‌ی کلیدها).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LOCALES_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../src/locales");
const LANGS = ["fa", "en", "tr", "ar", "ru"];

function loadLocale(lang) {
  return JSON.parse(readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf-8"));
}

/** همه‌ی مسیرهای کلیدِ برگ (leaf) را به شکل "namespace.key" برمی‌گرداند. */
function flattenKeys(obj, prefix = "") {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const nested of flattenKeys(v, key)) out.add(nested);
    } else {
      out.add(key);
    }
  }
  return out;
}

const locales = Object.fromEntries(LANGS.map((lang) => [lang, loadLocale(lang)]));
const keySets = Object.fromEntries(LANGS.map((lang) => [lang, flattenKeys(locales[lang])]));

test("هر پنج فایلِ locale دقیقاً همان مجموعه‌ی کلیدهای fa.json را دارند", () => {
  const base = keySets.fa;
  for (const lang of LANGS) {
    const missing = [...base].filter((k) => !keySets[lang].has(k));
    const extra = [...keySets[lang]].filter((k) => !base.has(k));
    assert.deepEqual(missing, [], `${lang}.json این کلیدها را کم دارد: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${lang}.json این کلیدهای اضافه را دارد که در fa.json نیست: ${extra.join(", ")}`);
  }
});

test("انواعِ پنلِ پلاگینیِ فازِ ۱ در هر پنج زبان ترجمه دارند", () => {
  const keys = [
    "type_ticket", "type_subscription", "type_survey", "type_address",
    "type_wallet", "type_wallet_balance", "type_loyalty", "type_giveaway",
    "type_booking", "type_catalog_store",
  ];
  for (const lang of LANGS) {
    for (const key of keys) {
      const label = locales[lang].botPanels?.[key];
      assert.ok(typeof label === "string" && label.trim(), `botPanels.${key} در ${lang}.json خالی/غایب است`);
    }
  }
});

test("fulfillment_pool فازِ ۲ در هر پنج زبان ترجمه دارد", () => {
  for (const lang of LANGS) {
    const label = locales[lang].botCatalog?.fulfillment_pool;
    const help = locales[lang].botCatalog?.fulfillmentHelpPool;
    assert.ok(typeof label === "string" && label.trim(), `botCatalog.fulfillment_pool در ${lang}.json خالی/غایب است`);
    assert.ok(typeof help === "string" && help.trim(), `botCatalog.fulfillmentHelpPool در ${lang}.json خالی/غایب است`);
  }
});
