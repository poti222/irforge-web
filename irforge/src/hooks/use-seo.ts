import { useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import { DEFAULT_LANG, type Lang } from "@/lib/i18n";
import { ALL_LANGS, absoluteUrl } from "@/lib/lang-routing";

/**
 * Lightweight per-route SEO hook — no extra dependency (react-helmet-async
 * etc.) needed for a two-public-page SPA. Sets document.title and updates
 * (or creates) the meta/link tags that matter for that route, then restores
 * the site-wide defaults from index.html on unmount so navigating away
 * (e.g. back to "/") doesn't leave a stale title/description behind.
 *
 * `noindex: true` is for pages that exist (and should stay reachable) but
 * shouldn't show up in search results — auth pages, mainly. robots.txt
 * disallowing a URL only stops *crawling*; it doesn't reliably stop Google
 * from indexing a bare URL it found linked elsewhere. A page-level
 * "noindex" meta tag is the actual guarantee.
 */

interface SEOOptions {
  title: string;
  description?: string;
  noindex?: boolean;
  /**
   * Public route this page represents ("/" or "/docs"). When given, the
   * canonical link, the reciprocal hreflang set and og:url are kept in sync
   * with the current language.
   *
   * The prerendered HTML already ships correct tags, so a crawler that never
   * runs JS is served the right thing regardless. This matters for the
   * client-side language switch: without it the DOM would keep advertising
   * the previous language's canonical after the content had already changed.
   */
  route?: string;
}

// Read lazily, not at module scope: this module is pulled into the prerender
// bundle, where `document` doesn't exist. Captured on first use (inside an
// effect, i.e. always in the browser) and memoised.
let defaults: { title: string; description: string } | null = null;
function siteDefaults() {
  if (!defaults) {
    defaults = {
      title: document.title,
      description:
        document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    };
  }
  return defaults;
}

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(name: string, attr: "name" | "property" = "name") {
  document.querySelector(`meta[${attr}="${name}"]`)?.remove();
}

/** Rewrite <link rel="canonical"> and the whole hreflang set for a route. */
function syncLinkTags(route: string, lang: Lang) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", absoluteUrl(lang, route));

  // replace wholesale — a partial update could leave an alternate pointing at
  // a language that no longer has this route
  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());
  const pairs: [string, string][] = [
    ...ALL_LANGS.map((l): [string, string] => [l, absoluteUrl(l, route)]),
    ["x-default", absoluteUrl(DEFAULT_LANG, route)],
  ];
  for (const [hreflang, href] of pairs) {
    const link = document.createElement("link");
    link.setAttribute("rel", "alternate");
    link.setAttribute("hreflang", hreflang);
    link.setAttribute("href", href);
    document.head.appendChild(link);
  }
}

export function useSEO({ title, description, noindex = false, route }: SEOOptions) {
  const { lang } = useLanguage();

  useEffect(() => {
    if (!route) return;
    syncLinkTags(route, lang);
    setMeta("og:url", absoluteUrl(lang, route), "property");
    setMeta("twitter:url", absoluteUrl(lang, route));
  }, [route, lang]);

  useEffect(() => {
    const site = siteDefaults();
    document.title = title;
    setMeta("og:title", title, "property");
    setMeta("twitter:title", title);

    if (description) {
      setMeta("description", description);
      setMeta("og:description", description, "property");
      setMeta("twitter:description", description);
    }

    if (noindex) {
      setMeta("robots", "noindex, follow");
    } else {
      setMeta("robots", "index, follow");
    }

    return () => {
      document.title = site.title;
      if (description) {
        setMeta("description", site.description);
        setMeta("og:description", site.description, "property");
        setMeta("twitter:description", site.description);
      }
      if (noindex) {
        setMeta("robots", "index, follow");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, noindex]);
}
