import { DEFAULT_LANG, type Lang } from "./i18n";
import { PUBLIC_ROUTES, SITE_ORIGIN, absoluteUrl, ancestorRoutes } from "./lang-routing";
import { EDUCATION_CHANNEL_URL, INSTAGRAM_URL } from "@/config/support";
import {
  ARTICLE_DATES,
  ARTICLE_SLUGS,
  HOWTO_SLUGS,
  articleRoute,
  type ArticleContent,
  type ArticleSlug,
} from "./learn-content";

/**
 * JSON-LD emitted into every prerendered page, in that page's language.
 *
 * One deliberate omission, because the alternative would be publishing a
 * claim we can't back:
 *
 *  - `offers` on SoftwareApplication. `/pricing` (public, unlike `/plans`
 *    itself — see that page's own header comment, IRFORGE_PROMPT_V3 Phase
 *    44) now does show a real price, but this file only runs at prerender
 *    (build) time, while that price is fetched client-side from the
 *    admin-editable `plans` table at *request* time. Baking today's number
 *    into the static JSON-LD would drift from the live page the moment an
 *    admin changes it without a redeploy — the exact "schema disagrees with
 *    the real number" problem this omission exists to avoid in the first
 *    place, just arriving from a different direction than "no price at all".
 *
 * Revisit only if plan prices become build-time-fixed, or this file's own
 * data source stops being fully static.
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
  /** This page's article copy, when it is a /learn/* article. */
  article?: ArticleContent | null;
  /** Every article's copy in this language — used by the /learn ItemList. */
  articles?: { slug: ArticleSlug; content: ArticleContent }[];
  /** This language's OG card, absolute. */
  image?: string;
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


/** Slug for a `/learn/<slug>` route, or null for anything else. */
function articleSlugFor(route: string): ArticleSlug | null {
  const match = ARTICLE_SLUGS.find((slug) => articleRoute(slug) === route);
  return match ?? null;
}

/**
 * `Article` for a /learn page.
 *
 * `datePublished`/`dateModified` come from the hand-maintained `ARTICLE_DATES`,
 * never from build time. A `dateModified` that moves on every deploy without
 * the content changing is a false signal, and repeating it teaches the crawler
 * to ignore the field entirely.
 */
function articleNode(lang: Lang, route: string, slug: ArticleSlug, s: SchemaStrings) {
  const canonical = absoluteUrl(lang, route);
  const dates = ARTICLE_DATES[slug];
  return {
    "@type": "Article",
    "@id": `${canonical}#article`,
    // Google truncates headlines past ~110 characters.
    headline: (s.article?.h1 ?? s.title).slice(0, 110),
    description: s.description,
    inLanguage: lang,
    datePublished: dates.published,
    dateModified: dates.modified,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    mainEntityOfPage: canonical,
    ...(s.image ? { image: s.image } : {}),
  };
}

/**
 * `HowTo` for the step-by-step articles.
 *
 * Each step's `url` points at the `#step-N` anchor that `ArticleLayout`
 * renders as an `id` on the corresponding `<li>`. A HowTo whose steps don't
 * resolve to visible page content is a structured-data violation, so the
 * anchors and this node are generated from the same array.
 */
function howToNode(lang: Lang, route: string, s: SchemaStrings) {
  const canonical = absoluteUrl(lang, route);
  const steps = s.article?.steps ?? [];
  if (steps.length === 0) return null;
  return {
    "@type": "HowTo",
    "@id": `${canonical}#howto`,
    name: s.article?.h1 ?? s.title,
    description: s.description,
    inLanguage: lang,
    step: steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.name,
      text: step.text,
      url: `${canonical}#step-${i + 1}`,
    })),
  };
}

/** `CollectionPage` + `ItemList` for the /learn hub. */
function collectionNode(lang: Lang, s: SchemaStrings) {
  const canonical = absoluteUrl(lang, "/learn");
  const items = s.articles ?? [];
  return {
    "@type": "CollectionPage",
    "@id": `${canonical}#collection`,
    name: s.title,
    description: s.description,
    inLanguage: lang,
    url: canonical,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.content.h1,
        url: absoluteUrl(lang, articleRoute(item.slug)),
      })),
    },
  };
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

  const slug = articleSlugFor(route);
  if (slug) {
    graph.push(articleNode(lang, route, slug, s));
    if (HOWTO_SLUGS.includes(slug)) {
      const howTo = howToNode(lang, route, s);
      if (howTo) graph.push(howTo);
    }
    // Each article carries its own FAQ, rendered as <details> so every answer
    // is in the HTML whether or not it is expanded.
    const articleFaq = s.article?.faq ?? [];
    if (articleFaq.length) graph.push(faqPage(articleFaq));
  }

  if (route === "/learn") graph.push(collectionNode(lang, s));

  // the landing FAQ only exists on the landing page
  if (route === "/" && faq.length) graph.push(faqPage(faq));

  return { "@context": "https://schema.org", "@graph": graph };
}

export { DEFAULT_LANG };
