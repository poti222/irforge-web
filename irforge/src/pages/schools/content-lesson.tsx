import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, TriangleAlert, ArrowRight, CheckCircle2, GraduationCap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  bulkCreateSchoolContentItems,
  createSchoolContentItem,
  getContentLesson,
  getSchoolMe,
  listSchoolContent,
  listTeacherSubjects,
  SCHOOL_CONTENT_TYPES,
  SCHOOL_SUBJECTS,
  type SchoolContentItem,
  type SchoolContentType,
} from "@/lib/schools-api";
import { parseBulkDictionaryText, type ParsedBulkDictionaryLine } from "@/lib/schools-bulk-dictionary";
import { chunkIntoSections, CONTENT_SECTION_SIZE } from "@/lib/schools-content-sections";

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
 *
 * ── افزودنِ دسته‌ای (bulk) ─────────────────────────────────────────────
 * طبقِ گزارشِ مستقیمِ کاربر، فقط برایِ type="dictionary" (هر خط = یک واژه +
 * معنی؛ جداکننده‌هایِ مجاز و heuristicِ تشخیص در lib/schools-bulk-dictionary.ts).
 * برایِ note/poem عمداً اضافه نشد: body آن‌ها متنِ آزاد/چندخطی است (یک شعر
 * خودش چند سطر دارد)، پس «هر خط = یک آیتم» برایِ آن‌ها بی‌معنی/مخرب می‌شود؛
 * فقط لغت‌نامه واقعاً با این فرمتِ خطی جفت می‌شود.
 *
 * ── چگالیِ نمایش: جدول برایِ لغت‌نامه، کارت برایِ بقیه ────────────────────
 * یک لغت‌نامه با افزودنِ دسته‌ای به‌راحتی ده‌ها ردیف می‌شود؛ گریدِ کارتِ قدیمی
 * (هرکدام با عنوان/بَج/پیش‌نمایشِ بدنه) برایِ ۳۰+ واژه‌یِ کوتاه فضایِ زیادی
 * هدر می‌دهد و اسکرولِ طولانی می‌سازد. برایِ type="dictionary" یک جدولِ
 * دوستونه (واژه | معنی) جایگزینِ گرید شده — برایِ شعر/جزوه/کتاب/فرمول که
 * بدنه‌شان طولانی/قالب‌داراست، همان گریدِ کارتِ قبلی مانده (جدول آن‌ها را
 * یا می‌برد یا بی‌فایده می‌کند).
 *
 * ── «بخش»هایِ ۲۰تایی (قاعده‌ی خودِ dars) ───────────────────────────────
 * اگر تعدادِ آیتم‌هایِ یک typeِ معین (دقیقاً دیکشنری/شعر، طبقِ گزارشِ کاربر)
 * از ۲۰ بیشتر شود، به بخش‌هایِ تب‌دار تقسیم می‌شوند (lib/schools-content-sections.ts)
 * — دانش‌آموز هیچ‌وقت با یک لیستِ یک‌تکه‌ی بزرگ روبه‌رو نمی‌شود. این فقط رویِ
 * *نمایش* است (مدیریتِ معلم/افزودن همچنان رویِ کلِ درس عمل می‌کند)، و هر
 * بخش یک دکمه‌ی «حالتِ مطالعه» دارد که به فلش‌کارتِ همان ۲۰تا می‌رود
 * (pages/schools/content-study.tsx).
 */
export default function SchoolContentLesson() {
  const { type, lessonId } = useParams<{ type: SchoolContentType; lessonId: string }>();
  const isGrouped = lessonId !== "none";
  const [, navigate] = useLocation();
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

  const currentType = isGrouped ? itemType : type;
  // افزودنِ دسته‌ای فقط برایِ لغت‌نامه (ببینید توضیحِ بالایِ فایل) — و فقط
  // داخلِ یک درسِ واقعی معنا دارد (بدونِ‌درس، همان فرمِ تکیِ قدیمی کافی‌ست).
  const bulkEligible = isGrouped && currentType === "dictionary";
  const [addMode, setAddMode] = useState<"single" | "bulk">("single");
  useEffect(() => {
    if (!bulkEligible && addMode === "bulk") setAddMode("single");
  }, [bulkEligible, addMode]);

  const [bulkText, setBulkText] = useState("");
  const [bulkParsed, setBulkParsed] = useState<ParsedBulkDictionaryLine[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  // پیش‌نمایشِ دیبانس‌شده — همان چیزی که کاربر صریحاً خواسته: «قبل از ثبت
  // دقیقاً ببینه چی ساخته می‌شه تا اگه لازم شد متنِ خام رو اصلاح کنه».
  useEffect(() => {
    const handle = setTimeout(() => setBulkParsed(parseBulkDictionaryText(bulkText)), 250);
    return () => clearTimeout(handle);
  }, [bulkText]);
  const bulkValidEntries = useMemo(
    () => bulkParsed.filter((l) => l.ok).map((l) => ({ title: l.word as string, body: l.meaning as string })),
    [bulkParsed],
  );

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

  async function handleBulkCreate() {
    if (bulkValidEntries.length === 0 || !schoolId) return;
    setBulkSaving(true);
    try {
      const created = await bulkCreateSchoolContentItems(schoolId, {
        lessonId,
        type: "dictionary",
        entries: bulkValidEntries,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-by-lesson", schoolId, type, lessonId] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content"] });
      setBulkText("");
      setBulkParsed([]);
      setAddMode("single");
      setShowForm(false);
      toast({ title: t.bulkAddedCount.replace("{count}", String(created.length)) });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    } finally {
      setBulkSaving(false);
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

      {canWrite && showForm && canWriteHere && bulkEligible && (
        <Tabs value={addMode} onValueChange={(v) => setAddMode(v as "single" | "bulk")} className="w-fit">
          <TabsList>
            <TabsTrigger value="single">{t.addModeSingleTab}</TabsTrigger>
            <TabsTrigger value="bulk">{t.addModeBulkTab}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {canWrite && showForm && canWriteHere && addMode === "single" && (
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

      {canWrite && showForm && canWriteHere && bulkEligible && addMode === "bulk" && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.bulkTextareaLabel}</Label>
              <p className="text-xs text-muted-foreground">{t.bulkTextareaHint}</p>
              <Textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                dir="auto"
                placeholder={t.bulkTextareaPlaceholder}
                className="font-mono"
              />
            </div>

            {bulkParsed.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>{t.bulkPreviewTitle}</Label>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">{t.bulkPreviewLineCol}</TableHead>
                        <TableHead>{t.bulkPreviewWordCol}</TableHead>
                        <TableHead>{t.bulkPreviewMeaningCol}</TableHead>
                        <TableHead className="w-10">{t.bulkPreviewStatusCol}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bulkParsed.map((line) => (
                        <TableRow key={line.lineNumber} className={!line.ok ? "bg-destructive/5" : undefined}>
                          <TableCell className="text-xs text-muted-foreground">{line.lineNumber}</TableCell>
                          {line.ok ? (
                            <>
                              <TableCell dir="auto">{line.word}</TableCell>
                              <TableCell dir="auto">{line.meaning}</TableCell>
                            </>
                          ) : (
                            <TableCell colSpan={2} className="text-xs text-destructive" dir="auto">
                              {t.bulkPreviewUnparsed}: «{line.raw}»
                            </TableCell>
                          )}
                          <TableCell>
                            {line.ok ? (
                              <CheckCircle2 className="size-4 text-green-600" />
                            ) : (
                              <TriangleAlert className="size-4 text-destructive" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.bulkPreviewSummary
                    .replace("{ok}", String(bulkValidEntries.length))
                    .replace("{total}", String(bulkParsed.length))}
                </p>
              </div>
            )}

            <Button onClick={handleBulkCreate} disabled={bulkSaving || bulkValidEntries.length === 0} className="w-fit">
              {bulkSaving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.bulkSubmitButton}
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
        <div className="flex flex-col gap-6">
          {(isGrouped ? SCHOOL_CONTENT_TYPES : [type]).map((groupType) => {
            const groupItems = items.filter((i) => i.type === groupType);
            if (groupItems.length === 0) return null;
            // «بخش»هایِ ۲۰تایی فقط برایِ لغت‌نامه/شعر (ببینید توضیحِ بالایِ فایل) — جزوه/کتاب/فرمول عادتاً به این حجم نمی‌رسند.
            const chunkable = groupType === "dictionary" || groupType === "poem";
            const sections = chunkable ? chunkIntoSections(groupItems) : [groupItems];
            return (
              <div key={groupType} className="flex flex-col gap-2">
                {isGrouped && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{t[TYPE_LABEL_KEY[groupType]]}</Badge>
                    <span className="text-xs text-muted-foreground">({groupItems.length})</span>
                  </div>
                )}
                {sections.length <= 1 ? (
                  <ContentItemsBlock
                    items={groupItems}
                    type={groupType}
                    t={t}
                    navigate={navigate}
                    studyHref={isGrouped && chunkable ? `/schools/content/study/${groupType}/${lessonId}/0` : undefined}
                  />
                ) : (
                  <Tabs defaultValue="0" className="w-full">
                    <TabsList className="h-auto flex-wrap">
                      {sections.map((_, idx) => (
                        <TabsTrigger key={idx} value={String(idx)}>
                          {t.sectionLabel.replace("{n}", String(idx + 1))}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {sections.map((sectionItems, idx) => (
                      <TabsContent key={idx} value={String(idx)} className="mt-2">
                        <ContentItemsBlock
                          items={sectionItems}
                          type={groupType}
                          t={t}
                          navigate={navigate}
                          studyHref={`/schools/content/study/${groupType}/${lessonId}/${idx}`}
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * ContentItemsBlock — چگالیِ نمایشِ آیتم‌هایِ یک بخش/گروه: جدولِ دوستونه برایِ
 * لغت‌نامه (ببینید توضیحِ طراحی در بالایِ فایل)، گریدِ کارتِ قبلی برایِ بقیه.
 */
function ContentItemsBlock({
  items,
  type,
  t,
  navigate,
  studyHref,
}: {
  items: SchoolContentItem[];
  type: SchoolContentType;
  t: any;
  navigate: (href: string) => void;
  studyHref?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {studyHref && (
        <Link href={studyHref}>
          <Button size="sm" variant="outline" className="w-fit">
            <GraduationCap className="me-1 size-4" /> {t.studyModeButton}
          </Button>
        </Link>
      )}
      {type === "dictionary" ? (
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.dictionaryWordCol}</TableHead>
                <TableHead>{t.dictionaryMeaningCol}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/schools/content/${item.type}/${item.id}`)}
                >
                  <TableCell dir="auto" className="font-medium">
                    <div className="flex items-center gap-1.5">
                      {item.title}
                      {item.language && (
                        <Badge variant="outline" className="text-[10px] uppercase">{item.language}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell dir="auto" className="text-muted-foreground">{item.body || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
                      {item.subject && (
                        <Badge variant="secondary" className="text-[10px]">{item.subject}</Badge>
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
