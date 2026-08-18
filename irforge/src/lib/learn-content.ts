import { getFallbackLocale, getLocale } from "@/locales/registry";
import type { Lang } from "./i18n";

/**
 * The `/learn` article layer.
 *
 * Copy lives in the `learn.articles` object of each locale file; everything
 * that isn't prose — slugs, ordering, related-article links, publication
 * dates — lives here in code, because those must be identical in all five
 * languages and a translator editing JSON should not be able to change them.
 */

export interface ArticleStep {
  name: string;
  text: string;
}

export interface ArticleFaq {
  q: string;
  a: string;
}

export interface ArticleContent {
  /** the <h1>; carries this language's primary target phrase */
  h1: string;
  /** opening paragraph — the primary phrase belongs in the first 100 words */
  lead: string;
  outcomeTitle: string;
  outcome: string;
  prereqTitle: string;
  prereqs: string[];
  stepsTitle: string;
  steps: ArticleStep[];
  mistakesTitle: string;
  mistakes: string[];
  faqTitle: string;
  faq: ArticleFaq[];
  nextTitle: string;
  next: string;
}

export const ARTICLE_SLUGS = [
  "telegram-bot-token",
  "how-to-make-a-telegram-bot",
  "telegram-shop-bot",
  "telegram-support-bot",
  "telegram-bot-without-coding",
  "telegram-bot-google-sheets",
  "telegram-bot-cost",
  "botfather-commands",
  "telegram-bot-webhook-vs-polling",
] as const;

export type ArticleSlug = (typeof ARTICLE_SLUGS)[number];

/** The step-by-step articles, which additionally emit `HowTo` schema. */
export const HOWTO_SLUGS: readonly ArticleSlug[] = [
  "telegram-bot-token",
  "how-to-make-a-telegram-bot",
  "botfather-commands",
];

/**
 * Publication dates, deliberately **not** derived from build time.
 *
 * `SITEMAP_LASTMOD` follows the same principle: a `dateModified` that moves on
 * every deploy without the content changing is telling the crawler something
 * untrue, and it trains it to ignore the field. Bump `modified` by hand when
 * an article's copy actually changes.
 */
export const ARTICLE_DATES: Record<ArticleSlug, { published: string; modified: string }> = {
  "telegram-bot-token": { published: "2026-08-10", modified: "2026-08-10" },
  "how-to-make-a-telegram-bot": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-shop-bot": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-support-bot": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-bot-without-coding": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-bot-google-sheets": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-bot-cost": { published: "2026-08-10", modified: "2026-08-10" },
  "botfather-commands": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-bot-webhook-vs-polling": { published: "2026-08-10", modified: "2026-08-10" },
};

/**
 * Related articles per slug — at least three each, so every article is a real
 * hub node rather than a dead end. A new hub only gets crawled if its pages
 * link to each other; this map is what makes that true by construction.
 */
export const RELATED: Record<ArticleSlug, ArticleSlug[]> = {
  "telegram-bot-token": [
    "how-to-make-a-telegram-bot",
    "botfather-commands",
    "telegram-bot-without-coding",
  ],
  "how-to-make-a-telegram-bot": [
    "telegram-bot-token",
    "telegram-bot-without-coding",
    "telegram-shop-bot",
  ],
  "telegram-shop-bot": [
    "telegram-bot-google-sheets",
    "how-to-make-a-telegram-bot",
    "telegram-bot-cost",
  ],
  "telegram-support-bot": [
    "how-to-make-a-telegram-bot",
    "telegram-bot-google-sheets",
    "telegram-bot-without-coding",
  ],
  "telegram-bot-without-coding": [
    "how-to-make-a-telegram-bot",
    "telegram-bot-cost",
    "telegram-shop-bot",
  ],
  "telegram-bot-google-sheets": [
    "telegram-shop-bot",
    "telegram-support-bot",
    "how-to-make-a-telegram-bot",
  ],
  "telegram-bot-cost": [
    "telegram-bot-without-coding",
    "telegram-shop-bot",
    "how-to-make-a-telegram-bot",
  ],
  "botfather-commands": [
    "telegram-bot-token",
    "how-to-make-a-telegram-bot",
    "telegram-bot-webhook-vs-polling",
  ],
  "telegram-bot-webhook-vs-polling": [
    "how-to-make-a-telegram-bot",
    "botfather-commands",
    "telegram-bot-google-sheets",
  ],
};

/** Route for a slug — the slug is identical in every language. */
export function articleRoute(slug: ArticleSlug): string {
  return `/learn/${slug}`;
}

// locales are lazily loaded — see locales/registry.ts

/**
 * One article's copy in one language, falling back to English per key.
 *
 * The per-key fallback matches `useT`: a half-translated article shows English
 * for the missing pieces rather than `undefined`, which would render as a
 * blank section in the prerendered HTML.
 */
export function articleFor(lang: Lang, slug: ArticleSlug): ArticleContent | null {
  const base = (getFallbackLocale() as any)?.learn?.articles?.[slug];
  const local = (getLocale(lang) as any)?.learn?.articles?.[slug];
  if (!base && !local) return null;
  return { ...(base ?? {}), ...(local ?? {}) } as ArticleContent;
}

/**
 * Rough reading time in minutes from the rendered copy.
 *
 * Counts whitespace-separated tokens, which under-counts Persian and Arabic
 * slightly and over-counts nothing — a reading-time estimate only has to be
 * honest to the nearest minute.
 */
export function readingMinutes(article: ArticleContent): number {
  const parts = [
    article.lead,
    article.outcome,
    ...(article.prereqs ?? []),
    ...(article.steps ?? []).flatMap((s) => [s.name, s.text]),
    ...(article.mistakes ?? []),
    ...(article.faq ?? []).flatMap((f) => [f.q, f.a]),
    article.next,
  ].filter(Boolean);
  const words = parts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
