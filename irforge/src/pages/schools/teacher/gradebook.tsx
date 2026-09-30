import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Table2 } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listSchoolClasses, listSchoolMembers, getClassGradebook } from "@/lib/schools-api";

/**
 * pages/schools/teacher/gradebook.tsx — «نمره‌نامه» (فاز ۶، بندِ ۲): برایِ یکی
 * از کلاس‌های معلم، فهرستِ ترکیبیِ نمره‌های تکلیف+آزمونِ هر دانش‌آموز + یک
 * میانگینِ ساده. هیچ موتورِ نمره‌بندیِ وزن‌دار نیست — همان تصمیمِ صریحِ اسکوپ.
 */
export default function TeacherGradebookPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navGradebook);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: myClasses, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId!), enabled: !!schoolId });
  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ["schools", "gradebook", "class", selectedClassId],
    queryFn: () => getClassGradebook(schoolId!, selectedClassId),
    enabled: !!schoolId && !!selectedClassId,
  });

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navGradebook}</h1>
        <p className="text-sm text-muted-foreground">{t.gradebookPageDescription}</p>
      </div>

      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {myClasses.map((c) => (
              <Card key={c.id} className={selectedClassId === c.id ? "cursor-pointer border-primary" : "cursor-pointer"} onClick={() => setSelectedClassId(c.id)} role="button">
                <CardHeader className="pb-2"><CardTitle className="text-base">{c.name}</CardTitle></CardHeader>
              </Card>
            ))}
          </div>

          {selectedClassId && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Table2 className="size-4" /> {t.gradebookTableTitle}</CardTitle></CardHeader>
              <CardContent>
                {rowsLoading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : !rows || rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.rosterEmpty}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.memberColName}</TableHead>
                        <TableHead>{t.gradebookItemsColumn}</TableHead>
                        <TableHead className="text-end">{t.gradebookAverageColumn}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        const person = (members ?? []).find((m) => m.id === row.studentMemberId);
                        return (
                          <TableRow key={row.studentMemberId}>
                            <TableCell className="align-top font-medium">{person?.userName ?? person?.userEmail ?? row.studentMemberId}</TableCell>
                            <TableCell>
                              {row.items.length === 0 ? (
                                <span className="text-xs text-muted-foreground">{t.gradebookNoItems}</span>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {row.items.map((item) => (
                                    <Badge key={`${item.itemType}-${item.itemId}`} variant="outline" className="gap-1">
                                      <span>{item.itemTitle}</span>
                                      <span dir="ltr">{item.value ?? "—"}</span>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-end font-semibold" dir="ltr">
                              {row.average !== null ? row.average.toFixed(1) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
