import { DEFAULT_LANG, LANGUAGES, isValidLang, type Lang } from "./i18n";

/**
 * URL architecture for the public (indexable) part of the site.
 *
 *   irforge.ir/            → fa  (DEFAULT_LANG, no prefix)
 *   irforge.ir/en/         → en
 *   irforge.ir/tr/         → tr   … and likewise /ru/, /ar/
 *   irforge.ir/en/docs     → docs in English
 *
 * The prefix is authoritative: whatever language segment the URL carries is
 * the language the page renders in, regardless of what localStorage
 * remembers. That's what makes each URL independently indexable — a crawler
 * (which has no localStorage) and a returning visitor must see the same
 * content at the same URL, otherwise canonical/hreflang would be lying.
 *
 * localStorage still records the visitor's choice, but its only job now is to
 * survive a hard reload of an unprefixed app route; `setLang` navigates to
 * the matching URL rather than swapping content underneath a stale path.
 */

/** Origin used to build absolute URLs (canonical, hreflang, sitemap, OG). */
export const SITE_ORIGIN = "https://irforge.ir";

/**
 * Public marketing routes: these get a prerendered HTML file per language at
 * build time and appear in the sitemap. Everything else is behind auth,
 * stays a client-only SPA route, and is disallowed in robots.txt.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/docs",
  "/learn",
  "/learn/what-is-a-telegram-bot",
  "/learn/how-to-make-a-telegram-bot",
  "/learn/telegram-bot-token",
  "/learn/telegram-bot-without-coding",
  "/learn/choose-a-telegram-bot-builder",
  "/learn/telegram-shop-bot",
  "/learn/telegram-support-bot",
  "/learn/telegram-bot-menu-buttons",
  "/learn/telegram-bot-broadcast",
  "/learn/telegram-bot-google-sheets",
  "/learn/telegram-bot-cost",
  "/learn/botfather-commands",
  "/learn/telegram-bot-webhook-vs-polling",
  "/pricing",
  "/school-management",
  "/about",
] as const;

/**
 * Article slugs stay in English in every language:
 * `/fa/learn/telegram-bot-token`, not `/fa/آموزش/توکن-ربات`. Percent-encoded
 * non-Latin slugs are legal but fragile once they pass through sitemaps,
 * analytics and shared links, and Google handles an English slug with
 * translated content perfectly well.
 */

/**
 * The pre-hub URL of the bot-token guide. It is no longer prerendered and no
 * longer in the sitemap; `App.tsx` client-redirects it to
 * `/learn/telegram-bot-token`. A real 301 has to be configured at the host —
 * see PROGRESS.md and SEO.md.
 */
export const LEGACY_BOT_TOKEN_ROUTE = "/learn/bot-token";
export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

/**
 * Per-route SEO record. Every entry in `PUBLIC_ROUTES` must have one, and the
 * build fails loudly if it doesn't — see `seoForRoute` below.
 *
 * This registry replaced a two-case `route === "/docs" ? ... : ...` branch in
 * `entry-ssg.tsx`. Under that branch, **any** route added to `PUBLIC_ROUTES`
 * silently inherited the homepage's title and description. With a content hub
 * of dozens of URLs that is not a small bug: it is dozens of pages sharing one
 * title, which is exactly the thin/duplicate-content pattern search engines
 * discount. A loud build failure is the correct behaviour here; a convenient
 * fallback is how the problem stays invisible.
 *
 * Keys are looked up in the `seo` locale namespace, so adding a route means
 * adding its copy to all five locale files.
 */
export interface RouteSeo {
  /** key in the `seo` namespace holding this route's <title> */
  titleKey: string;
  /** key in the `seo` namespace holding its meta description */
  descKey: string;
  /** optional key for a route-specific keywords string */
  keywordsKey?: string;
  /** key for the short label used in breadcrumbs and site navigation */
  navKey: string;
}

export const ROUTE_SEO: Record<string, RouteSeo> = {
  "/": {
    titleKey: "homeTitle",
    descKey: "homeDescription",
    keywordsKey: "keywords",
    navKey: "navHome",
  },
  "/docs": {
    titleKey: "docsTitle",
    descKey: "docsDescription",
    navKey: "navDocs",
  },
  "/learn": {
    titleKey: "learnHubTitle",
    descKey: "learnHubDescription",
    navKey: "navLearnHub",
  },
  "/learn/what-is-a-telegram-bot": {
    titleKey: "whatIsTitle",
    descKey: "whatIsDescription",
    navKey: "navWhatIs",
  },
  "/learn/telegram-bot-token": {
    titleKey: "botTokenTitle",
    descKey: "botTokenDescription",
    navKey: "navBotToken",
  },
  "/learn/how-to-make-a-telegram-bot": {
    titleKey: "howToMakeTitle",
    descKey: "howToMakeDescription",
    navKey: "navHowToMake",
  },
  "/learn/choose-a-telegram-bot-builder": {
    titleKey: "chooseBuilderTitle",
    descKey: "chooseBuilderDescription",
    navKey: "navChooseBuilder",
  },
  "/learn/telegram-shop-bot": {
    titleKey: "shopBotTitle",
    descKey: "shopBotDescription",
    navKey: "navShopBot",
  },
  "/learn/telegram-support-bot": {
    titleKey: "supportBotTitle",
    descKey: "supportBotDescription",
    navKey: "navSupportBot",
  },
  "/learn/telegram-bot-menu-buttons": {
    titleKey: "menuButtonsTitle",
    descKey: "menuButtonsDescription",
    navKey: "navMenuButtons",
  },
  "/learn/telegram-bot-broadcast": {
    titleKey: "broadcastTitle",
    descKey: "broadcastDescription",
    navKey: "navBroadcast",
  },
  "/learn/telegram-bot-without-coding": {
    titleKey: "withoutCodingTitle",
    descKey: "withoutCodingDescription",
    navKey: "navWithoutCoding",
  },
  "/learn/telegram-bot-google-sheets": {
    titleKey: "googleSheetsTitle",
    descKey: "googleSheetsDescription",
    navKey: "navGoogleSheets",
  },
  "/learn/telegram-bot-cost": {
    titleKey: "botCostTitle",
    descKey: "botCostDescription",
    navKey: "navBotCost",
  },
  "/learn/botfather-commands": {
    titleKey: "botfatherTitle",
    descKey: "botfatherDescription",
    navKey: "navBotfather",
  },
  "/learn/telegram-bot-webhook-vs-polling": {
    titleKey: "webhookTitle",
    descKey: "webhookDescription",
    navKey: "navWebhook",
  },
  "/pricing": {
    titleKey: "pricingTitle",
    descKey: "pricingDescription",
    keywordsKey: "pricingKeywords",
    navKey: "navPricing",
  },
  "/school-management": {
    titleKey: "schoolTitle",
    descKey: "schoolDescription",
    keywordsKey: "schoolKeywords",
    navKey: "navSchool",
  },
  "/about": {
    titleKey: "aboutTitle",
    descKey: "aboutDescription",
    navKey: "navAbout",
  },
};

/**
 * Look up a route's SEO record, throwing if it has none.
 *
 * Called once per (language × route) during the build, so a missing entry
 * stops the build rather than shipping a duplicate-titled page.
 */
export function routeSeo(route: string): RouteSeo {
  const entry = ROUTE_SEO[route];
  if (!entry) {
    throw new Error(
      `[seo] No ROUTE_SEO entry for public route "${route}".\n` +
        `Every route in PUBLIC_ROUTES needs a title, description and nav label.\n` +
        `Add one to ROUTE_SEO in irforge/src/lib/lang-routing.ts, then add the\n` +
        `matching keys to the "seo" namespace of all five locale files.`,
    );
  }
  return entry;
}

/**
 * Every public route that is a descendant path of `route`, used to build a
 * breadcrumb trail from URL segments instead of hardcoding each page.
 *
 * `/learn/telegram-bot-token` yields `["/learn"]` when `/learn` is itself a
 * public route, so the trail becomes Home → Learn → <page>. Intermediate
 * segments that aren't public routes are skipped rather than linked to a 404.
 */
export function ancestorRoutes(route: string): string[] {
  if (route === "/") return [];
  const segments = route.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const path = "/" + segments.slice(0, i).join("/");
    if (ROUTE_SEO[path]) out.push(path);
  }
  return out;
}

/**
 * Routes that must never be indexed: everything behind auth, plus the auth
 * screens themselves. Every one of these needs to be disallowed in robots.txt
 * twice — bare (`/dashboard`) and under any language prefix
 * (`/*​/dashboard`) — because Phase 1 made `/en/dashboard` a reachable URL.
 *
 * `scripts/ssg.mjs` asserts that public/robots.txt covers both forms for every
 * entry here and fails the build otherwise, so this list and robots.txt can't
 * quietly drift apart.
 */
export const PRIVATE_ROUTES = [
  "/dashboard",
  "/bots",
  "/marketplace",
  "/plans",
  "/invoices",
  "/tickets",
  "/wallet",
  "/support",
  "/notifications",
  "/updates",
  "/language",
  "/database",
  "/profile",
  // `/buy-bot` و `/checkout` هر دو `ProtectedRoute` هستند ولی در این لیست
  // نبودند و هیچ پیشوندی هم پوششان نمی‌داد — یعنی یک مسیر احرازهویت‌شده که
  // خزنده‌ها اجازه‌ی خزیدنش را داشتند. تنها چیزی که پیدایشان نکرد، همین بود
  // که کسی لیست را با مسیرهای واقعی App.tsx مقایسه نکرده بود.
  //
  // IRFORGE_PRODUCTS_SECTION_PROMPT Phase 3 — `/buy-bot` رنیم شد به
  // `/products` (مسیرِ واقعی)؛ `/buy-bot` خودش هم می‌ماند، حالا فقط یک
  // Redirectِ کلاینتی به `/products` است، ولی همچنان یک مسیرِ
  // احرازهویت‌شده در App.tsx است و باید همان قاعده را داشته باشد.
  "/buy-bot",
  "/products",
  "/checkout",
  "/admin",
  "/admin/users",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  // SEO audit (2026-10): these are real, authenticated or auth-flow routes in
  // App.tsx that were in no list at all, so robots.txt let crawlers in and the
  // shell they got back said `index, follow` + a canonical pointing at the
  // homepage. `scripts/ssg.mjs` and `api-server/test/seoRouting.test.mjs` now compare this
  // list with App.tsx's real routes, so the next one can't be forgotten.
  "/schools",
  "/tutorials",
  "/auth",
  "/complete-profile",
  "/super",
] as const;

/**
 * The private routes that robots.txt must deliberately leave **crawlable**.
 *
 * `Disallow` and `noindex` fight each other: a crawler that is not allowed to
 * fetch a URL never sees the `noindex` on it, and Google may keep the bare URL
 * in its index ("indexed, though blocked by robots.txt") if anything links to
 * it. These are exactly the routes that ARE linked from public pages (the
 * header's login/register buttons) or that people share and search for
 * (/dashboard), so for them the only reliable de-indexing is: let the crawler
 * in, answer 200 with `X-Robots-Tag: noindex, follow` and a matching
 * `<meta name="robots">` (the server and the app shell both do — see
 * api-server/src/lib/seoRouting.ts and scripts/ssg.mjs).
 *
 * Every other private route stays `Disallow`ed (nothing public links to it, and
 * the server sends the same noindex header if one is ever fetched).
 * `assertRobotsCoverage()` enforces both directions at build time.
 */
export const CRAWLABLE_NOINDEX_ROUTES = [
  "/dashboard",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
] as const;

/**
 * Every top-level path segment that App.tsx renders and that is NOT a public
 * marketing page. The server answers these with the app shell (HTTP 200,
 * `X-Robots-Tag: noindex, follow`); any other unknown path gets a real 404.
 *
 * Keep in step with `APP_SEGMENTS` in api-server/src/lib/seoRouting.ts and with
 * the `<Route>` list in App.tsx — `api-server/test/seoRouting.test.mjs` fails if they drift.
 */
export const APP_SEGMENTS = [
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "complete-profile",
  "auth",
  "dashboard",
  "bots",
  "products",
  "buy-bot",
  "tutorials",
  "marketplace",
  "invoices",
  "tickets",
  "wallet",
  "plans",
  "support",
  "notifications",
  "updates",
  "database",
  "profile",
  "schools",
  "admin",
  "super",
] as const;

/**
 * Bump when the marketing copy meaningfully changes. Deliberately not the
 * build date — rebuilding without a content change shouldn't tell crawlers
 * the page was modified.
 */
export const SITEMAP_LASTMOD = "2026-10-04";

export const ALL_LANGS: readonly Lang[] = LANGUAGES.map((l) => l.code);

/**
 * Split a leading language segment off a pathname.
 *   "/en/docs" → { lang: "en", path: "/docs" }
 *   "/en"      → { lang: "en", path: "/" }
 *   "/docs"    → { lang: null, path: "/docs" }
 *
 * Only a valid language code counts — "/dashboard" keeps its path intact even
 * though it starts with two letters, because the segment must match exactly.
 */
export function splitLangPrefix(pathname: string): { lang: Lang | null; path: string } {
  const match = /^\/([^/]+)(?=\/|$)/.exec(pathname || "/");
  if (match && isValidLang(match[1])) {
    const rest = pathname.slice(match[0].length);
    return { lang: match[1], path: rest === "" ? "/" : rest };
  }
  return { lang: null, path: pathname || "/" };
}

/** "" for the root language, "/en" for the rest. */
export function langPrefix(lang: Lang): string {
  return lang === DEFAULT_LANG ? "" : `/${lang}`;
}

/**
 * Site-absolute path for a route in a given language — the form wouter's
 * `base` expects ("/en", no trailing slash).
 */
export function langPath(lang: Lang, path: string): string {
  const suffix = path === "/" ? "" : path;
  return `${langPrefix(lang)}${suffix}` || "/";
}

/**
 * Same, but in the canonical form the address bar and `absoluteUrl` use — the
 * language root keeps its trailing slash ("/en/"). Use this whenever a URL is
 * pushed to history, so what the visitor sees matches what the page declares
 * as its canonical.
 */
export function langHref(lang: Lang, path: string): string {
  if (path === "/") return `${langPrefix(lang)}/`;
  return langPath(lang, path);
}

/**
 * Fully-qualified URL — for canonical, hreflang, sitemap and og:url.
 *
 * The language root always keeps its trailing slash (`/en/`, and `/` for fa)
 * so the advertised canonical is the exact URL the server responds to; inner
 * routes stay slash-less (`/en/docs`), matching the links the app already
 * emits. Picking one form and sticking to it is what stops `/en` and `/en/`
 * being indexed as two pages.
 */
export function absoluteUrl(lang: Lang, path: string): string {
  if (path === "/") return `${SITE_ORIGIN}${langPrefix(lang)}/`;
  return `${SITE_ORIGIN}${langPath(lang, path)}`;
}
