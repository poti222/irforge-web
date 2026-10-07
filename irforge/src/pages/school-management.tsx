import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { Button } from "@/components/ui/button";
import { RichText } from "@/pages/learn/ArticleLayout";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { setPostAuthTarget } from "@/lib/post-auth";
import type { ArticleSection } from "@/lib/learn-content";

/**
 * `/school-management` — the public, indexable page for the school system.
 *
 * `/schools` itself is a private app route (login required, disallowed in
 * robots.txt), so without this page nothing about the school product was
 * visible to search engines. Everything stated here is a feature that exists
 * in the school panel (see the `schools` locale namespace and
 * components/schools/school-sidebar.tsx); no counts, testimonials or prices.
 * The FAQ is rendered as <details> so every answer is in the prerendered HTML,
 * and the same array feeds the FAQPage JSON-LD (entry-ssg.tsx).
 */
export default function SchoolManagement() {
  const t = useT("schoolPage") as Record<string, any>;
  const seo = useT("seo") as Record<string, string>;

  useSEO({ title: seo.schoolTitle, description: seo.schoolDescription, route: "/school-management" });

  const sections: ArticleSection[] = t.sections ?? [];
  const faq: { q: string; a: string }[] = t.faq ?? [];

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <nav aria-label={t.breadcrumbLabel} className="min-w-0 text-sm text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
              <li aria-hidden="true">/</li>
              <li className="text-foreground">{seo.navSchool}</li>
            </ol>
          </nav>
          <PublicPageControls />
        </div>

        <header className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.h1}</h1>
          <p className="text-lg leading-relaxed">{t.lead}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild onClick={() => setPostAuthTarget("/schools")}>
              <Link href="/login">{t.ctaButton}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/pricing">{t.ctaBots}</Link>
            </Button>
          </div>
        </header>

        {sections.map((chapter) => (
          <section key={chapter.h2} className="space-y-3">
            <h2 className="text-xl font-semibold">{chapter.h2}</h2>
            {chapter.body?.map((paragraph) => (
              <p key={paragraph} className="leading-relaxed text-muted-foreground">
                <RichText text={paragraph} />
              </p>
            ))}
            {chapter.items && chapter.items.length > 0 && (
              <ul className="list-disc space-y-2 ps-6 leading-relaxed text-muted-foreground">
                {chapter.items.map((item) => <li key={item}><RichText text={item} /></li>)}
              </ul>
            )}
          </section>
        ))}

        {faq.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{t.faqTitle}</h2>
            <div className="space-y-3">
              {faq.map((entry) => (
                <details key={entry.q} className="group rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-start font-semibold [&::-webkit-details-marker]:hidden">
                    <h3 className="text-base">{entry.q}</h3>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{entry.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold">{t.ctaTitle}</p>
            <p className="text-sm text-muted-foreground">{t.ctaBody}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild onClick={() => setPostAuthTarget("/schools")}>
              <Link href="/login">{t.ctaButton}</Link>
            </Button>
          </div>
        </div>
      </div>
      <PublicFooter />
    </>
  );
}
