import { Link } from "wouter";
import { ChevronDown, Clock, Send, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { isRtlLang } from "@/lib/i18n";
import { EDUCATION_CHANNEL_URL, EDUCATION_CHANNEL_HANDLE } from "@/config/support";
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
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      {/* Breadcrumb trail, mirroring the BreadcrumbList in the page's JSON-LD. */}
      <nav aria-label={t.breadcrumbLabel} className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/learn" className="hover:text-foreground">{seo.navLearnHub}</Link></li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{seo[entry.navKey]}</li>
        </ol>
      </nav>

      <header className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{article.h1}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            {t.readingTime.replace("{n}", String(minutes))}
          </span>
        </p>
        <p className="text-lg leading-relaxed">{article.lead}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{article.outcomeTitle}</h2>
        <p className="leading-relaxed text-muted-foreground">{article.outcome}</p>
      </section>

      {article.prereqs?.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.prereqTitle}</h2>
          <ul className="list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
            {article.prereqs.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {article.steps?.length > 0 && (
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

      {article.mistakes?.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{article.mistakesTitle}</h2>
          <ul className="list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
            {article.mistakes.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      {article.faq?.length > 0 && (
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

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{article.nextTitle}</h2>
        <p className="leading-relaxed text-muted-foreground">{article.next}</p>
      </section>

      {/* Education channel — the brand's own distribution, linked from every
          article so a reader who prefers video has somewhere to go. */}
      <Card className="border-primary/30">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-semibold">{t.channelTitle}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t.channelBody}</p>
            <p className="font-mono text-xs text-muted-foreground" dir="ltr">
              {EDUCATION_CHANNEL_HANDLE}
            </p>
          </div>
          <Button asChild className="shrink-0 gap-2">
            <a href={EDUCATION_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
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

      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">{t.ctaTitle}</p>
          <p className="text-sm text-muted-foreground">{t.ctaBody}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild><Link href="/register">{t.ctaButton}</Link></Button>
          <Button asChild variant="outline"><Link href="/pricing">{t.ctaPricing}</Link></Button>
        </div>
      </div>

      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/learn">
          <BackArrow className="me-2 size-4" aria-hidden="true" /> {t.backToHub}
        </Link>
      </Button>
    </div>
  );
}
