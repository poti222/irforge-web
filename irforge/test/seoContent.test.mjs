/**
 * test/seoContent.test.mjs — قفلِ محتوا و ساختارِ سئوی صفحه‌های عمومی.
 *
 * این تست‌ها چیزهایی را می‌پایند که بیلد (scripts/ssg.mjs) نمی‌پاید یا دیر می‌پاید:
 *  - هر مقاله در هر پنج زبان محتوا دارد و مقاله‌های مرتبط (RELATED) واقعی‌اند؛
 *  - لینک‌های داخلِ متن (`[متن](/learn/slug)`) به یک مسیرِ عمومیِ موجود اشاره می‌کنند — لینکِ مرده
 *    در متنِ locale تا وقتی کسی صفحه را باز نکند دیده نمی‌شود؛
 *  - پاسخ‌های FAQ لینک ندارند (همان متن در JSON-LD می‌رود و نباید markup خام داشته باشد)؛
 *  - ادعاهایی که کد پشتیبانی‌شان نمی‌کند (هزاران توسعه‌دهنده، بات نامحدود، «شیت در حساب گوگل خودتان»،
 *    افزونه‌ی پاسخ هوش مصنوعی…) دوباره به صفحه‌های عمومی برنمی‌گردند — SEO.md: «هیچ ادعای ساختگی».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { PUBLIC_ROUTES, ROUTE_SEO } = await import("../src/lib/lang-routing.ts");
const { ARTICLE_SLUGS, RELATED, ARTICLE_DATES } = await import("../src/lib/learn-content.ts");

const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/locales");
const LANGS = ["fa", "en", "ar", "tr", "ru"];
const locales = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(LOCALES_DIR, `${l}.json`), "utf-8"))]),
);

const publicSet = new Set(PUBLIC_ROUTES);
const INLINE_LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

function* strings(value, trail = "") {
  if (typeof value === "string") yield [trail, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${trail}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* strings(v, trail ? `${trail}.${k}` : k);
}

test("هر مسیرِ عمومی یک رکوردِ SEO با کلیدهای پر در هر پنج زبان دارد، و عنوان/توضیح‌ها یکتا هستند", () => {
  for (const lang of LANGS) {
    const seo = locales[lang].seo;
    const titles = new Map();
    const descs = new Map();
    for (const route of PUBLIC_ROUTES) {
      const entry = ROUTE_SEO[route];
      assert.ok(entry, `ROUTE_SEO برای ${route} نیست`);
      for (const key of [entry.titleKey, entry.descKey, entry.navKey]) {
        assert.ok(typeof seo[key] === "string" && seo[key].trim(), `seo.${key} در ${lang}.json خالی/غایب است (${route})`);
      }
      const title = seo[entry.titleKey];
      const desc = seo[entry.descKey];
      assert.ok(title.length <= 80, `عنوانِ ${route} در ${lang} بلندتر از ۸۰ نویسه است (${title.length})`);
      assert.ok(desc.length >= 60 && desc.length <= 220, `توضیحِ ${route} در ${lang} خارج از ۶۰–۲۲۰ نویسه است (${desc.length})`);
      assert.ok(!titles.has(title), `عنوانِ تکراری در ${lang}: ${route} و ${titles.get(title)}`);
      assert.ok(!descs.has(desc), `توضیحِ تکراری در ${lang}: ${route} و ${descs.get(desc)}`);
      titles.set(title, route);
      descs.set(desc, route);
    }
  }
});

test("ARTICLE_SLUGS دقیقاً مسیرهای /learn/* در PUBLIC_ROUTES است و تاریخ‌ها معتبرند", () => {
  const fromRoutes = PUBLIC_ROUTES.filter((r) => r.startsWith("/learn/")).map((r) => r.slice("/learn/".length));
  assert.deepEqual([...fromRoutes].sort(), [...ARTICLE_SLUGS].sort());
  for (const slug of ARTICLE_SLUGS) {
    const d = ARTICLE_DATES[slug];
    assert.ok(d, `ARTICLE_DATES برای ${slug} نیست`);
    assert.match(d.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.modified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.modified >= d.published, `${slug}: modified قبل از published است`);
  }
});

test("RELATED: هر مقاله حداقل سه مقاله‌ی مرتبطِ واقعی و غیرتکراری دارد", () => {
  for (const slug of ARTICLE_SLUGS) {
    const related = RELATED[slug];
    assert.ok(Array.isArray(related) && related.length >= 3, `${slug} کمتر از سه مقاله‌ی مرتبط دارد`);
    assert.equal(new Set(related).size, related.length, `${slug}: مرتبط‌های تکراری`);
    for (const r of related) {
      assert.ok(ARTICLE_SLUGS.includes(r), `${slug} به مقاله‌ی ناموجود ${r} اشاره می‌کند`);
      assert.notEqual(r, slug, `${slug} به خودش اشاره می‌کند`);
    }
  }
});

test("هر مقاله در هر پنج زبان h1، lead و حداقل یک بدنه (sections یا steps) دارد", () => {
  for (const lang of LANGS) {
    for (const slug of ARTICLE_SLUGS) {
      const a = locales[lang].learn.articles[slug];
      assert.ok(a, `${lang}: مقاله‌ی ${slug} نیست`);
      assert.ok(a.h1?.trim() && a.lead?.trim(), `${lang}/${slug}: h1 یا lead خالی است`);
      const body = (a.sections?.length ?? 0) + (a.steps?.length ?? 0);
      assert.ok(body > 0, `${lang}/${slug}: نه sections دارد نه steps`);
      if (a.sections) {
        const h2s = a.sections.map((s) => s.h2);
        assert.equal(new Set(h2s).size, h2s.length, `${lang}/${slug}: h2 تکراریِ sections (key واحد در React)`);
        for (const s of a.sections) assert.ok(s.h2?.trim() && (s.body?.length || s.items?.length), `${lang}/${slug}: بخشِ خالی «${s.h2}»`);
      }
    }
  }
});

test("لینک‌های داخلِ متن به مسیرِ عمومیِ موجود اشاره می‌کنند و در پاسخ‌های FAQ نیستند", () => {
  for (const lang of LANGS) {
    const L = locales[lang];
    const scan = (label, text) => {
      for (const m of text.matchAll(INLINE_LINK)) {
        assert.ok(publicSet.has(m[2]), `${lang} ${label}: لینکِ داخلیِ نامعتبر ${m[2]}`);
      }
    };
    for (const [slug, a] of Object.entries(L.learn.articles)) {
      for (const [trail, text] of strings({ sections: a.sections, next: a.next })) scan(`${slug}.${trail}`, text);
      for (const [trail, text] of strings({ faq: a.faq, lead: a.lead })) {
        assert.ok(!INLINE_LINK.test(text), `${lang} ${slug}.${trail}: لینک در متنی که وارد JSON-LD/کارت می‌شود`);
        INLINE_LINK.lastIndex = 0;
      }
    }
    for (const [trail, text] of strings(L.about?.sections ?? [])) scan(`about.${trail}`, text);
    for (const [trail, text] of strings(L.faq)) {
      assert.ok(!/\]\(\//.test(text), `${lang} faq.${trail}: لینک در پاسخِ FAQ`);
    }
  }
});

test("FAQ صفحه‌ی اصلی پشت‌سرهم است (q1..q14) و صفحه‌ی اصلی شش کارتِ کاربرد دارد — در هر پنج زبان", () => {
  for (const lang of LANGS) {
    for (let i = 1; i <= 14; i++) {
      assert.ok(locales[lang].faq[`q${i}`]?.trim() && locales[lang].faq[`a${i}`]?.trim(), `${lang}: faq.q${i}/a${i} خالی است`);
    }
    for (const key of ["shop", "support", "menu", "broadcast", "services", "data"]) {
      const c = locales[lang].landing.useCases?.[key];
      assert.ok(c?.title?.trim() && c?.desc?.trim(), `${lang}: landing.useCases.${key} ناقص است`);
    }
    const about = locales[lang].about;
    assert.ok(about?.h1 && about.sections?.length >= 4 && about.contactBody, `${lang}: صفحه‌ی about ناقص است`);
  }
});

// ادعاهایی که قبلاً روی صفحه‌ی عمومی بودند و کد پشتیبانی‌شان نمی‌کرد (به‌همراهِ دلیل در SEO.md).
const BANNED = [
  // «هزاران توسعه‌دهنده» — عددِ ساختگی
  /هزاران توسعه/, /thousands of developers/i, /آلاف المطورين/, /binlerce geliştirici/i, /тысячи разработчиков/i, /тысячам разработчиков/i,
  // بات نامحدود — سقفِ تعداد ربات به پکیج بستگی دارد
  /ربات‌های نامحدود/, /unlimited bots/i, /بوتات غير محدودة/, /sınırsız bot/i, /неограниченн\S* (?:кол\S+ )?бот/i,
  // شیت در حسابِ گوگلِ خودِ کاربر — شیت اختصاصیِ ربات است و IrForge اختصاص می‌دهد
  /حساب گوگل خودتان/, /your own Google account/i, /في حسابك على جوجل/, /kendi Google hesab/i, /вашем (?:собственном )?аккаунте Google/i,
  // افزونه‌ی «پاسخ هوش مصنوعی» و «پایش/نظارت گروه» که وجود ندارد
  /پاسخ هوش مصنوعی/, /AI-reply/i, /ردود الذكاء الاصطناعي/, /Yapay zeka yanıtları/i, /Ответы ИИ/,
  // مینی‌اپ‌ساز، «نسخه ۲.۰»، لاگ real-time
  /مینی‌اپ‌ها را بسازید/, /and Mini Apps/i, /نسخه ۲\.۰/, /Platform v2\.0/i,
  // قیمتِ یک‌باره/بدون اشتراکِ ماهانه — پکیج‌ها ماهانه‌اند
  /نه اشتراک ماهانه/, /no monthly subscription/i,
  // ادعای مقایسه‌ایِ مطلق درباره‌ی رقبا
  /هیچ‌کدام از نرم‌افزارهای رایجِ/,
];

test("ادعاهای پشتیبانی‌نشده در متن‌های عمومی نیستند", () => {
  const namespaces = ["landing", "faq", "learn", "pricing", "about", "seo", "botTiers"];
  for (const lang of LANGS) {
    for (const ns of namespaces) {
      for (const [trail, text] of strings(locales[lang][ns] ?? {}, ns)) {
        for (const re of BANNED) {
          assert.ok(!re.test(text), `${lang}.${trail} ادعای ممنوع را دارد: ${re}`);
        }
      }
    }
  }
});
