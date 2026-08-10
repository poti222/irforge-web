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
  SITEMAP_LASTMOD,
  absoluteUrl,
  langPath,
} from "./lib/lang-routing";

import { structuredData } from "./lib/structured-data";

export { PRIVATE_ROUTES };

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

function seoFor(lang: Lang, route: string) {
  const ns = { ...LOCALES.en.seo, ...(LOCALES[lang]?.seo ?? {}) };
  if (route === "/docs") return { title: ns.docsTitle, description: ns.docsDescription };
  if (route === "/learn/bot-token")
    return { title: ns.botTokenTitle, description: ns.botTokenDescription };
  return { title: ns.homeTitle, description: ns.homeDescription };
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
  const { title, description } = seoFor(lang, route);
  const ns = { ...LOCALES.en.seo, ...(LOCALES[lang]?.seo ?? {}) };

  const graph = structuredData(
    lang,
    route,
    {
      title,
      description,
      homeLabel: ns.navHome,
      docsLabel: ns.navDocs,
      botTokenLabel: ns.navBotToken,
    },
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
    keywords: (ns as any).keywords ?? "",
  };
}

/**
 * FAQ entries rendered on the landing page, mirrored into FAQPage schema.
 * Empty until Phase 5 adds the copy — the schema simply omits the node.
 */
function faqFor(lang: Lang): { q: string; a: string }[] {
  const ns: any = { ...LOCALES.en.faq, ...(LOCALES[lang] as any)?.faq };
  const out: { q: string; a: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const q = ns[`q${i}`];
    const a = ns[`a${i}`];
    if (q && a) out.push({ q, a });
  }
  return out;
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
