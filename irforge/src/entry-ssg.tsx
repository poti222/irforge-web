import { renderToString } from "react-dom/server";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import App, { queryClient } from "./App";
import { setRenderLang } from "./hooks/use-language";
import en from "./locales/en.json";
import fa from "./locales/fa.json";
import ar from "./locales/ar.json";
import tr from "./locales/tr.json";
import ru from "./locales/ru.json";
import { DEFAULT_LANG, isRtlLang, type Lang } from "./lib/i18n";
import {
  ALL_LANGS,
  PRIVATE_ROUTES,
  PUBLIC_ROUTES,
  ROUTE_SEO,
  SITE_ORIGIN,
  SITEMAP_LASTMOD,
  absoluteUrl,
  langPath,
  routeSeo,
} from "./lib/lang-routing";

import { structuredData } from "./lib/structured-data";
import { faqEntries } from "./lib/faq-content";
import {
  ARTICLE_SLUGS,
  articleFor,
  articleRoute,
  type ArticleContent,
  type ArticleSlug,
} from "./lib/learn-content";

export { PRIVATE_ROUTES, ALL_LANGS };

/**
 * Build-time render entry. `scripts/ssg.mjs` imports this from the SSR bundle
 * and calls `renderPage` once per (language × public route), then splices the
 * result into the client template that `vite build` produced.
 *
 * Nothing here runs in the browser — the client still boots from main.tsx.
 */

const LOCALES: Record<Lang, typeof en> = { en, fa, ar, tr, ru } as any;

export interface RenderedPage {
  /** markup for <div id="root"> */
  html: string;
  lang: Lang;
  dir: "rtl" | "ltr";
  path: string;
  title: string;
  description: string;
  canonical: string;
  /** [hreflang, href] pairs, including x-default */
  alternates: [string, string][];
  /** JSON-LD @graph for this page, in this page's language */
  jsonLd: string;
  keywords: string;
}

/** The `seo` namespace for one language, with English filling any gap. */
function seoNs(lang: Lang): Record<string, string> {
  return { ...(LOCALES.en.seo as any), ...((LOCALES[lang]?.seo as any) ?? {}) };
}

/**
 * Title/description/keywords for one route, looked up through `ROUTE_SEO`.
 *
 * A route with no registry entry throws (see `routeSeo`); a registry entry
 * pointing at a locale key that doesn't exist throws here. Both are build-time
 * failures on purpose — the alternative is a page that ships with the wrong
 * title and nobody notices for months.
 */
function seoFor(lang: Lang, route: string) {
  const ns = seoNs(lang);
  const entry = routeSeo(route);
  const title = ns[entry.titleKey];
  const description = ns[entry.descKey];
  if (!title || !description) {
    throw new Error(
      `[seo] Route "${route}" maps to locale keys "${entry.titleKey}"/"${entry.descKey}", ` +
        `but they are missing from the "seo" namespace (checked ${lang}, then en).`,
    );
  }
  return {
    title,
    description,
    keywords: entry.keywordsKey ? (ns[entry.keywordsKey] ?? "") : "",
  };
}

/** Short label per public route, for breadcrumbs and site navigation. */
function routeLabels(lang: Lang): Record<string, string> {
  const ns = seoNs(lang);
  const out: Record<string, string> = {};
  for (const [route, entry] of Object.entries(ROUTE_SEO)) {
    out[route] = ns[entry.navKey] ?? route;
  }
  return out;
}

/**
 * Reciprocal hreflang set for one route: every language pointing at every
 * other, plus x-default on the root language.
 */
export function alternatesFor(route: string): [string, string][] {
  const pairs: [string, string][] = (Object.keys(LOCALES) as Lang[]).map((l) => [
    l,
    absoluteUrl(l, route),
  ]);
  pairs.push(["x-default", absoluteUrl(DEFAULT_LANG, route)]);
  return pairs;
}

export function renderPage(lang: Lang, route: string): RenderedPage {
  setRenderLang(lang);
  // Render as a logged-out visitor: no cookie/token exists at build time, and
  // leaving the /me query pending would bake the auth skeleton into the HTML
  // instead of the "sign in" link a crawler should see.
  queryClient.setQueryData(getGetMeQueryKey(), null);

  const ssrPath = langPath(lang, route);
  const html = renderToString(<App ssrPath={ssrPath} />);
  const { title, description, keywords } = seoFor(lang, route);

  // Per-language OG card, matching what ssg.mjs writes into og:image.
  const image = `${SITE_ORIGIN}/og/og-${lang}.png`;

  const slug = ARTICLE_SLUGS.find((s) => articleRoute(s) === route) ?? null;
  const article: ArticleContent | null = slug ? articleFor(lang, slug) : null;
  const articles =
    route === "/learn"
      ? ARTICLE_SLUGS.map((s) => ({ slug: s as ArticleSlug, content: articleFor(lang, s) }))
          .filter((a): a is { slug: ArticleSlug; content: ArticleContent } => Boolean(a.content))
      : undefined;

  const graph = structuredData(
    lang,
    route,
    { title, description, routeLabels: routeLabels(lang), article, articles, image },
    faqFor(lang)
  );

  return {
    html,
    lang,
    dir: isRtlLang(lang) ? "rtl" : "ltr",
    path: ssrPath,
    title,
    description,
    canonical: absoluteUrl(lang, route),
    alternates: alternatesFor(route),
    // </script> inside a JSON string would close the tag early
    jsonLd: JSON.stringify(graph).replace(/</g, "\\u003c"),
    keywords,
  };
}

/**
 * FAQ entries rendered on the landing page, mirrored into FAQPage schema.
 * Shared with `components/landing/FaqSection.tsx` via `lib/faq-content.ts` so
 * the schema can never declare a question the page doesn't render.
 */
function faqFor(lang: Lang): { q: string; a: string }[] {
  return faqEntries(lang);
}

/** Every page the build should emit. */
export function allPages(): { lang: Lang; route: string }[] {
  const out: { lang: Lang; route: string }[] = [];
  for (const lang of Object.keys(LOCALES) as Lang[]) {
    for (const route of PUBLIC_ROUTES) out.push({ lang, route });
  }
  return out;
}

export interface SitemapEntry {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: string;
  alternates: [string, string][];
}

/**
 * One entry per language × public route, each carrying the full reciprocal
 * alternate set. Google treats the sitemap's xhtml:link annotations as an
 * equal-authority source of hreflang alongside the tags in <head> — emitting
 * both means a mistake in one is caught by the other.
 */
export function sitemapEntries(): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const route of PUBLIC_ROUTES) {
    const isHome = route === "/";
    for (const lang of ALL_LANGS) {
      const root = lang === DEFAULT_LANG;
      entries.push({
        loc: absoluteUrl(lang, route),
        lastmod: SITEMAP_LASTMOD,
        changefreq: isHome ? "weekly" : "monthly",
        // the root language is the primary market, the rest sit just below it
        priority: isHome ? (root ? "1.0" : "0.9") : root ? "0.8" : "0.7",
        alternates: alternatesFor(route),
      });
    }
  }
  return entries;
}
