import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Star, StarOff, Bell, Users, Trash2, CheckCircle2, Link2Off } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { isRtlLang } from "@/lib/i18n";
import { getSchoolMe, listSchoolClasses } from "@/lib/schools-api";
import {
  cancelRepItem, electRep, listBotGroups, listRepCandidates, listRepItems, removeRep,
  type RepCandidate, type RepItem, type RepItemKind,
} from "@/lib/schools-reps-api";

/**
 * pages/schools/teacher/reps.tsx — «دانش‌آموزانِ منتخب» (مسئولِ کلاس):
 * معلم برایِ هر کلاسش یک یا چند دانش‌آموزِ منتخب انتخاب می‌کند. منتخب در باتِ مدرسه تکلیف/امتحان/یادآوری ثبت می‌کند و بات
 * چند روز قبل (و یک روز قبل) در گروه‌هایِ تلگرام یادآوری می‌فرستد. این‌جا معلم منتخب‌ها را مدیریت می‌کند، مواردِ ثبت‌شده را
 * می‌بیند/لغو می‌کند و گروه‌هایی را که بات در آن‌هاست می‌بیند.
 */
const KIND_KEY: Record<RepItemKind, "repsKindAssignment" | "repsKindExam" | "repsKindReminder"> = {
  assignment: "repsKindAssignment", exam: "repsKindExam", reminder: "repsKindReminder",
};
const KIND_ICON: Record<RepItemKind, string> = { assignment: "📝", exam: "🧪", reminder: "🔔" };

/** تقویم و عددِ هر زبان. موعدها به وقتِ تهران‌اند (مدرسه‌ها ایرانی‌اند)، فقط «نمایش» به زبانِ رابط است. */
const INTL_LOCALE: Record<string, string> = { fa: "fa-IR", en: "en-GB", ar: "ar", tr: "tr-TR", ru: "ru-RU" };

/** جای‌گذاریِ {name} در رشته‌یِ ترجمه. */
const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

export default function TeacherRepsPage() {
  const t = useT("schools") as any;
  const { lang } = useLanguage();
  const loc = INTL_LOCALE[lang] ?? "en-GB";
  const num = (n: number) => n.toLocaleString(loc);
  const formatDate = (iso: string): string => {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(loc, { timeZone: "Asia/Tehran", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  };
  const daysLeft = (iso: string): string => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
    const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (diff <= 0) return t.repsToday;
    if (diff === 1) return t.repsTomorrow;
    if (diff === 2) return t.repsDayAfter;
    return fill(t.repsDaysLeft, { n: num(diff) });
  };
  const remindText = (days: number[]) =>
    days.length
      ? [...days].sort((a, b) => b - a).map((d) => (d === 0 ? t.repsSameDay : fill(t.repsDaysBefore, { n: num(d) }))).join(lang === "fa" || lang === "ar" ? "، " : ", ")
      : "—";
  usePrivatePageTitle(t.navReps);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: classes, isLoading: classesLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  const [pickedClassId, setPickedClassId] = useState<string>("");
  const classId = pickedClassId || classes?.[0]?.id || "";
  const [search, setSearch] = useState("");

  const candKey = ["schools", "reps", "candidates", schoolId, classId];
  const itemsKey = ["schools", "reps", "items", schoolId, classId];
  const { data: cand, isLoading: candLoading } = useQuery({
    queryKey: candKey,
    queryFn: () => listRepCandidates(schoolId!, classId),
    enabled: !!schoolId && !!classId,
  });
  const { data: items } = useQuery({
    queryKey: itemsKey,
    queryFn: () => listRepItems(schoolId!, classId, "active"),
    enabled: !!schoolId && !!classId,
    refetchInterval: 60_000,
  });
  const { data: groupsRes } = useQuery({
    queryKey: ["schools", "reps", "groups", schoolId],
    queryFn: () => listBotGroups(schoolId!),
    enabled: !!schoolId,
  });

  const electM = useMutation({
    mutationFn: (studentMemberId: string) => electRep(schoolId!, classId, studentMemberId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: candKey }); toast({ title: t.repsElectedTitle, description: t.repsElectedDesc }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.repsElectFailed, description: err?.data?.error }),
  });
  const removeM = useMutation({
    mutationFn: (repId: string) => removeRep(schoolId!, repId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: candKey }); toast({ title: t.repsRemovedTitle }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.repsRemoveFailed, description: err?.data?.error }),
  });
  const cancelM = useMutation({
    mutationFn: (itemId: string) => cancelRepItem(schoolId!, itemId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: itemsKey }); toast({ title: t.repsCancelledTitle }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.repsCancelFailed, description: err?.data?.error }),
  });

  const students = useMemo(() => {
    const q = search.trim();
    const list = cand?.students ?? [];
    return q ? list.filter((s) => s.name.includes(q)) : list;
  }, [cand, search]);
  const myCount = (cand?.students ?? []).filter((s) => s.repId).length;
  const max = cand?.maxPerTeacher ?? 5;

  function onRemove(s: RepCandidate) {
    if (!s.repId) return;
    if (!window.confirm(fill(t.repsRemoveConfirm, { name: s.name }))) return;
    removeM.mutate(s.repId);
  }

  if (classesLoading || !me) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4" dir={isRtlLang(lang) ? "rtl" : "ltr"}>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><Star className="size-5 text-amber-500" /> {t.navReps}</h1>
        <p className="text-sm text-muted-foreground">{t.repsIntro}</p>
      </div>

      {groupsRes && !groupsRes.botActive && (
        <Alert variant="destructive">
          <AlertDescription>{t.repsBotInactive}</AlertDescription>
        </Alert>
      )}

      {!classes || classes.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          {t.repsNoClasses}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.repsClassesAria}>
            {classes.map((c) => (
              <Button
                key={c.id} role="tab" aria-selected={classId === c.id} size="sm"
                variant={classId === c.id ? "default" : "outline"} className="min-h-10"
                onClick={() => { setPickedClassId(c.id); setSearch(""); }}
                data-testid={`tab-rep-class-${c.id}`}
              >
                {c.name}
              </Button>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> {t.repsStudentsTitle}</CardTitle>
                <Badge variant="secondary" data-testid="badge-rep-count">{fill(t.repsMyCount, { n: num(myCount), max: num(max) })}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.repsSearchPlaceholder} aria-label={t.repsSearchAria} />
              {candLoading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : students.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.repsNoStudents}</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-md border">
                  {students.map((s) => {
                    const isRep = !!s.repId;
                    const busy = (electM.isPending && electM.variables === s.memberId) || (removeM.isPending && removeM.variables === s.repId);
                    return (
                      <li key={s.memberId} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid={`row-rep-student-${s.memberId}`}>
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{s.name}</span>
                            {isRep && <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500"><Star className="size-3" /> {t.repsYourRep}</Badge>}
                            {!isRep && s.repCount > 0 && <Badge variant="outline">{t.repsOtherTeacherRep}</Badge>}
                          </div>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            {s.botLinked
                              ? <><CheckCircle2 className="size-3 text-emerald-600" /> {t.repsBotLinked}</>
                              : <><Link2Off className="size-3" /> {t.repsBotNotLinked}</>}
                          </span>
                        </div>
                        {isRep ? (
                          <Button size="sm" variant="outline" className="min-h-10" disabled={busy} onClick={() => onRemove(s)}>
                            {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <StarOff className="me-1 size-4" />} {t.repsRemove}
                          </Button>
                        ) : (
                          <Button size="sm" className="min-h-10" disabled={busy || myCount >= max} onClick={() => electM.mutate(s.memberId)}>
                            {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <Star className="me-1 size-4" />} {t.repsElect}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Bell className="size-4" /> {t.repsItemsTitle}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!items || items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.repsNoItems}</p>
              ) : items.map((it: RepItem) => (
                <div key={it.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3" data-testid={`row-rep-item-${it.id}`}>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="font-medium">{KIND_ICON[it.kind]} {t[KIND_KEY[it.kind]]}: {it.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {fill(t.repsDue, { date: formatDate(it.dueDate), left: daysLeft(it.dueDate), remind: remindText(it.remindDays) })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fill(t.repsCreatedBy, { name: it.createdByName })} · {it.groups.length ? fill(t.repsGroupsLabel, { list: it.groups.join(lang === "fa" || lang === "ar" ? "، " : ", ") }) : t.repsNoGroup}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="min-h-10" disabled={cancelM.isPending && cancelM.variables === it.id}
                    onClick={() => { if (window.confirm(t.repsCancelConfirm)) cancelM.mutate(it.id); }}>
                    <Trash2 className="me-1 size-4" /> {t.repsCancel}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t.repsGroupsTitle}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {groupsRes?.groups.length ? (
            <ul className="flex flex-wrap gap-2">
              {groupsRes.groups.map((g) => (
                <li key={g.id}>
                  <Badge variant={g.canPost ? "secondary" : "destructive"}>
                    {g.title}{g.botStatus === "administrator" ? " 🛡" : ""}{!g.canPost ? ` ${t.repsGroupNoPost}` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t.repsNoBotGroups}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {t.repsGroupsHelp1}<bdi dir="ltr">/bind</bdi>{t.repsGroupsHelp2}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
