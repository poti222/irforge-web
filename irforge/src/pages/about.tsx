import { Link } from "wouter";
import { Instagram, Send } from "lucide-react";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicNav } from "@/components/layout/PublicNav";
import { ForgePanel } from "@/components/forge-ui/ForgePanel";
import { BuildBotCta } from "@/components/learn/BuildBotCta";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RichText } from "@/pages/learn/ArticleLayout";
import { useSupportLinks } from "@/config/support";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import type { ArticleSection } from "@/lib/learn-content";

/**
 * `/about` — who runs the service and how to reach it.
 *
 * Trust pages are an E-E-A-T signal only if they say something checkable, so
 * everything here is either a fact the product demonstrably does (the same
 * facts the landing page and the guides state) or a real, working contact
 * channel read from the support config. There are deliberately no team photos,
 * founding stories, customer counts or awards: none of that exists in the
 * repository to be quoted, and a trust page that invents it is worse than none.
 */
export default function About() {
  const t = useT("about") as Record<string, any>;
  const seo = useT("seo") as Record<string, string>;
  const { educationChannelUrl, educationChannelHandle, instagramUrl, instagramHandle } = useSupportLinks();

  useSEO({ title: seo.aboutTitle, description: seo.aboutDescription, route: "/about" });

  const sections: ArticleSection[] = t.sections ?? [];

  return (
    <>
      <PublicNav />
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <nav aria-label={t.breadcrumbLabel} className="min-w-0 text-sm text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
              <li aria-hidden="true">/</li>
              <li className="text-foreground">{seo.navAbout}</li>
            </ol>
          </nav>
          </div>

        <ForgePanel as="header" className="space-y-4 p-7 sm:p-12" embers={14}>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.h1}</h1>
          <BuildBotCta />
          <p className="text-lg leading-relaxed">{t.lead}</p>
        </ForgePanel>

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

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t.contactTitle}</h2>
          <p className="leading-relaxed text-muted-foreground">{t.contactBody}</p>
          <Card>
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:flex-wrap">
              <Button asChild variant="outline" className="gap-2">
                <a href={educationChannelUrl} target="_blank" rel="noopener noreferrer">
                  <Send className="size-4" aria-hidden="true" />
                  <span>{t.contactChannel}</span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">{educationChannelHandle}</span>
                </a>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <a href={instagramUrl} target="_blank" rel="noopener noreferrer">
                  <Instagram className="size-4" aria-hidden="true" />
                  <span>{t.contactInstagram}</span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">{instagramHandle}</span>
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>

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
      </div>
      <PublicFooter />
    </>
  );
}
