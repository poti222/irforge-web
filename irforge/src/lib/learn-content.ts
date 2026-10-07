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

/**
 * A free-form chapter: an <h2>, some paragraphs and an optional bullet list.
 *
 * The step-by-step fields below suit "how do I do X" guides; explanatory
 * pages ("what is a Telegram bot", "how to choose a builder") are not
 * sequences, and forcing them into numbered steps would be dishonest
 * structure. `sections` renders between the outcome and the step list.
 */
export interface ArticleSection {
  h2: string;
  body?: string[];
  items?: string[];
}

export interface ArticleContent {
  /** the <h1>; carries this language's primary target phrase */
  h1: string;
  /** opening paragraph — the primary phrase belongs in the first 100 words */
  lead: string;
  outcomeTitle?: string;
  outcome?: string;
  /** free-form chapters, rendered after the outcome — see ArticleSection */
  sections?: ArticleSection[];
  prereqTitle?: string;
  prereqs?: string[];
  stepsTitle?: string;
  steps?: ArticleStep[];
  mistakesTitle?: string;
  mistakes?: string[];
  faqTitle?: string;
  faq?: ArticleFaq[];
  nextTitle?: string;
  next?: string;
}

/**
 * Order is reading order: it drives the /learn hub list, the footer and the
 * hub's ItemList schema — from "what is it" through "build it" and "sell with
 * it" to reference material.
 */
export const ARTICLE_SLUGS = [
  "what-is-a-telegram-bot",
  "how-to-make-a-telegram-bot",
  "telegram-bot-token",
  "telegram-bot-without-coding",
  "choose-a-telegram-bot-builder",
  "telegram-shop-bot",
  "telegram-support-bot",
  "telegram-bot-menu-buttons",
  "telegram-bot-broadcast",
  "telegram-bot-google-sheets",
  "telegram-bot-cost",
  "botfather-commands",
  "telegram-bot-webhook-vs-polling",
  "buy-telegram-bot",
  "telegram-booking-bot",
  "telegram-giveaway-bot",
  "telegram-survey-quiz-bot",
  "telegram-bot-card-payment",
  "telegram-bot-wallet",
  "telegram-bot-crm-scheduled-messages",
] as const;

export type ArticleSlug = (typeof ARTICLE_SLUGS)[number];

/** The step-by-step articles, which additionally emit `HowTo` schema. */
export const HOWTO_SLUGS: readonly ArticleSlug[] = [
  "telegram-bot-token",
  "how-to-make-a-telegram-bot",
  "botfather-commands",
  "telegram-bot-menu-buttons",
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
  "what-is-a-telegram-bot": { published: "2026-10-04", modified: "2026-10-04" },
  "telegram-bot-token": { published: "2026-08-10", modified: "2026-08-10" },
  "how-to-make-a-telegram-bot": { published: "2026-08-10", modified: "2026-10-04" },
  "choose-a-telegram-bot-builder": { published: "2026-10-04", modified: "2026-10-04" },
  "telegram-shop-bot": { published: "2026-08-10", modified: "2026-10-04" },
  "telegram-support-bot": { published: "2026-08-10", modified: "2026-10-04" },
  "telegram-bot-menu-buttons": { published: "2026-10-04", modified: "2026-10-04" },
  "telegram-bot-broadcast": { published: "2026-10-04", modified: "2026-10-04" },
  "telegram-bot-without-coding": { published: "2026-08-10", modified: "2026-10-04" },
  "telegram-bot-google-sheets": { published: "2026-08-10", modified: "2026-10-04" },
  "telegram-bot-cost": { published: "2026-08-10", modified: "2026-10-04" },
  "botfather-commands": { published: "2026-08-10", modified: "2026-08-10" },
  "telegram-bot-webhook-vs-polling": { published: "2026-08-10", modified: "2026-08-10" },
  "buy-telegram-bot": { published: "2026-10-07", modified: "2026-10-07" },
  "telegram-booking-bot": { published: "2026-10-07", modified: "2026-10-07" },
  "telegram-giveaway-bot": { published: "2026-10-07", modified: "2026-10-07" },
  "telegram-survey-quiz-bot": { published: "2026-10-07", modified: "2026-10-07" },
  "telegram-bot-card-payment": { published: "2026-10-07", modified: "2026-10-07" },
  "telegram-bot-wallet": { published: "2026-10-07", modified: "2026-10-07" },
  "telegram-bot-crm-scheduled-messages": { published: "2026-10-07", modified: "2026-10-07" },
};

/**
 * Related articles per slug — at least three each, so every article is a real
 * hub node rather than a dead end. A new hub only gets crawled if its pages
 * link to each other; this map is what makes that true by construction.
 *
 * Shape of the cluster: "what is a bot" and "how to make one" are the entry
 * points; the use-case guides (shop, support, buttons, broadcast) hang off
 * them; cost / choose-a-builder serve the buying-comparison intent and link
 * back to the no-code guide and the shop guide.
 */
export const RELATED: Record<ArticleSlug, ArticleSlug[]> = {
  "what-is-a-telegram-bot": [
    "how-to-make-a-telegram-bot",
    "telegram-bot-without-coding",
    "telegram-bot-token",
    "telegram-shop-bot",
    "buy-telegram-bot",
  ],
  "telegram-bot-token": [
    "how-to-make-a-telegram-bot",
    "botfather-commands",
    "telegram-bot-without-coding",
  ],
  "how-to-make-a-telegram-bot": [
    "telegram-bot-token",
    "telegram-bot-without-coding",
    "telegram-shop-bot",
    "telegram-bot-menu-buttons",
  ],
  "choose-a-telegram-bot-builder": [
    "telegram-bot-without-coding",
    "telegram-bot-cost",
    "telegram-shop-bot",
    "telegram-bot-google-sheets",
    "buy-telegram-bot",
  ],
  "telegram-shop-bot": [
    "telegram-bot-menu-buttons",
    "telegram-bot-google-sheets",
    "telegram-bot-broadcast",
    "telegram-bot-cost",
    "telegram-bot-card-payment",
    "telegram-bot-wallet",
    "telegram-booking-bot",
  ],
  "telegram-support-bot": [
    "telegram-bot-menu-buttons",
    "how-to-make-a-telegram-bot",
    "telegram-bot-google-sheets",
    "telegram-bot-broadcast",
  ],
  "telegram-bot-menu-buttons": [
    "how-to-make-a-telegram-bot",
    "telegram-shop-bot",
    "telegram-support-bot",
    "telegram-bot-broadcast",
  ],
  "telegram-bot-broadcast": [
    "telegram-shop-bot",
    "telegram-bot-menu-buttons",
    "telegram-support-bot",
    "telegram-bot-crm-scheduled-messages",
    "telegram-giveaway-bot",
  ],
  "telegram-bot-without-coding": [
    "how-to-make-a-telegram-bot",
    "choose-a-telegram-bot-builder",
    "telegram-bot-cost",
    "telegram-shop-bot",
    "telegram-booking-bot",
    "telegram-giveaway-bot",
  ],
  "telegram-bot-google-sheets": [
    "telegram-shop-bot",
    "telegram-support-bot",
    "how-to-make-a-telegram-bot",
    "telegram-bot-cost",
  ],
  "telegram-bot-cost": [
    "telegram-bot-without-coding",
    "choose-a-telegram-bot-builder",
    "telegram-shop-bot",
    "how-to-make-a-telegram-bot",
    "buy-telegram-bot",
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
  "buy-telegram-bot": [
    "telegram-bot-cost",
    "choose-a-telegram-bot-builder",
    "how-to-make-a-telegram-bot",
    "telegram-shop-bot",
  ],
  "telegram-booking-bot": [
    "telegram-bot-google-sheets",
    "telegram-bot-broadcast",
    "telegram-bot-without-coding",
    "buy-telegram-bot",
  ],
  "telegram-giveaway-bot": [
    "telegram-bot-broadcast",
    "telegram-survey-quiz-bot",
    "telegram-bot-without-coding",
    "buy-telegram-bot",
  ],
  "telegram-survey-quiz-bot": [
    "telegram-bot-broadcast",
    "telegram-giveaway-bot",
    "telegram-bot-crm-scheduled-messages",
    "how-to-make-a-telegram-bot",
  ],
  "telegram-bot-card-payment": [
    "telegram-shop-bot",
    "telegram-bot-wallet",
    "telegram-support-bot",
    "buy-telegram-bot",
  ],
  "telegram-bot-wallet": [
    "telegram-shop-bot",
    "telegram-bot-card-payment",
    "telegram-bot-cost",
    "buy-telegram-bot",
  ],
  "telegram-bot-crm-scheduled-messages": [
    "telegram-bot-broadcast",
    "telegram-survey-quiz-bot",
    "telegram-shop-bot",
    "telegram-bot-without-coding",
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
  const merged = { ...(base ?? {}), ...(local ?? {}) } as ArticleContent;
  // `sections` is the one key that must NOT fall back to English. A page that
  // has no extra chapters in its own language is simply shorter; one that
  // silently grew English chapters in the middle of Arabic prose is not a page
  // anyone — user or crawler — can make sense of.
  if (local && !local.sections) delete merged.sections;
  if (!local && lang !== "en") delete merged.sections;
  return merged;
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
    ...(article.sections ?? []).flatMap((c) => [c.h2, ...(c.body ?? []), ...(c.items ?? [])]),
    ...(article.prereqs ?? []),
    ...(article.steps ?? []).flatMap((s) => [s.name, s.text]),
    ...(article.mistakes ?? []),
    ...(article.faq ?? []).flatMap((f) => [f.q, f.a]),
    article.next,
  ].filter((part): part is string => Boolean(part));
  const words = parts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
