import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ArrowRight, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getContentLesson,
  getSchoolMe,
  listSchoolContent,
  listSchoolSubjects,
  updateContentLesson,
  type SchoolContentType,
} from "@/lib/schools-api";
import { CONTENT_TYPE_ORDER, TYPE_LABEL_KEY, TYPE_META, contentHubHref, subjectStyle } from "@/lib/schools-subject-style";
import { ContentBreadcrumb, MasteryBar } from "@/components/schools/ContentBreadcrumb";
import { ContentTypesDialog } from "@/components/schools/ContentTypesDialog";

/**
 * pages/schools/content-lesson-hub.tsx — سطحِ سومِ «درس‌ها»: داخلِ یک درس
 * (مثلاً «درس ۳»)، کاشی‌هایِ بزرگِ *انواعِ فعالِ* محتوا (لغت‌نامه، اشعار،
 * فرمول‌ها، جزوه‌ها، کتاب‌ها) با شمارش.
 *
 * قاعده‌یِ کلیدی: نوعِ خاموش برایِ دانش‌آموز اصلاً رندر نمی‌شود (نه کاشی، نه
 * شمارش) — و سرور هم همین را enforce می‌کند (lib/schoolContentAccess.ts)، پس
 * با آدرسِ مستقیم هم دیده نمی‌شود. فقط admin/معلمِ همین موضوع کاشیِ خاموش را
 * (کم‌رنگ + نشانِ «غیرفعال» + سوییچِ روشن‌کردن) می‌بینند.
 *
 * `lessonId="none"` همان پسودوگروهِ «بدون درس» است (محتوایِ قدیمی که هنوز
 * درسی ندارد) — بدونِ تنظیمات، فقط کاشیِ typeهایی که آیتم دارند.
 */
export default function SchoolContentLessonHub() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const isNone = lessonId === "none";
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const isStudent = me?.role === "student";
  const canWriteRole = me?.role === "admin" || me?.role === "teacher";
  const hubHref = contentHubHref(me?.role);

  const { data: lesson, isLoading, isError } = useQuery({
    queryKey: ["schools", "content-lesson", schoolId, lessonId],
    queryFn: () => getContentLesson(schoolId!, lessonId),
    enabled: !isNone && !!schoolId,
    retry: false,
  });
  const { data: subjects } = useQuery({
    queryKey: ["schools", "subjects", schoolId],
    queryFn: () => listSchoolSubjects(schoolId!),
    enabled: !!schoolId,
  });
  const { data: ungrouped } = useQuery({
    queryKey: ["schools", "content", "lesson-none", schoolId],
    queryFn: () => listSchoolContent(undefined, schoolId, undefined, "none"),
    enabled: isNone && !!schoolId,
  });

  const subject = subjects?.find((s) => s.name === lesson?.subject);
  usePrivatePageTitle(isNone ? t.noLessonGroupLabel : (lesson?.title ?? ""));

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveTypes(types: SchoolContentType[] | null) {
    if (!schoolId || isNone) return;
    setSaving(true);
    try {
      await updateContentLesson(schoolId, lessonId, { enabledTypes: types });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lesson"] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons"] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "subjects"] });
      setSettingsOpen(false);
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  /** روشن/خاموشِ سریعِ یک نوع از رویِ خودِ کاشی — یک override برایِ همین جلسه می‌نویسد. */
  function toggleOne(tp: SchoolContentType, on: boolean) {
    if (!lesson) return;
    const next = CONTENT_TYPE_ORDER.filter((x) => (x === tp ? on : lesson.effectiveEnabledTypes.includes(x)));
    void saveTypes(next);
  }

  if (!isNone && isError) {
    return (
      <div className="flex flex-col gap-4">
        <ContentBreadcrumb items={[{ label: t.navLessons, href: hubHref }, { label: t.lessonNotFound }]} />
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">{t.lessonNotFound}</div>
      </div>
    );
  }

  const { color } = subjectStyle(subject);
  const canManage = isNone ? canWriteRole : !!lesson?.canManage;

  // برایِ «بدون درس» شمارش‌ها را از لیستِ (سمتِ سرور فیلترشده‌یِ) آیتم‌ها می‌سازیم.
  const noneCounts: Partial<Record<SchoolContentType, number>> = {};
  for (const it of ungrouped ?? []) noneCounts[it.type] = (noneCounts[it.type] ?? 0) + 1;

  const tiles = CONTENT_TYPE_ORDER.filter((tp) => {
    if (isNone) return (noneCounts[tp] ?? 0) > 0 || canManage;
    if (!lesson) return false;
    return lesson.effectiveEnabledTypes.includes(tp) || canManage;
  });
  const enabledVisible = isNone ? tiles : tiles.filter((tp) => lesson?.effectiveEnabledTypes.includes(tp));

  const crumbs = isNone
    ? [{ label: t.navLessons, href: hubHref }, { label: t.noLessonGroupLabel }]
    : [
        { label: t.navLessons, href: hubHref },
        { label: lesson?.subject ?? "…", href: subject ? `/schools/content/subject/${subject.id}` : undefined },
        { label: lesson?.title ?? "…" },
      ];

  // دکمه‌یِ «بازگشت» بالایِ صفحه: به موضوعِ همین درس (یا به خانه‌یِ درس‌ها برایِ «بدون درس»).
  const backHref = !isNone && subject ? `/schools/content/subject/${subject.id}` : hubHref;

  return (
    <div className="flex flex-col gap-5">
      <Link href={backHref}>
        <Button variant="ghost" className="min-h-11 w-fit px-2" data-testid="button-back">
          <ArrowRight className="me-1 size-4" /> {!isNone && subject ? t.backToSubject.replace("{name}", subject.name) : t.backToSubjects}
        </Button>
      </Link>
      <ContentBreadcrumb items={crumbs} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold" dir="auto">{isNone ? t.noLessonGroupLabel : lesson?.title}</h1>
          <p className="text-sm text-muted-foreground">{isNone ? t.noLessonGroupHint : t.lessonHubDescription}</p>
        </div>
        {!isNone && canManage && (
          <Button variant="outline" className="min-h-11" onClick={() => setSettingsOpen(true)} data-testid="button-lesson-settings">
            <Settings2 className="me-1 size-4" /> {t.typesSettingsButton}
          </Button>
        )}
      </div>

      {!isNone && isStudent && lesson && lesson.progress.total > 0 && (
        <div className="max-w-sm">
          <MasteryBar mastered={lesson.progress.mastered} total={lesson.progress.total} barClass={color.bar} label={t.masteryLabel} />
        </div>
      )}

      {(!isNone && (isLoading || !lesson)) || (isNone && !ungrouped) ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : enabledVisible.length === 0 && !canManage ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed px-4 text-center text-sm text-muted-foreground">
          {t.lessonNoTypesEnabled}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tp) => {
            const { Icon, color: tc } = TYPE_META[tp];
            const enabled = isNone ? true : !!lesson?.effectiveEnabledTypes.includes(tp);
            const count = isNone ? (noneCounts[tp] ?? 0) : (lesson?.typeCounts[tp] ?? 0);
            return (
              <Card
                key={tp}
                className={`relative overflow-hidden transition ${enabled ? tc.hoverBorder : "border-dashed opacity-70"}`}
                data-testid={`tile-type-${tp}`}
                data-enabled={enabled}
              >
                <Link href={`/schools/content/lesson/${lessonId}/${tp}`} className="flex min-h-32 flex-col justify-between gap-4 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`flex size-14 items-center justify-center rounded-2xl ${enabled ? tc.chip : "bg-muted text-muted-foreground"}`}>
                      <Icon className="size-7" />
                    </span>
                    {!enabled && <Badge variant="outline" className="text-[11px]">{t.typeDisabledBadge}</Badge>}
                  </div>
                  <div>
                    <p className="text-lg font-bold">{t[TYPE_LABEL_KEY[tp]]}</p>
                    <p className="text-xs text-muted-foreground">{t.typeItemCount.replace("{n}", count.toLocaleString("fa-IR"))}</p>
                  </div>
                </Link>
                {!isNone && canManage && (
                  <label className="flex min-h-11 items-center justify-between gap-2 border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                    <span>{enabled ? t.typeEnabledLabel : t.typeDisabledLabel}</span>
                    <Switch checked={enabled} disabled={saving} onCheckedChange={(v) => toggleOne(tp, v)} data-testid={`toggle-type-${tp}`} />
                  </label>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {!isNone && canManage && lesson && enabledVisible.length === 0 && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t.typesAllOffWarning}</p>
      )}

      {!isNone && lesson && subject && (
        <ContentTypesDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          mode="lesson"
          title={t.typesSettingsLessonTitle.replace("{name}", lesson.title)}
          current={lesson.enabledTypes}
          subjectTypes={subject.enabledTypes}
          saving={saving}
          onSave={saveTypes}
        />
      )}
    </div>
  );
}
