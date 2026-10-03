import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Plus, TriangleAlert, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  createContentLesson,
  deleteContentLesson,
  getSchoolMe,
  listContentLessons,
  listSchoolContent,
  listTeacherSubjects,
  updateContentLesson,
  SCHOOL_SUBJECTS,
  type SchoolContentLesson,
  type SchoolContentType,
} from "@/lib/schools-api";

const TYPE_LABEL_KEY: Record<SchoolContentType, string> = {
  dictionary: "navDictionary",
  note: "navNotes",
  book: "navBooks",
  formula: "navFormulas",
  poem: "navPoems",
};

/**
 * pages/schools/content-list.tsx — فهرستِ «درس»های یک type+درس (لیستِ
 * لغت‌نامه/جزوه/کتاب/فرمول/شعر دیگر یک گریدِ فلَتِ تمامِ آیتم‌ها نیست؛ این
 * صفحه فقط «درس»ها را نشان می‌دهد، آیتم‌های واقعی داخلِ هر درس‌اند — ببینید
 * pages/schools/content-lesson.tsx).
 *
 * طبقِ گزارشِ مستقیمِ کاربر («باید بشه یه درس بسازی و توش شعر یا لغت اضافه
 * کنی»). «درس» (school_content_lessons) عمداً مستقلِ از typeِ آیتم‌هاست —
 * توضیحِ کاملِ این تصمیم در schema/schoolContentLessons.ts است؛ یعنی از هر
 * کدام از صفحاتِ نوعی (لغت‌نامه/شعر/...) وارد شوید، همان لیستِ درس‌هایِ آن
 * مدرسه را می‌بینید (چون یک درس می‌تواند هم لغت هم شعر داشته باشد).
 *
 * «بدون درس» یک پسودوگروهِ همیشه‌حاضر در همین لیست است (نه بخشِ جداگانه)،
 * طبقِ اسپک: آیتم‌هایِ قدیمی/عمداً بدونِ‌درس نباید با این تغییر ناپدید شوند.
 */
export default function SchoolContentList() {
  const { type } = useParams<{ type: SchoolContentType }>();
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const label = t[TYPE_LABEL_KEY[type] ?? "navDictionary"];
  usePrivatePageTitle(label);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const canWrite = me?.role === "admin" || me?.role === "teacher";
  const isAdmin = me?.role === "admin";
  const schoolId = me?.schoolId ?? undefined;

  // گیتِ موضوعی: معلم فقط باید درس‌هایِ تخصیص‌داده‌شده‌ی خودش را در پیکر
  // ببیند (نه کلِ SCHOOL_SUBJECTS و امیدِ به رد شدن از سمتِ سرور)؛ admin
  // همه‌ی فهرستِ ثابت را می‌بیند چون سرور برایِ او گیتِ موضوعی ندارد.
  const { data: myAssignments } = useQuery({
    queryKey: ["schools", "teacher-subjects", schoolId, me?.userId],
    queryFn: () => listTeacherSubjects(schoolId!, me!.userId),
    enabled: !!schoolId && me?.role === "teacher",
  });
  const assignableSubjects = isAdmin
    ? SCHOOL_SUBJECTS
    : Array.from(new Set((myAssignments ?? []).map((a) => a.subject)));

  const [subjectFilter, setSubjectFilter] = useState<string>("all");

  const { data: lessons, isLoading: lessonsLoading } = useQuery({
    queryKey: ["schools", "content-lessons", schoolId, subjectFilter],
    queryFn: () => listContentLessons(schoolId!, subjectFilter === "all" ? undefined : subjectFilter),
    enabled: !!schoolId,
  });

  // تعدادِ آیتم‌هایِ «بدون درس» (همینِ type) — فقط برایِ تصمیمِ نمایش/عدمِ
  // نمایشِ کارتِ پسودوگروه لازم نیست، همیشه نشانش می‌دهیم؛ این صرفاً برایِ
  // یک شمارشگرِ کوچکِ روی کارت است، نه شرطِ نمایش.
  const { data: ungroupedItems } = useQuery({
    queryKey: ["schools", "content", type, schoolId, "lesson-none-count"],
    queryFn: () => listSchoolContent(type, schoolId, undefined, "none"),
    enabled: !!type,
  });

  const [showLessonForm, setShowLessonForm] = useState(false);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonSubject, setLessonSubject] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  async function handleCreateLesson() {
    if (!lessonTitle.trim() || !schoolId) return;
    setSaving(true);
    try {
      await createContentLesson(schoolId, { title: lessonTitle.trim(), subject: lessonSubject });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons", schoolId] });
      setLessonTitle("");
      setLessonSubject("");
      setShowLessonForm(false);
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleRenameLesson(lesson: SchoolContentLesson) {
    if (!editTitle.trim() || !schoolId) return;
    try {
      await updateContentLesson(schoolId, lesson.id, { title: editTitle.trim() });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons", schoolId] });
      setEditingLessonId(null);
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    }
  }

  async function handleDeleteLesson(lesson: SchoolContentLesson) {
    if (!schoolId) return;
    try {
      await deleteContentLesson(schoolId, lesson.id);
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-lessons", schoolId] });
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    }
  }

  function canWriteLesson(lesson: SchoolContentLesson) {
    return isAdmin || (assignableSubjects as readonly string[]).includes(lesson.subject);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{label}</h1>
        <div className="flex items-center gap-2">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder={t.contentSubjectFilterLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.contentSubjectFilterAll}</SelectItem>
              {SCHOOL_SUBJECTS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canWrite && (
            <Button variant={showLessonForm ? "secondary" : "default"} onClick={() => setShowLessonForm((s) => !s)}>
              <Plus className="me-1 size-4" /> {t.addLessonButton}
            </Button>
          )}
        </div>
      </div>

      {canWrite && showLessonForm && !isAdmin && assignableSubjects.length === 0 && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t.contentNoSubjectAssignedTitle}</AlertTitle>
          <AlertDescription>{t.contentNoSubjectAssigned}</AlertDescription>
        </Alert>
      )}

      {canWrite && showLessonForm && (isAdmin || assignableSubjects.length > 0) && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.lessonTitleField}</Label>
              <Input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} placeholder={t.lessonTitlePlaceholder} dir="auto" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.contentSubjectField}</Label>
              <Select value={lessonSubject} onValueChange={setLessonSubject}>
                <SelectTrigger>
                  <SelectValue placeholder={t.contentSubjectPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {assignableSubjects.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreateLesson} disabled={saving || !lessonTitle.trim() || !lessonSubject} className="w-fit">
              {saving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.saveButton}
            </Button>
          </CardContent>
        </Card>
      )}

      {lessonsLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* پسودوگروهِ «بدون درس» — همیشه حاضر، حتی اگر خالی باشد، تا
              آیتم‌هایِ قدیمی/عمداً بدونِ‌درس هرگز از دسترس خارج نشوند. */}
          <Link href={`/schools/content/${type}/lesson/none`}>
            <Card className="cursor-pointer border-dashed transition hover:border-primary/50">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <FolderOpen className="size-5 text-muted-foreground" />
                <CardTitle className="text-base">{t.noLessonGroupLabel}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t.noLessonGroupHint} ({ungroupedItems?.length ?? 0})
                </p>
              </CardContent>
            </Card>
          </Link>

          {lessons?.map((lesson) => (
            <Card key={lesson.id} className="transition hover:border-primary/50">
              {editingLessonId === lesson.id ? (
                <CardContent className="flex flex-col gap-2 pt-4">
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} dir="auto" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleRenameLesson(lesson)}>{t.saveButton}</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingLessonId(null)}>{t.cancel}</Button>
                  </div>
                </CardContent>
              ) : (
                <>
                  <Link href={`/schools/content/${type}/lesson/${lesson.id}`}>
                    <CardHeader className="cursor-pointer pb-2">
                      <CardTitle className="flex items-center justify-between text-base">
                        <span>{lesson.title}</span>
                        <Badge variant="secondary" className="text-[10px]">{lesson.subject}</Badge>
                      </CardTitle>
                    </CardHeader>
                  </Link>
                  {canWrite && canWriteLesson(lesson) && (
                    <CardContent className="flex gap-2 pt-0">
                      <Button size="sm" variant="outline" onClick={() => { setEditingLessonId(lesson.id); setEditTitle(lesson.title); }}>
                        <Pencil className="me-1 size-3.5" /> {t.editLessonButton}
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteLesson(lesson)}>
                        <Trash2 className="me-1 size-3.5" /> {t.deleteLessonButton}
                      </Button>
                    </CardContent>
                  )}
                </>
              )}
            </Card>
          ))}

          {lessons?.length === 0 && (
            <div className="col-span-full flex h-20 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              {t.lessonsEmpty}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
