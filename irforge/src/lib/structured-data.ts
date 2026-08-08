import { DEFAULT_LANG, type Lang } from "./i18n";
import { SITE_ORIGIN, absoluteUrl } from "./lang-routing";

/**
 * JSON-LD emitted into every prerendered page, in that page's language.
 *
 * Two deliberate omissions, both because the alternative would be publishing
 * a claim we can't back:
 *
 *  - `sameAs` on Organization. The only handles in the codebase live in
 *    src/config/support.ts and are labelled PLACEHOLDER values. Pointing
 *    Google at profiles that may not exist is worse than saying nothing.
 *    Fill SOCIAL_PROFILES below once the real accounts are confirmed.
 *  - `offers` on SoftwareApplication. Pricing sits behind auth (/plans is
 *    disallowed in robots.txt), so there is no public price to quote.
 *
 * Both are wired up and will start emitting the moment the constants below
 * are filled in — no schema surgery needed.
 */

/** Real, confirmed brand profiles. Empty until someone verifies them. */
export const SOCIAL_PROFILES: string[] = [];

/**
 * Set to the search results URL template once the site actually has search,
 * e.g. `${SITE_ORIGIN}/search?q={search_term_string}`. A SearchAction that
 * points at a non-existent endpoint is a broken promise to Google, so the
 * WebSite node simply omits `potentialAction` while this is null.
 */
export const SITE_SEARCH_URL: string | null = null;

const ORG_ID = `${SITE_ORIGIN}/#organization`;
const SITE_ID = `${SITE_ORIGIN}/#website`;

/** Square brand mark, comfortably above Google's 112px minimum. */
const LOGO = {
  "@type": "ImageObject",
  url: `${SITE_ORIGIN}/favicon.png`,
  width: 1254,
  height: 1254,
};

export interface SchemaStrings {
  /** page title, already language-specific */
  title: string;
  /** page description, already language-specific */
  description: string;
  /** breadcrumb label for the site root */
  homeLabel: string;
  /** breadcrumb + nav label for the docs page */
  docsLabel: string;
}

function organization() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "IrForge",
    url: `${SITE_ORIGIN}/`,
    logo: LOGO,
    ...(SOCIAL_PROFILES.length ? { sameAs: SOCIAL_PROFILES } : {}),
  };
}

function website(lang: Lang, s: SchemaStrings) {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: `${SITE_ORIGIN}/`,
    name: "IrForge",
    description: s.description,
    inLanguage: lang,
    publisher: { "@id": ORG_ID },
    ...(SITE_SEARCH_URL
      ? {
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: SITE_SEARCH_URL },
            "query-input": "required name=search_term_string",
          },
        }
      : {}),
  };
}

function softwareApplication(lang: Lang, s: SchemaStrings) {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_ORIGIN}/#software`,
    name: "IrForge",
    description: s.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: absoluteUrl(lang, "/"),
    inLanguage: lang,
    publisher: { "@id": ORG_ID },
    // offers: see the note at the top of this file
  };
}

function breadcrumbs(lang: Lang, route: string, s: SchemaStrings) {
  const items = [{ name: s.homeLabel, item: absoluteUrl(lang, "/") }];
  if (route === "/docs") items.push({ name: s.docsLabel, item: absoluteUrl(lang, "/docs") });
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.item,
    })),
  };
}

/**
 * Only genuinely public destinations belong here. Everything else in the app
 * is behind auth and noindex'd, and advertising those as site navigation
 * would point crawlers straight at pages robots.txt tells them to skip.
 */
function siteNavigation(lang: Lang, s: SchemaStrings) {
  return [
    {
      "@type": "SiteNavigationElement",
      name: s.homeLabel,
      url: absoluteUrl(lang, "/"),
    },
    {
      "@type": "SiteNavigationElement",
      name: s.docsLabel,
      url: absoluteUrl(lang, "/docs"),
    },
  ];
}

/** FAQPage — only where the page actually renders those questions. */
function faqPage(faq: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/**
 * One @graph per page so the nodes can cross-reference by @id instead of
 * repeating the organisation on every schema.
 */
export function structuredData(
  lang: Lang,
  route: string,
  s: SchemaStrings,
  faq: { q: string; a: string }[] = []
) {
  const graph: object[] = [
    organization(),
    website(lang, s),
    softwareApplication(lang, s),
    breadcrumbs(lang, route, s),
    ...siteNavigation(lang, s),
  ];
  // the FAQ only exists on the landing page
  if (route === "/" && faq.length) graph.push(faqPage(faq));

  return { "@context": "https://schema.org", "@graph": graph };
}

export { DEFAULT_LANG };
