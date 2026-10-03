import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Plus, TriangleAlert, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  createSchoolContentItem,
  getContentLesson,
  getSchoolMe,
  listSchoolContent,
  listTeacherSubjects,
  SCHOOL_CONTENT_TYPES,
  SCHOOL_SUBJECTS,
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
 * pages/schools/content-lesson.tsx — داخلِ یک «درس» (یا پسودوگروهِ «بدون
 * درس»): گریدِ آیتم‌هایِ محتوایی + فرمِ افزودن. این همان تجربه‌ای است که
 * کاربر خواسته بود: «یه درس بسازی و توش شعر یا لغت اضافه کنی».
 *
 * اگر `lessonId` یک درسِ واقعی باشد، آیتم‌هایِ هر typeی (لغت‌نامه/شعر/جزوه/…)
 * می‌تواند داخلش باشد — پس لیست با *همه‌یِ* typeها خوانده می‌شود (نه فقط
 * typeِ مسیر)، و فرمِ افزودن یک پیکرِ انتخابِ نوع دارد. subject این‌جا
 * دیگر قابلِ‌انتخاب نیست: از خودِ درس می‌آید و فقط به‌صورتِ برچسب نشان
 * داده می‌شود (سرور هم هر مقداری که بفرستیم را نادیده می‌گیرد و از رویِ
 * خودِ lessonId جایگزین می‌کند — ببینید routes/schoolContent.ts).
 *
 * اگر `lessonId === "none"` باشد (پسودوگروهِ «بدون درس»)، دقیقاً رفتارِ
 * قدیمیِ این صفحه را برایِ همان یک typeِ مسیر حفظ می‌کنیم — نه چیزِ تازه‌ای،
 * فقط همان فرمِ قبلی (subject قابلِ‌انتخاب، نه از یک درس).
 */
export default function SchoolContentLesson() {
  const { type, lessonId } = useParams<{ type: SchoolContentType; lessonId: string }>();
  const isGrouped = lessonId !== "none";
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const canWrite = me?.role === "admin" || me?.role === "teacher";
  const isAdmin = me?.role === "admin";
  const schoolId = me?.schoolId ?? undefined;

  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ["schools", "content-lesson", schoolId, lessonId],
    queryFn: () => getContentLesson(schoolId!, lessonId),
    enabled: isGrouped && !!schoolId,
  });

  const { data: myAssignments } = useQuery({
    queryKey: ["schools", "teacher-subjects", schoolId, me?.userId],
    queryFn: () => listTeacherSubjects(schoolId!, me!.userId),
    enabled: !!schoolId && me?.role === "teacher",
  });
  const assignableSubjects = isAdmin
    ? SCHOOL_SUBJECTS
    : Array.from(new Set((myAssignments ?? []).map((a) => a.subject)));

  // گیتِ UI: برایِ درسِ واقعی، معلم فقط اگر subjectِ آن درس را داشته باشد.
  // برایِ «بدون درس»، همان گیتِ قدیمی (معلمِ بدونِ‌تخصیص اصلاً فرم نمی‌بیند).
  const canWriteHere = isGrouped
    ? isAdmin || (!!lesson && (assignableSubjects as readonly string[]).includes(lesson.subject))
    : isAdmin || assignableSubjects.length > 0;

  usePrivatePageTitle(isGrouped ? (lesson?.title ?? "") : t.noLessonGroupLabel);

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["schools", "content-by-lesson", schoolId, type, lessonId],
    // درسِ واقعی: هر typeی ممکن است داخلش باشد → type فیلتر نمی‌شود.
    // «بدون درس»: فقط همین typeِ مسیر (حفظِ رفتارِ قبلی).
    queryFn: () => listSchoolContent(isGrouped ? undefined : type, schoolId, undefined, lessonId),
    enabled: !isGrouped || !lessonLoading,
  });

  const [showForm, setShowForm] = useState(false);
  const [itemType, setItemType] = useState<SchoolContentType>(type);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState("");
  const [subject, setSubject] = useState<string>("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createSchoolContentItem({
        type: isGrouped ? itemType : type,
        title: title.trim(),
        body,
        language: language.trim() || null,
        subject: isGrouped ? (lesson?.subject ?? null) : (subject || null),
        schoolId: schoolId ?? null,
        imageUrl: imageUrl.trim() || null,
        lessonId: isGrouped ? lessonId : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-by-lesson", schoolId, type, lessonId] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content"] });
      setTitle("");
      setBody("");
      setLanguage("");
      setSubject("");
      setImageUrl("");
      setShowForm(false);
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isGrouped && lessonLoading) {
    return <Loader2 className="size-6 animate-spin" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/schools/content/${type}`}>
        <Button variant="ghost" size="sm" className="w-fit">
          <ArrowRight className="me-1 size-4" /> {t.backToLessons}
        </Button>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{isGrouped ? lesson?.title : t.noLessonGroupLabel}</h1>
          {isGrouped && lesson && <Badge variant="secondary" className="text-[10px]">{lesson.subject}</Badge>}
        </div>
        {canWrite && (
          <Button variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
            <Plus className="me-1 size-4" /> {isGrouped ? t.addItemToLessonButton : t.addContentButton}
          </Button>
        )}
      </div>

      {canWrite && showForm && !canWriteHere && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t.contentNoSubjectAssignedTitle}</AlertTitle>
          <AlertDescription>{t.contentNoSubjectAssigned}</AlertDescription>
        </Alert>
      )}

      {canWrite && showForm && canWriteHere && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            {isGrouped && (
              <div className="flex flex-col gap-1.5">
                <Label>{t.contentTypeField}</Label>
                <Select value={itemType} onValueChange={(v) => setItemType(v as SchoolContentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHOOL_CONTENT_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>{t[TYPE_LABEL_KEY[tp]]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>{t.contentTitleField}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {!isGrouped && (
              <div className="flex flex-col gap-1.5">
                <Label>{t.contentSubjectField}</Label>
                <Select value={subject} onValueChange={setSubject}>
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
            )}
            {(isGrouped ? itemType : type) === "dictionary" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t.contentLanguageField}</Label>
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="fa / en" dir="ltr" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>
                {t.contentBodyField}
                {(isGrouped ? itemType : type) === "formula" && <span className="ms-1 text-xs text-muted-foreground">({t.formulaKatexHint})</span>}
              </Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} dir="auto" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.contentImageUrlField}</Label>
              <div className="flex items-center gap-3">
                {imageUrl.trim() && (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    <img src={imageUrl.trim()} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  </div>
                )}
                <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={t.contentImageUrlPlaceholder} dir="ltr" />
              </div>
            </div>
            <Button onClick={handleCreate} disabled={saving || !title.trim() || (!isGrouped && !isAdmin && !subject)} className="w-fit">
              {saving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.saveButton}
            </Button>
          </CardContent>
        </Card>
      )}

      {itemsLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : !items || items.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          {t.contentEmpty}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <Link key={item.id} href={`/schools/content/${item.type}/${item.id}`}>
              <Card className="cursor-pointer transition hover:border-primary/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{item.title}</span>
                    <div className="flex items-center gap-1">
                      {isGrouped && (
                        <Badge variant="outline" className="text-[10px]">{t[TYPE_LABEL_KEY[item.type]]}</Badge>
                      )}
                      {item.subject && (
                        <Badge variant="secondary" className="text-[10px]">{item.subject}</Badge>
                      )}
                      {item.language && (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {item.language}
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-start gap-3">
                  {item.imageUrl && (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      <img src={item.imageUrl} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                    </div>
                  )}
                  <p className="line-clamp-2 text-sm text-muted-foreground">{item.body || "—"}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
