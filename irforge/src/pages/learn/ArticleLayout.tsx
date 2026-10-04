import type { ReactNode } from "react";
import { Link } from "wouter";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { BuildBotCta } from "@/components/learn/BuildBotCta";
import { ChevronDown, Clock, Send, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { isRtlLang } from "@/lib/i18n";
import { useSupportLinks } from "@/config/support";
import {
  RELATED,
  articleFor,
  articleRoute,
  readingMinutes,
  type ArticleSlug,
} from "@/lib/learn-content";
import { ROUTE_SEO } from "@/lib/lang-routing";

/**
 * Shared shell for every `/learn/*` article.
 *
 * Two rules this component exists to enforce:
 *
 *  1. **Everything renders unconditionally.** `ssg.mjs` neutralises framer's
 *     inline `opacity:0`, but content a Radix component unmounts — a collapsed
 *     accordion, an inactive tab — is simply *absent* from the HTML a crawler
 *     receives. The FAQ therefore uses native `<details>/<summary>`, the same
 *     pattern as `components/landing/FaqSection.tsx`, so every answer is in
 *     the markup whether or not it is expanded. That matters doubly here
 *     because those answers are mirrored into FAQPage schema.
 *  2. **One `<h1>`, then `<h2>`/`<h3>` in strict order.** Section headings are
 *     never demoted or skipped for styling; size comes from classes.
 */

/**
 * Inline links inside article prose: `[anchor text](/learn/some-slug)`.
 *
 * Contextual links — a sentence that names another guide and links to it — are
 * worth more to a reader and to a crawler than a link list at the bottom of the
 * page, but the copy lives in locale JSON, where raw JSX can't go. This renders
 * the one tiny syntax we need and nothing else: the target must be a
 * root-relative path (the router `base` adds the language prefix, so it must
 * never be written into the copy), and anything that doesn't match is shown as
 * plain text rather than guessed at. Used only for `sections` and `next`, which
 * are not mirrored into schema — FAQ answers, which are, stay link-free.
 */
const INLINE_LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_LINK)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    nodes.push(
      <Link key={`${at}-${match[2]}`} href={match[2]} className="text-primary underline-offset-4 hover:underline">
        {match[1]}
      </Link>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

/** Anchor for step N — HowTo schema points at these, so they must exist. */
export function stepAnchor(index: number): string {
  return `step-${index + 1}`;
}

export function ArticleLayout({ slug }: { slug: ArticleSlug }) {
  const { lang } = useLanguage();
  const t = useT("learn");
  const seo = useT("seo") as Record<string, string>;
  const route = articleRoute(slug);
  const entry = ROUTE_SEO[route];
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;
  const { educationChannelUrl, educationChannelHandle } = useSupportLinks();

  useSEO({
    title: seo[entry.titleKey],
    description: seo[entry.descKey],
    route,
  });

  const article = articleFor(lang, slug);
  if (!article) return null;

  const minutes = readingMinutes(article);
  const related = RELATED[slug]
    .map((s) => ({ slug: s, content: articleFor(lang, s) }))
    .filter((r) => r.content);

  return (
    <>
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      {/* Breadcrumb trail, mirroring the BreadcrumbList in the page's JSON-LD. */}
      <div className="flex items-center justify-between gap-3">
        <nav aria-label={t.breadcrumbLabel} className="min-w-0 text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/learn" className="hover:text-foreground">{seo.navLearnHub}</Link></li>
            <li aria-hidden="true">/</li>
            <li className="text-foreground">{seo[entry.navKey]}</li>
          </ol>
        </nav>
        <PublicPageControls />
      </div>

      <header className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{article.h1}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            {t.readingTime.replace("{n}", String(minutes))}
          </span>
        </p>
        {/* On screen before any scrolling: the point of the page is that the reader
            goes and builds the bot. A second one closes the page below. */}
        <BuildBotCta />
        <p className="text-lg leading-relaxed">{article.lead}</p>
      </header>

      {article.outcome && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.outcomeTitle}</h2>
          <p className="leading-relaxed text-muted-foreground">{article.outcome}</p>
        </section>
      )}

      {/* Free-form chapters. Explanatory pages ("what is a bot", "how to pick a
          builder") are not sequences, so they get plain <h2> sections rather
          than numbered steps. Order in the markup is order on the page. */}
      {article.sections?.map((chapter) => (
        <section key={chapter.h2} className="space-y-3">
          <h2 className="text-xl font-semibold">{chapter.h2}</h2>
          {chapter.body?.map((paragraph) => (
            <p key={paragraph} className="leading-relaxed text-muted-foreground"><RichText text={paragraph} /></p>
          ))}
          {chapter.items && chapter.items.length > 0 && (
            <ul className="list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
              {chapter.items.map((item) => <li key={item}><RichText text={item} /></li>)}
            </ul>
          )}
        </section>
      ))}

      {article.prereqs && article.prereqs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.prereqTitle}</h2>
          <ul className="list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
            {article.prereqs.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {article.steps && article.steps.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{article.stepsTitle}</h2>
          {/* <ol> so the sequence survives without CSS and reads correctly to a
              screen reader. Each <li> carries the id the HowTo schema links to. */}
          <ol className="space-y-4">
            {article.steps.map((step, i) => (
              <li key={step.name} id={stepAnchor(i)} className="scroll-mt-24">
                <Card>
                  <CardContent className="flex gap-4 p-5">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <h3 className="font-semibold">{step.name}</h3>
                      <p className="leading-relaxed text-muted-foreground">{step.text}</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}

      {article.mistakes && article.mistakes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.mistakesTitle}</h2>
          <ul className="list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
            {article.mistakes.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {article.faq && article.faq.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.faqTitle}</h2>
          <div className="space-y-3">
            {article.faq.map((entryFaq) => (
              <details
                key={entryFaq.q}
                className="group rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-start font-semibold [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base">{entryFaq.q}</h3>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="mt-3 leading-relaxed text-muted-foreground">{entryFaq.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {article.next && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.nextTitle}</h2>
          <p className="leading-relaxed text-muted-foreground"><RichText text={article.next} /></p>
        </section>
      )}

      {/* Education channel — the brand's own distribution, linked from every
          article so a reader who prefers video has somewhere to go. */}
      <Card className="border-primary/30">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-semibold">{t.channelTitle}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t.channelBody}</p>
            <p className="font-mono text-xs text-muted-foreground" dir="ltr">
              {educationChannelHandle}
            </p>
          </div>
          <Button asChild className="shrink-0 gap-2">
            <a href={educationChannelUrl} target="_blank" rel="noopener noreferrer">
              <Send className="size-4" aria-hidden="true" />
              {t.channelCta}
            </a>
          </Button>
        </CardContent>
      </Card>

      {related.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t.relatedTitle}</h2>
          <ul className="space-y-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={articleRoute(r.slug)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {r.content!.h1}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t.ctaTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.ctaBody}</p>
        </div>
        <BuildBotCta showNote={false} className="border-0 bg-transparent p-0 sm:justify-start sm:p-0" />
        <Button asChild variant="link" className="h-auto p-0">
          <Link href="/pricing">{t.ctaPricing}</Link>
        </Button>
      </section>

      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/learn">
          <BackArrow className="me-2 size-4" aria-hidden="true" /> {t.backToHub}
        </Link>
      </Button>
    </div>
      <PublicFooter />
    </>
  );
}
