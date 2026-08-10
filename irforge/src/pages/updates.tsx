import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ImageIcon } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";

/** یک ردیف لیست — بدنه‌ی عکس‌ها را حمل نمی‌کند، فقط تعدادشان را. */
type UpdateListItem = {
  id: string;
  version: string | null;
  title: string;
  body: string;
  publishedAt: string | null;
  imageCount: number;
  seen: boolean;
};

/**
 * تاریخچه‌ی دائمی آپدیت‌های سایت. مودال داشبورد فقط یک‌بار دیده می‌شود، ولی
 * این صفحه همیشه در دسترس است.
 */
export default function Updates() {
  const { lang } = useLanguage();
  const t = useT("updates");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["updates"],
    queryFn: () => customFetch<UpdateListItem[]>("/api/updates"),
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 md:p-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Sparkles className="size-5" /> {t.title}
      </h1>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {t.loadError}
        </p>
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((u) => (
            <Link key={u.id} href={`/updates/${u.id}`} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {!u.seen && <Badge>{t.newBadge}</Badge>}
                    {u.version && (
                      <Badge variant="secondary">{t.version} {u.version}</Badge>
                    )}
                    <span className="min-w-0 font-medium">{u.title}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{u.body}</p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    {u.publishedAt && (
                      <span>
                        {t.publishedOn}{" "}
                        {new Date(u.publishedAt).toLocaleDateString(lang, { dateStyle: "long" })}
                      </span>
                    )}
                    {u.imageCount > 0 && (
                      <span className="flex items-center gap-1">
                        <ImageIcon className="size-3.5" /> {u.imageCount}
                      </span>
                    )}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t.empty}
        </p>
      )}
    </div>
  );
}
