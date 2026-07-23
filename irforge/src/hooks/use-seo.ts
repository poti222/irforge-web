import { useEffect } from "react";

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
}

const DEFAULT_TITLE = document.title;
const DEFAULT_DESCRIPTION =
  document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";

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

export function useSEO({ title, description, noindex = false }: SEOOptions) {
  useEffect(() => {
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
      document.title = DEFAULT_TITLE;
      if (description) {
        setMeta("description", DEFAULT_DESCRIPTION);
        setMeta("og:description", DEFAULT_DESCRIPTION, "property");
        setMeta("twitter:description", DEFAULT_DESCRIPTION);
      }
      if (noindex) {
        setMeta("robots", "index, follow");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, noindex]);
}
