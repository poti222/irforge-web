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
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  createSchoolContentItem,
  getSchoolMe,
  listSchoolContent,
  listTeacherSubjects,
  SCHOOL_SUBJECTS,
  type SchoolContentType,
} from "@/lib/schools-api";

const TYPE_LABEL_KEY: Record<SchoolContentType, string> = {
  dictionary: "navDictionary",
  note: "navNotes",
  book: "navBooks",
  formula: "navFormulas",
};

/**
 * pages/schools/content-list.tsx — لیستِ لغت‌نامه/جزوه/کتاب/فرمول برای یک
 * `type`. ساخت/ویرایش فقط برای مدیر/معلم (بک‌اند هم همین را اجرا می‌کند —
 * این فقط UI را برای همان‌ها نشان می‌دهد). فاز ۳: آپلودِ واقعیِ فایل هنوز
 * خارج از محدوده است (این ریپو زیرساختِ آپلود ندارد)، ولی به‌جایِ استابِ
 * غیرفعال یک فیلدِ URLِ عکس با پیش‌نمایش اضافه شد.
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
  const { data: items, isLoading } = useQuery({
    queryKey: ["schools", "content", type, schoolId, subjectFilter],
    queryFn: () => listSchoolContent(type, schoolId, subjectFilter === "all" ? undefined : subjectFilter),
  });

  const [showForm, setShowForm] = useState(false);
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
        type, title: title.trim(), body, language: language.trim() || null,
        subject: subject || null,
        schoolId: schoolId ?? null, imageUrl: imageUrl.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content", type] });
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
            // طبقِ گزارشِ کاربر («پیدا کردنِ دکمه‌ی افزودن/ویرایش برایِ معلم سخت
            // بود»): برچسبِ مشخص («افزودنِ + نام‌ِ نوع») به‌جایِ یک «افزودن»ِ
            // مبهم، و اندازه‌ی معمولی (نه sm) تا واقعاً دیده شود.
            <Button variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
              <Plus className="me-1 size-4" /> {t.addContentButton} {label}
            </Button>
          )}
        </div>
      </div>

      {canWrite && showForm && !isAdmin && assignableSubjects.length === 0 && (
        // گزارشِ کاربر («هنوز نمی‌توانم بخشِ افزودنِ لغت‌نامه را پیدا کنم»): یک
        // معلمِ بدونِ هیچ تخصیصِ درسی (مثلاً هویتِ آزمایشیِ تازه‌ساخته‌شده، قبل
        // از اصلاحِ فرمِ ساختِ آن در /super) فرمِ معمولی را می‌دید — پیکرِ درس
        // خالی، دکمه‌ی ذخیره غیرفعال، فقط یک متنِ کوچکِ قرمز کنارِ پیکر که
        // به‌راحتی از قلم می‌افتد. حالا به‌جایِ آن فرمِ نیمه‌غیرفعال، یک اعلانِ
        // تمام‌عرض و غیرقابل‌نادیده‌گرفتن نشان داده می‌شود؛ خودِ دکمه‌ی «افزودن»
        // دست‌نخورده می‌ماند تا معلم بداند نوشتن برایِ نقشش اصولاً ممکن است.
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t.contentNoSubjectAssignedTitle}</AlertTitle>
          <AlertDescription>{t.contentNoSubjectAssigned}</AlertDescription>
        </Alert>
      )}

      {canWrite && showForm && (isAdmin || assignableSubjects.length > 0) && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.contentTitleField}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
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
            {type === "dictionary" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t.contentLanguageField}</Label>
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="fa / en" dir="ltr" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>
                {t.contentBodyField}
                {type === "formula" && <span className="ms-1 text-xs text-muted-foreground">({t.formulaKatexHint})</span>}
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
            <Button onClick={handleCreate} disabled={saving || !title.trim() || (!isAdmin && !subject)} className="w-fit">
              {saving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.saveButton}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : !items || items.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          {t.contentEmpty}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <Link key={item.id} href={`/schools/content/${type}/${item.id}`}>
              <Card className="cursor-pointer transition hover:border-primary/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{item.title}</span>
                    <div className="flex items-center gap-1">
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
