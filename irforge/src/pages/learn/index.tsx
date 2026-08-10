import { Link } from "wouter";
import { BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { ARTICLE_SLUGS, articleFor, articleRoute } from "@/lib/learn-content";

/**
 * `/learn` — the article hub. Lists every guide, which is what makes the new
 * pages reachable in one click from anywhere the hub is linked, and gives the
 * CollectionPage/ItemList schema something real to describe.
 */
export default function LearnHub() {
  const { lang } = useLanguage();
  const t = useT("learn");
  const seo = useT("seo") as Record<string, string>;

  useSEO({ title: seo.learnHubTitle, description: seo.learnHubDescription, route: "/learn" });

  const articles = ARTICLE_SLUGS.map((slug) => ({ slug, content: articleFor(lang, slug) })).filter(
    (a) => a.content,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <nav aria-label={t.breadcrumbLabel} className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{seo.navLearnHub}</li>
        </ol>
      </nav>

      <header className="space-y-3">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight sm:text-4xl">
          <BookOpen className="size-7 shrink-0" aria-hidden="true" />
          {t.hubTitle}
        </h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{t.hubIntro}</p>
      </header>

      <section className="space-y-3">
        <h2 className="sr-only">{t.hubListHeading}</h2>
        <ul className="space-y-3">
          {articles.map(({ slug, content }) => (
            <li key={slug}>
              <Link href={articleRoute(slug)} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="space-y-1.5 p-5">
                    <h3 className="font-semibold">{content!.h1}</h3>
                    <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {content!.lead}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
