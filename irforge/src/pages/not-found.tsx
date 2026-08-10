import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { ARTICLE_SLUGS, articleFor, articleRoute } from "@/lib/learn-content";

/**
 * 404 with real content and a way back in.
 *
 * A 404 that is a dead end wastes the visit; this one links into /learn so a
 * mistyped or stale URL still lands somewhere useful. It also injects
 * `robots: noindex` at runtime — this route is never prerendered and must
 * never be indexed, but the shared template carries no robots meta, so the tag
 * is added here and removed on unmount rather than left to leak onto whatever
 * page the visitor navigates to next.
 */
export default function NotFound() {
  const t = useT("common");
  const learnT = useT("learn");
  const { lang } = useLanguage();

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, follow";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  const suggestions = ARTICLE_SLUGS.slice(0, 4)
    .map((slug) => ({ slug, content: articleFor(lang, slug) }))
    .filter((a) => a.content);
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold">{t.notFoundTitle}</h1>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            {t.notFoundDesc}
          </p>

          <nav aria-label={learnT.relatedTitle} className="mt-6 space-y-2">
            <h2 className="text-sm font-semibold">{learnT.relatedTitle}</h2>
            <ul className="space-y-1.5 text-sm">
              {suggestions.map(({ slug, content }) => (
                <li key={slug}>
                  <Link
                    href={articleRoute(slug)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {content!.h1}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/learn" className="text-primary underline-offset-4 hover:underline">
                  {learnT.backToHub}
                </Link>
              </li>
            </ul>
          </nav>

          <Button asChild className="mt-6">
            <Link href="/">
              <Home className="me-2 h-4 w-4" /> {t.backToHome}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
