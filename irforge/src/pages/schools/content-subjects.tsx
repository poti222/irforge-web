import { useState } from "react";
import { useActiveSchoolId } from "@/hooks/use-viewed-school";
import { Link, Redirect } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FolderOpen, GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  createSchoolSubject,
  deleteSchoolSubject,
  getSchoolMe,
  listSchoolContent,
  listSchoolSubjects,
  updateSchoolSubject,
  type SchoolSubjectInfo,
} from "@/lib/schools-api";
import { subjectStyle } from "@/lib/schools-subject-style";
import { MasteryBar } from "@/components/schools/ContentBreadcrumb";
import { SubjectFormDialog } from "@/components/schools/SubjectFormDialog";

/**
 * pages/schools/content-subjects.tsx — سطحِ اولِ «درس‌ها»: شبکه‌یِ موضوعاتِ
 * مدرسه (ادبیات، ریاضی، ...). جایگزینِ پنج آیتمِ جدایِ سایدبار (لغت‌نامه/
 * اشعار/فرمول‌ها/جزوه‌ها/کتاب‌ها). مدیر می‌تواند موضوعِ تازه بسازد، نامش را
 * عوض کند یا حذفش کند؛ معلم/دانش‌آموز فقط می‌بینند و وارد می‌شوند.
 *
 * حذف دو مرحله‌ای است: اول بدونِ force؛ اگر موضوع محتوا/تخصیص دارد، سرور ۴۰۹ با
 * شمارش‌ها می‌دهد و فقط با تأییدِ صریحِ دوم (با همان شمارش‌ها) force می‌شود.
 */
/** `/schools/content` — دانش‌آموز به خانه‌اش (که خودِ فهرستِ موضوعات است) هدایت می‌شود (replace: دکمه‌یِ برگشتِ مرورگر حلقه نمی‌سازد). */
export default function SchoolContentSubjects() {
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  if (me?.role === "student") return <Redirect to="/schools/student" replace />;
  return <SubjectsHub />;
}

/** فهرستِ موضوعاتِ مدرسه؛ `embedded` یعنی داخلِ صفحه‌یِ خانه‌یِ دانش‌آموز (عنوان کوچک‌تر). */
export function SubjectsHub({ embedded = false }: { embedded?: boolean }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePrivatePageTitle(embedded ? t.studentHomeTitle : t.navLessons);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useActiveSchoolId(me);
  const isAdmin = me?.role === "admin";

  const { data: subjects, isLoading, isError, refetch } = useQuery({
    queryKey: ["schools", "subjects", schoolId],
    queryFn: () => listSchoolSubjects(schoolId!),
    enabled: !!schoolId,
  });

  // محتوایِ قدیمیِ «بدونِ درس» ناپدید نمی‌شود: اگر وجود دارد، یک کارتِ جدا نشانش می‌دهیم.
  const { data: ungrouped } = useQuery({
    queryKey: ["schools", "content", "lesson-none", schoolId],
    queryFn: () => listSchoolContent(undefined, schoolId, undefined, "none"),
    enabled: !!schoolId,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolSubjectInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SchoolSubjectInfo | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{ lessons: number; items: number; assignments: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["schools", "subjects", schoolId] });

  async function handleSubmit(v: { name: string; icon: string; color: string; classIds: string[] | null }) {
    if (!schoolId) return;
    setSaving(true);
    try {
      if (editing) await updateSchoolSubject(schoolId, editing.id, v);
      else await createSchoolSubject(schoolId, v);
      await refresh();
      // نامِ موضوع در درس‌ها/تخصیص‌ها هم دنبال می‌شود — کش‌هایِ وابسته را هم تازه کن.
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons"] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "teacher-subjects"] });
      setFormOpen(false);
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: t.contentSaveError,
        description: err?.status === 409 ? (err?.data?.existing?.name ? t.subjectDuplicateNameNamed.replace("{name}", err.data.existing.name) : t.subjectDuplicateName) : err?.data?.error,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(force: boolean) {
    if (!schoolId || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSchoolSubject(schoolId, deleteTarget.id, force);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons"] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "teacher-subjects"] });
      setDeleteTarget(null);
      setDeleteCounts(null);
      toast({ title: t.subjectDeleted });
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.counts) {
        setDeleteCounts(err.data.counts);
      } else {
        toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          {embedded ? (
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <GraduationCap className="size-5 text-primary" /> {t.navLessons}
            </h2>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <GraduationCap className="size-6 text-primary" /> {t.navLessons}
            </h1>
          )}
          <p className="text-sm text-muted-foreground">{t.subjectsHubDescription}</p>
        </div>
        {isAdmin && (
          <Button size="lg" className="min-h-11" onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="button-new-subject">
            <Plus className="me-1 size-4" /> {t.subjectNewButton}
          </Button>
        )}
      </div>

      {isLoading || !schoolId ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        // یک ۵۰۰ نباید شبیهِ «هیچ درسی نیست» نمایش داده شود — همان چیزی که باگِ «درسی که ساختم دیده نمی‌شود» را پنهان می‌کرد.
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/40 text-sm text-destructive" role="alert" data-testid="subjects-load-error">
          {t.subjectsLoadError}
          <Button size="sm" variant="outline" onClick={() => void refetch()}>{t.subjectsRetry}</Button>
        </div>
      ) : !subjects || subjects.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
          {t.subjectsEmpty}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => {
            const { Icon, color } = subjectStyle(s);
            const isStudent = me?.role === "student";
            return (
              <Card key={s.id} className={`group relative overflow-hidden transition ${color.hoverBorder}`} data-testid={`card-subject-${s.id}`}>
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${color.glow} to-transparent`} />
                <Link href={`/schools/content/subject/${s.id}`} className="relative flex flex-col gap-4 p-4">
                  <div className="flex items-center gap-3">
                    <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${color.chip}`}>
                      <Icon className="size-6" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold" dir="auto">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.subjectLessonCount.replace("{n}", s.lessonCount.toLocaleString("fa-IR"))}
                        {s.classIds && s.classIds.length > 0 ? ` · ${t.subjectClassesBadge.replace("{n}", s.classIds.length.toLocaleString("fa-IR"))}` : ""}
                      </p>
                    </div>
                  </div>
                  {isStudent && s.progress.total > 0 && (
                    <MasteryBar mastered={s.progress.mastered} total={s.progress.total} barClass={color.bar} label={t.masteryLabel} />
                  )}
                </Link>
                {isAdmin && (
                  <div className="relative flex gap-2 border-t px-3 py-2">
                    <Button size="sm" variant="ghost" className="min-h-9" onClick={() => { setEditing(s); setFormOpen(true); }}>
                      <Pencil className="me-1 size-3.5" /> {t.subjectRenameButton}
                    </Button>
                    <Button size="sm" variant="ghost" className="min-h-9 text-destructive hover:bg-destructive/10" onClick={() => { setDeleteTarget(s); setDeleteCounts(null); }}>
                      <Trash2 className="me-1 size-3.5" /> {t.subjectDeleteButton}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}

          {ungrouped && ungrouped.length > 0 && (
            <Link href="/schools/content/lesson/none">
              <Card className="flex h-full min-h-36 cursor-pointer flex-col justify-center gap-2 border-dashed p-4 transition hover:border-primary/50">
                <div className="flex items-center gap-3">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <FolderOpen className="size-6" />
                  </span>
                  <div>
                    <p className="text-lg font-bold">{t.noLessonGroupLabel}</p>
                    <p className="text-xs text-muted-foreground">{t.noLessonGroupHint} ({ungrouped.length.toLocaleString("fa-IR")})</p>
                  </div>
                </div>
              </Card>
            </Link>
          )}
        </div>
      )}

      <SubjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing ? { name: editing.name, icon: editing.icon, color: editing.color, classIds: editing.classIds ?? null } : null}
        schoolId={schoolId}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteCounts(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.subjectDeleteConfirmTitle.replace("{name}", deleteTarget?.name ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCounts
                ? t.subjectDeleteForceBody
                    .replace("{lessons}", String(deleteCounts.lessons))
                    .replace("{items}", String(deleteCounts.items))
                    .replace("{assignments}", String(deleteCounts.assignments))
                : t.subjectDeleteConfirmBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void handleDelete(!!deleteCounts); }}
            >
              {deleteCounts ? t.subjectDeleteForceButton : t.subjectDeleteButton}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
