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
export const PUBLIC_ROUTES = ["/", "/docs"] as const;
export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

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
  "/themes",
  "/plans",
  "/invoices",
  "/tickets",
  "/wallet",
  "/support",
  "/language",
  "/database",
  "/profile",
  "/admin",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
] as const;

/**
 * Bump when the marketing copy meaningfully changes. Deliberately not the
 * build date — rebuilding without a content change shouldn't tell crawlers
 * the page was modified.
 */
export const SITEMAP_LASTMOD = "2026-08-08";

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
