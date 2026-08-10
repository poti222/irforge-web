import { Link } from "wouter";
import { Send, Instagram } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { EDUCATION_CHANNEL_URL, INSTAGRAM_URL } from "@/config/support";
import { ARTICLE_SLUGS, articleFor, articleRoute } from "@/lib/learn-content";

/**
 * Footer for the public, indexable pages.
 *
 * The site had none, which made this the single highest-leverage internal-link
 * change available: every public page now links to every article, so a crawler
 * arriving on any one of them can reach the whole hub in one hop.
 *
 * Every link is a wouter `<Link>` with a root-relative href. The router `base`
 * already carries the language prefix, so hardcoding one here would produce
 * `/en/en/learn` — never write the prefix by hand.
 */
export function PublicFooter() {
  const { lang } = useLanguage();
  const t = useT("footer");
  const seo = useT("seo") as Record<string, string>;

  const articles = ARTICLE_SLUGS.map((slug) => ({ slug, content: articleFor(lang, slug) })).filter(
    (a) => a.content,
  );

  return (
    <footer className="border-t bg-muted/30">
      <div className="container mx-auto grid gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">{t.productTitle}</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
            <li><Link href="/docs" className="hover:text-foreground">{seo.navDocs}</Link></li>
            <li><Link href="/pricing" className="hover:text-foreground">{seo.navPricing}</Link></li>
            <li><Link href="/register" className="hover:text-foreground">{t.getStarted}</Link></li>
          </ul>
        </div>

        <div className="space-y-3 sm:col-span-2">
          <h2 className="text-sm font-semibold">{t.learnTitle}</h2>
          <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li><Link href="/learn" className="hover:text-foreground">{seo.navLearnHub}</Link></li>
            {articles.map(({ slug }) => (
              <li key={slug}>
                <Link href={articleRoute(slug)} className="hover:text-foreground">
                  {seo[`nav${slug}`] ?? articleFor(lang, slug)!.h1}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">{t.companyTitle}</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <a
                href={EDUCATION_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Send className="size-3.5" aria-hidden="true" /> {t.telegram}
              </a>
            </li>
            <li>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <Instagram className="size-3.5" aria-hidden="true" /> {t.instagram}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 border-t py-6 text-center text-xs text-muted-foreground">
        {/* Explicit width/height so the image reserves its box before it
            loads — an unsized image is a Cumulative Layout Shift. */}
        <img
          src="/lion-sun-flag.png"
          alt={t.flagAlt}
          width={64}
          height={38}
          loading="lazy"
          decoding="async"
          className="h-3.5 w-auto rounded-sm"
        />
        <p>{t.rights.replace("{year}", "2026")}</p>
      </div>
    </footer>
  );
}
