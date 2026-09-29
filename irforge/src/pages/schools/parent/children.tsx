import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, GraduationCap } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { listMyChildren } from "@/lib/schools-api";

/**
 * pages/schools/parent/children.tsx — نمایِ فقط‌خواندنیِ فرزندانِ والد (فاز
 * ۲). پیوندِ والد↔دانش‌آموز فقط توسطِ مدیر ساخته می‌شود (صفحه‌ی مدیریتِ اعضا)؛
 * اینجا فقط لیستش را می‌بیند.
 */
export default function ParentChildrenPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navChildrenOverview);

  const { data: children, isLoading } = useQuery({ queryKey: ["schools", "my-children"], queryFn: listMyChildren });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navChildrenOverview}</h1>
        <p className="text-sm text-muted-foreground">{t.parentChildrenDescription}</p>
      </div>

      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : !children || children.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.noChildrenLinked}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {children.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GraduationCap className="size-4" /> {c.grade ?? "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {c.school?.name ?? "—"} {c.city ? `· ${c.city}` : ""}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
