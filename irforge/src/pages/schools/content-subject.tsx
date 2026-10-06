import { useState } from "react";
import { useActiveSchoolId } from "@/hooks/use-viewed-school";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowDown, ArrowRight, ArrowUp, Loader2, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  createContentLesson,
  deleteContentLesson,
  getSchoolMe,
  getSchoolSubject,
  listContentLessons,
  reorderContentLessons,
  updateContentLesson,
  updateSchoolSubject,
  type SchoolContentLesson,
  type SchoolContentType,
} from "@/lib/schools-api";
import { CONTENT_TYPE_ORDER, TYPE_LABEL_KEY, contentHubHref, subjectStyle } from "@/lib/schools-subject-style";
import { ContentBreadcrumb, MasteryBar } from "@/components/schools/ContentBreadcrumb";
import { ContentTypesDialog } from "@/components/schools/ContentTypesDialog";

/**
 * pages/schools/content-subject.tsx — سطحِ دومِ «درس‌ها»: فهرستِ درس‌هایِ
 * (جلسه‌هایِ) یک موضوع، با شماره/ترتیب، شمارشِ هر نوعِ محتوا و (برایِ
 * دانش‌آموز) نوارِ تسلط. admin و معلمِ تخصیص‌داده‌شده به همین موضوع
 * (`subject.canManage`، همان گیتِ موضوعیِ سرور) می‌توانند درس بسازند/نام عوض
 * کنند/حذف و جابه‌جا کنند و انواعِ فعالِ پیش‌فرضِ موضوع را تنظیم کنند.
 */
export default function SchoolContentSubject() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useActiveSchoolId(me);
  const isStudent = me?.role === "student";
  const hubHref = contentHubHref(me?.role);

  const { data: subject, isLoading: subjectLoading, isError } = useQuery({
    queryKey: ["schools", "subject", schoolId, subjectId],
    queryFn: () => getSchoolSubject(schoolId!, subjectId),
    enabled: !!schoolId,
    retry: false,
  });
  usePrivatePageTitle(subject?.name ?? t.navLessons);

  const { data: lessons, isLoading: lessonsLoading } = useQuery({
    queryKey: ["schools", "content-lessons", schoolId, "subject", subject?.name],
    queryFn: () => listContentLessons(schoolId!, subject!.name),
    enabled: !!schoolId && !!subject,
  });

  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SchoolContentLesson | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const refreshLessons = () => queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons", schoolId] });
  const refreshSubject = async () => {
    await queryClient.invalidateQueries({ queryKey: ["schools", "subject", schoolId, subjectId] });
    await queryClient.invalidateQueries({ queryKey: ["schools", "subjects", schoolId] });
  };
  const fail = (err: any) => toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });

  async function handleCreate() {
    if (!newTitle.trim() || !schoolId || !subject) return;
    setSaving(true);
    try {
      await createContentLesson(schoolId, { subject: subject.name, title: newTitle.trim() });
      await refreshLessons();
      await refreshSubject();
      setNewTitle("");
      setShowForm(false);
      toast({ title: t.contentSaved });
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(l: SchoolContentLesson) {
    if (!editTitle.trim() || !schoolId) return;
    try {
      await updateContentLesson(schoolId, l.id, { title: editTitle.trim() });
      await refreshLessons();
      setEditingId(null);
      toast({ title: t.contentSaved });
    } catch (err) {
      fail(err);
    }
  }

  async function handleDelete() {
    if (!schoolId || !deleteTarget) return;
    try {
      await deleteContentLesson(schoolId, deleteTarget.id);
      await refreshLessons();
      await refreshSubject();
      setDeleteTarget(null);
      toast({ title: t.contentSaved });
    } catch (err) {
      fail(err);
      setDeleteTarget(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!schoolId || !subject || !lessons) return;
    const ids = lessons.map((l) => l.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    // نمایشِ فوری (optimistic) — ترتیبِ جدید را بلافاصله در کش بگذار، بعد سرور را هم‌گام کن.
    const key = ["schools", "content-lessons", schoolId, "subject", subject.name];
    const prev = queryClient.getQueryData<SchoolContentLesson[]>(key);
    queryClient.setQueryData<SchoolContentLesson[]>(key, ids.map((id) => lessons.find((l) => l.id === id)!));
    try {
      await reorderContentLessons(schoolId, subject.name, ids);
      await refreshLessons();
    } catch (err) {
      queryClient.setQueryData(key, prev);
      fail(err);
    }
  }

  async function saveSettings(types: SchoolContentType[] | null) {
    if (!schoolId || !subject || !types) return;
    setSettingsSaving(true);
    try {
      await updateSchoolSubject(schoolId, subject.id, { enabledTypes: types });
      await refreshSubject();
      await refreshLessons();
      setSettingsOpen(false);
      toast({ title: t.contentSaved });
    } catch (err) {
      fail(err);
    } finally {
      setSettingsSaving(false);
    }
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <ContentBreadcrumb items={[{ label: t.navLessons, href: hubHref }, { label: t.subjectNotFound }]} />
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">{t.subjectNotFound}</div>
      </div>
    );
  }

  const { Icon, color } = subjectStyle(subject);
  const canManage = !!subject?.canManage;

  return (
    <div className="flex flex-col gap-5">
      <Link href={hubHref}>
        <Button variant="ghost" className="min-h-11 w-fit px-2" data-testid="button-back">
          <ArrowRight className="me-1 size-4" /> {t.backToSubjects}
        </Button>
      </Link>
      <ContentBreadcrumb items={[{ label: t.navLessons, href: hubHref }, { label: subject?.name ?? "…" }]} />

      {subjectLoading || !subject ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : (
        <div className="relative overflow-hidden rounded-xl border p-4">
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${color.glow} to-transparent`} />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`flex size-14 items-center justify-center rounded-2xl ${color.chip}`}>
                <Icon className="size-7" />
              </span>
              <div>
                <h1 className="text-2xl font-bold" dir="auto">{subject.name}</h1>
                <p className="text-sm text-muted-foreground">{t.subjectLessonCount.replace("{n}", subject.lessonCount.toLocaleString("fa-IR"))}</p>
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" onClick={() => setSettingsOpen(true)} data-testid="button-subject-settings">
                  <Settings2 className="me-1 size-4" /> {t.typesSettingsButton}
                </Button>
                <Button className="min-h-11" onClick={() => setShowForm((s) => !s)} data-testid="button-new-lesson">
                  <Plus className="me-1 size-4" /> {t.addLessonButton}
                </Button>
              </div>
            )}
          </div>
          {isStudent && subject.progress.total > 0 && (
            <div className="relative mt-4 max-w-sm">
              <MasteryBar mastered={subject.progress.mastered} total={subject.progress.total} barClass={color.bar} label={t.masteryLabel} />
            </div>
          )}
        </div>
      )}

      {canManage && showForm && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-sm font-medium">{t.lessonTitleField}</label>
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t.lessonTitlePlaceholder} dir="auto" autoFocus onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
          </div>
          <Button className="min-h-11" disabled={saving || !newTitle.trim()} onClick={handleCreate}>
            {saving && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.saveButton}
          </Button>
        </Card>
      )}

      {lessonsLoading || subjectLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : !lessons || lessons.length === 0 ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          {t.lessonsEmpty}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((l, i) => {
            const visibleTypes = CONTENT_TYPE_ORDER.filter((tp) => l.typeCounts[tp] !== undefined && ((l.typeCounts[tp] ?? 0) > 0 || (canManage && l.effectiveEnabledTypes.includes(tp))));
            return (
              <Card key={l.id} className={`overflow-hidden transition ${color.hoverBorder}`} data-testid={`card-lesson-${l.id}`}>
                {editingId === l.id ? (
                  <div className="flex flex-col gap-2 p-4 sm:flex-row">
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} dir="auto" autoFocus onKeyDown={(e) => e.key === "Enter" && handleRename(l)} />
                    <div className="flex gap-2">
                      <Button className="min-h-10" onClick={() => handleRename(l)}>{t.saveButton}</Button>
                      <Button className="min-h-10" variant="outline" onClick={() => setEditingId(null)}>{t.cancel}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-stretch">
                    <Link href={`/schools/content/lesson/${l.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-4">
                      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold tabular-nums ${color.chip}`}>
                        {(i + 1).toLocaleString("fa-IR")}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <p className="truncate text-base font-semibold" dir="auto">{l.title}</p>
                        {visibleTypes.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {visibleTypes.map((tp) => {
                              const off = !l.effectiveEnabledTypes.includes(tp);
                              return (
                                <Badge key={tp} variant="secondary" className={`gap-1 text-[11px] ${off ? "opacity-50" : ""}`}>
                                  {t[TYPE_LABEL_KEY[tp]]} {(l.typeCounts[tp] ?? 0).toLocaleString("fa-IR")}
                                  {off && <span className="text-[10px]">· {t.typeDisabledBadge}</span>}
                                </Badge>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t.lessonNoContentYet}</p>
                        )}
                        {isStudent && l.progress.total > 0 && (
                          <MasteryBar mastered={l.progress.mastered} total={l.progress.total} barClass={color.bar} label={t.masteryLabel} />
                        )}
                      </div>
                    </Link>
                    {canManage && (
                      <div className="flex shrink-0 flex-col justify-center gap-0.5 border-s p-1">
                        <div className="flex">
                          <Button size="icon" variant="ghost" aria-label={t.lessonMoveUp} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label={t.lessonMoveDown} disabled={i === lessons.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                        </div>
                        <div className="flex">
                          <Button size="icon" variant="ghost" aria-label={t.editLessonButton} onClick={() => { setEditingId(l.id); setEditTitle(l.title); }}><Pencil className="size-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label={t.deleteLessonButton} className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(l)}><Trash2 className="size-4" /></Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {subject && (
        <ContentTypesDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          mode="subject"
          title={t.typesSettingsSubjectTitle.replace("{name}", subject.name)}
          current={subject.enabledTypes}
          saving={settingsSaving}
          onSave={saveSettings}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.lessonDeleteConfirmTitle.replace("{name}", deleteTarget?.title ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{t.lessonDeleteConfirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              {t.deleteLessonButton}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
