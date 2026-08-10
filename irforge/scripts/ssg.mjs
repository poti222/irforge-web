// Build-time prerender for the public marketing pages.
//
// Runs after `vite build` (client) and `vite build -c vite.config.ssg.ts`
// (render bundle). For every language × public route it renders the real React
// tree to HTML and splices it into the client template, so each URL ships its
// own content and its own <head> instead of an empty SPA shell.
//
// Output layout, which express.static serves without any server change:
//   dist/index.html            → fa   (root language, no prefix)
//   dist/docs/index.html       → fa   /docs
//   dist/en/index.html         → en   /en/
//   dist/en/docs/index.html    → en   /en/docs   … and so on for tr, ru, ar

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const distDir = join(pkgRoot, "dist");
const templatePath = join(distDir, "index.html");

const { renderPage, allPages, sitemapEntries, PRIVATE_ROUTES, ALL_LANGS } = await import(
  pathToFileURL(join(pkgRoot, "dist-ssg", "entry-ssg.mjs")).href
);

const OG_LOCALE = { fa: "fa_IR", en: "en_US", ar: "ar_SA", tr: "tr_TR", ru: "ru_RU" };

/**
 * The template must be the *pristine* client build output. This script
 * overwrites dist/index.html with the prerendered root page, so on a second
 * run that file is no longer a template — reusing it would splice markup into
 * markup and stack a second canonical/hreflang block on every page.
 *
 * So: snapshot dist/index.html the moment it still looks untouched (empty
 * root div), and fall back to that snapshot afterwards.
 */
// node_modules/.cache, not the package root: dist/ and dist-ssg/ are wiped by
// emptyOutDir, and a stray .html in the vite root makes the dev server treat
// it as an entry and full-reload the page on every build
const snapshotPath = join(pkgRoot, "node_modules", ".cache", "ssg-template.html");
function loadTemplate() {
  const current = readFileSync(templatePath, "utf8");
  if (current.includes('<div id="root"></div>')) {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, current, "utf8");
    return current;
  }
  if (existsSync(snapshotPath)) return readFileSync(snapshotPath, "utf8");
  throw new Error(
    "dist/index.html is already prerendered and no template snapshot exists.\n" +
      "Run the client build first: pnpm run build:client"
  );
}

const template = loadTemplate();

/**
 * Framer Motion serialises its *initial* variant, so a server render of the
 * landing page emits ~25 elements at `opacity:0` — the h1 among them. The
 * markup is complete but invisible until JS animates it in, which defeats the
 * point of prerendering: anyone with slow, failed or disabled JS gets a blank
 * page, and a crawler has to execute the animation to see the copy.
 *
 * So neutralise the entry state in the emitted HTML. This only affects the
 * pre-JS paint: main.tsx mounts with createRoot (not hydrateRoot), so React
 * replaces this markup wholesale on boot and the animations still play
 * normally for real visitors.
 *
 * Scoped to style attributes that carry an opacity — it never touches
 * classes, and an element hidden by CSS rather than by an inline motion style
 * stays hidden.
 */
function makeVisible(markup) {
  return markup.replace(/style="([^"]*opacity:\s*0[^"]*)"/g, (whole, style) => {
    const fixed = style
      .replace(/opacity:\s*0(?![.\d])/g, "opacity:1")
      // drop the entry offset/scale so nothing renders shifted or shrunken
      .replace(/transform:\s*[^;"]*/g, "transform:none")
      .replace(/will-change:\s*[^;"]*;?/g, "");
    return `style="${fixed}"`;
  });
}

/** Replace the `content` of a meta tag matched by one of its attributes. */
function setMetaContent(html, attr, name, value) {
  const re = new RegExp(`(<meta\\s+${attr}="${name}"\\s+content=")[^"]*(")`, "i");
  return re.test(html) ? html.replace(re, `$1${escapeAttr(value)}$2`) : html;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function buildHead(page) {
  const alternates = page.alternates
    .map(([hl, href]) => `    <link rel="alternate" hreflang="${hl}" href="${href}" />`)
    .join("\n");
  return `\n    <link rel="canonical" href="${page.canonical}" />\n${alternates}\n`;
}

function renderToFile(page) {
  let html = template;

  // <html lang dir>
  html = html.replace(
    /<html\s+lang="[^"]*"\s+dir="[^"]*">/i,
    `<html lang="${page.lang}" dir="${page.dir}">`
  );

  // title + descriptions
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(page.title)}</title>`);
  html = setMetaContent(html, "name", "description", page.description);
  if (page.keywords) html = setMetaContent(html, "name", "keywords", page.keywords);
  html = setMetaContent(html, "property", "og:title", page.title);
  html = setMetaContent(html, "property", "og:description", page.description);
  html = setMetaContent(html, "name", "twitter:title", page.title);
  html = setMetaContent(html, "name", "twitter:description", page.description);
  html = setMetaContent(html, "property", "og:url", page.canonical);
  html = setMetaContent(html, "name", "twitter:url", page.canonical);
  html = setMetaContent(html, "property", "og:locale", OG_LOCALE[page.lang] ?? "fa_IR");

  // og:locale:alternate for the other four languages. Facebook/LinkedIn and
  // friends read these to pick the right card for the viewer's locale; without
  // them each page looks like an island rather than one of five translations.
  // Stripped first so a re-run can't stack duplicates.
  html = html.replace(/\s*<meta property="og:locale:alternate"[^>]*>/gi, "");
  const otherLocales = Object.entries(OG_LOCALE)
    .filter(([code]) => code !== page.lang)
    .map(([, locale]) => `    <meta property="og:locale:alternate" content="${locale}" />`)
    .join("\n");
  html = html.replace(
    /(<meta property="og:locale" content="[^"]*" \/>)/i,
    `$1\n${otherLocales}`
  );

  // Per-language social card when one has been dropped into public/og/,
  // otherwise the shared card. Falling back per language means a partial set
  // is safe to ship — no page ever points at an image that 404s.
  const perLang = `/og/og-${page.lang}.png`;
  const ogImage = existsSync(join(distDir, "og", `og-${page.lang}.png`))
    ? perLang
    : "/og-image.png";
  html = setMetaContent(html, "property", "og:image", `https://irforge.ir${ogImage}`);
  html = setMetaContent(html, "name", "twitter:image", `https://irforge.ir${ogImage}`);
  html = setMetaContent(html, "property", "og:image:alt", page.title);

  // Canonical + reciprocal hreflang. Strip every existing alternate first and
  // replace the single hard-coded canonical that ships in index.html, so this
  // is idempotent even if the template ever picks one up.
  html = html.replace(/\s*<link rel="alternate"[^>]*>/gi, "");
  html = html.replace(/\s*<link rel="canonical"[^>]*>\s*/i, buildHead(page));

  // JSON-LD, replacing any block from a previous pass so this stays idempotent
  html = html.replace(
    /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi,
    ""
  );
  html = html.replace(
    /<\/head>/i,
    `  <script type="application/ld+json">${page.jsonLd}</script>\n  </head>`
  );

  // the app itself
  html = html.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${makeVisible(page.html)}</div>`
  );

  const outPath =
    page.path === "/"
      ? join(distDir, "index.html")
      : join(distDir, page.path.replace(/^\//, ""), "index.html");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  return outPath;
}

/**
 * sitemap.xml is generated, not checked in: it's purely derived from
 * (languages × public routes) and a hand-maintained copy would go stale the
 * moment either changes.
 */
function writeSitemap() {
  const entries = sitemapEntries();
  const body = entries
    .map((e) => {
      const links = e.alternates
        .map(
          ([hl, href]) =>
            `    <xhtml:link rel="alternate" hreflang="${hl}" href="${href}" />`
        )
        .join("\n");
      return [
        "  <url>",
        `    <loc>${e.loc}</loc>`,
        links,
        `    <lastmod>${e.lastmod}</lastmod>`,
        `    <changefreq>${e.changefreq}</changefreq>`,
        `    <priority>${e.priority}</priority>`,
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
  writeFileSync(join(distDir, "sitemap.xml"), xml, "utf8");
  return entries.length;
}

/**
 * robots.txt stays a hand-written file (it's too easy to deindex a site with a
 * generator bug), but every private route must be disallowed in BOTH forms —
 * bare and language-prefixed. Phase 1 turned /en/dashboard into a real URL and
 * "Disallow: /dashboard" does not match it. Fail the build on drift rather
 * than shipping crawlable app routes.
 */
function assertRobotsCoverage() {
  const robotsPath = join(distDir, "robots.txt");
  if (!existsSync(robotsPath)) {
    throw new Error("dist/robots.txt is missing — is public/robots.txt still there?");
  }
  const rules = new Set(
    readFileSync(robotsPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^Disallow:/i.test(l))
      .map((l) => l.replace(/^Disallow:\s*/i, ""))
  );

  const missing = [];
  for (const route of PRIVATE_ROUTES) {
    if (!rules.has(route)) missing.push(`Disallow: ${route}`);
    if (!rules.has(`/*${route}`)) missing.push(`Disallow: /*${route}`);
  }
  if (missing.length) {
    throw new Error(
      `robots.txt does not cover every private route.\nAdd to irforge/public/robots.txt:\n  ${missing.join(
        "\n  "
      )}`
    );
  }
  return rules.size;
}

/**
 * The brand icon Google shows beside a result comes from Organization.logo,
 * and the social card comes from og:image. If either asset goes missing or
 * gets caught by a future robots.txt rule, the result silently falls back to
 * a generic globe — the exact symptom this work set out to fix. Cheap to
 * assert, so assert it.
 */
const BRAND_ASSETS = [
  "/favicon.ico",
  "/favicon-96.png",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/og-image.png",
];

function assertBrandAssets() {
  const robots = readFileSync(join(distDir, "robots.txt"), "utf8");
  const disallowed = robots
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^Disallow:\s*\S/i.test(l))
    .map((l) => l.replace(/^Disallow:\s*/i, ""));

  const problems = [];
  for (const asset of BRAND_ASSETS) {
    if (!existsSync(join(distDir, asset.replace(/^\//, "")))) {
      problems.push(`${asset} is missing from dist/`);
    }
    // robots.txt prefix matching: a rule blocks the asset if the asset path
    // starts with it (wildcards aside, which never apply to these root files)
    for (const rule of disallowed) {
      const literal = rule.split("*")[0];
      if (literal && literal !== "/" && asset.startsWith(literal)) {
        problems.push(`${asset} is blocked by "Disallow: ${rule}"`);
      }
    }
  }
  if (problems.length) {
    throw new Error(`Brand assets are not crawlable:\n  ${problems.join("\n  ")}`);
  }
  return BRAND_ASSETS.length;
}


/**
 * Per-page SEO assertions.
 *
 * These are the part of this work that survives everyone forgetting about it:
 * they turn "someone should check the canonical is still there" into a build
 * failure. Each one encodes a mistake that is invisible in a browser and
 * expensive in search results.
 *
 * `ROUTE_SEO` coverage is enforced earlier and harder — `routeSeo()` in
 * lib/lang-routing.ts throws while rendering, before a page is ever written —
 * so a missing registry entry never reaches this stage.
 */
function assertPageSeo(emitted) {
  const problems = [];

  // 1. Duplicate <title> across two emitted pages. Dozens of URLs sharing one
  //    title is the thin/duplicate-content pattern this project exists to fix.
  const byTitle = new Map();
  for (const page of emitted) {
    const list = byTitle.get(page.title) ?? [];
    list.push(page.path);
    byTitle.set(page.title, list);
  }
  for (const [title, paths] of byTitle) {
    if (paths.length > 1) {
      problems.push(`duplicate <title> "${title}" on: ${paths.join(", ")}`);
    }
  }

  for (const page of emitted) {
    const html = readFileSync(page.file, "utf8");

    // 2. Canonical, hreflang and JSON-LD must all be present.
    if (!/<link rel="canonical"/i.test(html)) {
      problems.push(`${page.path}: no canonical`);
    }
    if (!/<link rel="alternate" hreflang=/i.test(html)) {
      problems.push(`${page.path}: no hreflang`);
    }
    if (!/<script type="application\/ld\+json">/i.test(html)) {
      problems.push(`${page.path}: no JSON-LD`);
    }

    // 3. The hreflang set must be reciprocal: every language plus x-default,
    //    each pointing at this same route. A set that isn't reciprocal is
    //    ignored wholesale by Google rather than partially honoured.
    const found = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/gi)];
    const expected = new Set([...ALL_LANGS, "x-default"]);
    const seen = new Set(found.map(([, hl]) => hl));
    for (const hl of expected) {
      if (!seen.has(hl)) problems.push(`${page.path}: hreflang missing "${hl}"`);
    }
    for (const hl of seen) {
      if (!expected.has(hl)) problems.push(`${page.path}: unexpected hreflang "${hl}"`);
    }
  }

  if (problems.length) {
    throw new Error(
      `SEO assertions failed (${problems.length}):\n  ${problems.join("\n  ")}`
    );
  }
  return emitted.length;
}

/** Any TODO_TRANSLATE_* keys still sitting in the locale files. */
function pendingTranslations() {
  const out = [];
  for (const lang of ALL_LANGS) {
    const file = join(pkgRoot, "src", "locales", `${lang}.json`);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const hits = raw.match(/TODO_TRANSLATE_[A-Za-z]+/g);
    if (hits) out.push(`${lang}: ${hits.length}`);
  }
  return out;
}

const pages = allPages();
let bytes = 0;
const emitted = [];
for (const { lang, route } of pages) {
  const page = renderPage(lang, route);
  const out = renderToFile(page);
  emitted.push({ path: page.path, lang: page.lang, title: page.title, file: out });
  const size = Buffer.byteLength(readFileSync(out));
  bytes += size;
  console.log(
    `  ${String(page.path).padEnd(12)} ${page.lang}  ${(size / 1024).toFixed(1).padStart(6)} kB  ${page.title}`
  );
}
console.log(`\nprerendered ${pages.length} pages (${(bytes / 1024).toFixed(0)} kB total)`);

const urls = writeSitemap();
console.log(`sitemap.xml: ${urls} URLs`);
const ruleCount = assertRobotsCoverage();
console.log(`robots.txt: ${ruleCount} disallow rules, all private routes covered`);
const assetCount = assertBrandAssets();
console.log(`brand assets: ${assetCount} present and crawlable`);
const checked = assertPageSeo(emitted);
console.log(`SEO assertions: ${checked} pages have a unique title, canonical, reciprocal hreflang and JSON-LD`);

// ── Build summary ──────────────────────────────────────────────────────────
const todos = pendingTranslations();
console.log(
  `\nsummary: ${pages.length} pages · ${urls} sitemap URLs · ${ALL_LANGS.length} languages (${ALL_LANGS.join(", ")})`
);
console.log(
  todos.length
    ? `TODO_TRANSLATE keys remaining → ${todos.join(", ")}`
    : "TODO_TRANSLATE keys remaining: none"
);
