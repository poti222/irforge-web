import { DEFAULT_LANG, type Lang } from "./i18n";
import { PUBLIC_ROUTES, SITE_ORIGIN, absoluteUrl, ancestorRoutes } from "./lang-routing";
import { EDUCATION_CHANNEL_URL, INSTAGRAM_URL } from "@/config/support";

/**
 * JSON-LD emitted into every prerendered page, in that page's language.
 *
 * One deliberate omission, because the alternative would be publishing a
 * claim we can't back:
 *
 *  - `offers` on SoftwareApplication. Pricing sits behind auth (/plans is
 *    disallowed in robots.txt), so there is no public price to quote.
 *
 * It is wired up and will start emitting the moment a public price exists —
 * no schema surgery needed.
 */

/**
 * Real, confirmed brand profiles, published as `Organization.sameAs`.
 *
 * Both are read from src/config/support.ts so the schema, the support page and
 * the learn pages can never quote different handles. Only add a profile that
 * actually loads — a `sameAs` pointing at a dead account is worse than an
 * omitted one, because it tells Google the brand is somewhere it isn't.
 */
export const SOCIAL_PROFILES: string[] = [EDUCATION_CHANNEL_URL, INSTAGRAM_URL];

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
  /**
   * Short label per public route, already language-specific — the source for
   * both breadcrumb names and site-navigation names. Replaced the three
   * hardcoded `homeLabel`/`docsLabel`/`botTokenLabel` fields, which meant
   * every new route needed a new field and a new `if` in two functions.
   */
  routeLabels: Record<string, string>;
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

/**
 * Breadcrumb trail built from the route's own segments, not from a per-route
 * `if`. `/learn/telegram-bot-token` becomes Home → Learn → <page title>.
 *
 * The leaf uses the page title rather than the short nav label, because that
 * is what a breadcrumb rich result should read as; ancestors use their short
 * labels. Segments that aren't themselves public routes are skipped, so the
 * trail never links somewhere that doesn't exist.
 */
function breadcrumbs(lang: Lang, route: string, s: SchemaStrings) {
  const items = [{ name: s.routeLabels["/"], item: absoluteUrl(lang, "/") }];
  for (const ancestor of ancestorRoutes(route)) {
    items.push({ name: s.routeLabels[ancestor] ?? ancestor, item: absoluteUrl(lang, ancestor) });
  }
  if (route !== "/") {
    items.push({ name: s.title, item: absoluteUrl(lang, route) });
  }
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
  return PUBLIC_ROUTES.map((route) => ({
    "@type": "SiteNavigationElement",
    name: s.routeLabels[route] ?? route,
    url: absoluteUrl(lang, route),
  }));
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
