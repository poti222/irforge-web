import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { isRtlLang } from "@/lib/i18n";
import type { SiteUpdateDetail } from "@/hooks/use-unseen-update";
import { UpdateBlocks } from "@/components/updates/UpdateBlocks";

export default function UpdateDetail() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useLanguage();
  const t = useT("updates");
  // فلش «برگشت» باید به عقب اشاره کند، که در RTL یعنی راست.
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  const { data, isLoading, error } = useQuery({
    queryKey: ["update", id],
    queryFn: () => customFetch<SiteUpdateDetail>(`/api/updates/${id}`),
    enabled: Boolean(id),
    retry: false,
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" className="gap-1.5 px-2" asChild>
        <Link href="/updates">
          <BackArrow className="size-4" /> {t.back}
        </Link>
      </Button>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-md bg-muted" />
          <div className="h-40 animate-pulse rounded-md bg-muted" />
        </div>
      ) : error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {(error as any)?.status === 404 ? t.notFound : t.loadError}
        </p>
      ) : data ? (
        <article className="space-y-5">
          <header className="space-y-2">
            {data.version && (
              <Badge variant="secondary">{t.version} {data.version}</Badge>
            )}
            <h1 className="text-2xl font-bold">{data.title}</h1>
            {data.publishedAt && (
              <p className="text-xs text-muted-foreground">
                {t.publishedOn}{" "}
                {new Date(data.publishedAt).toLocaleDateString(lang, { dateStyle: "long" })}
              </p>
            )}
          </header>

          {/* همان رندری که مودال و پیش‌نمایشِ ادیتور استفاده می‌کنند. */}
          <UpdateBlocks blocks={data.blocks ?? []} />
        </article>
      ) : null}
    </div>
  );
}
