import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil, Trash2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  deleteSchoolContentItem,
  getSchoolContentItem,
  getSchoolMe,
  listTeacherSubjects,
  updateSchoolContentItem,
  SCHOOL_SUBJECTS,
  type SchoolContentType,
} from "@/lib/schools-api";
import { FormulaBody } from "@/components/schools/FormulaBody";

/**
 * pages/schools/content-detail.tsx — جزئیاتِ یک آیتمِ محتوا؛ برایِ
 * type="formula" بدنه با KaTeX رندر می‌شود (همان چیزی که ریپوی dars هم برای
 * فرمول‌ها انجام می‌داد، اینجا فقط روی داده‌ی واقعیِ دیتابیس).
 */
export default function SchoolContentDetail() {
  const { type, id } = useParams<{ type: SchoolContentType; id: string }>();
  const [, navigate] = useLocation();
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: item, isLoading } = useQuery({
    queryKey: ["schools", "content-item", id],
    queryFn: () => getSchoolContentItem(id),
  });
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const canWrite = me?.role === "admin" || me?.role === "teacher";
  const isAdmin = me?.role === "admin";
  const schoolId = item?.schoolId ?? me?.schoolId ?? undefined;

  // گیتِ موضوعی، همان منطقِ content-list.tsx: معلم فقط باید درس‌هایِ
  // تخصیص‌داده‌شده‌ی خودش را در پیکرِ ویرایش ببیند.
  const { data: myAssignments } = useQuery({
    queryKey: ["schools", "teacher-subjects", schoolId, me?.userId],
    queryFn: () => listTeacherSubjects(schoolId!, me!.userId),
    enabled: !!schoolId && me?.role === "teacher",
  });
  const assignableSubjects: string[] = isAdmin
    ? [...SCHOOL_SUBJECTS]
    : Array.from(new Set((myAssignments ?? []).map((a) => a.subject)));

  usePrivatePageTitle(item?.title ?? "");

  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState<string>("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setBody(item.body);
      setSubject(item.subject ?? "");
      setImageUrl(item.imageUrl ?? "");
    }
  }, [item?.id]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateSchoolContentItem(id, { body, subject: subject || null, imageUrl: imageUrl.trim() || null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-item", id] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content", type] });
      setEditing(false);
      toast({ title: t.contentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteSchoolContentItem(id);
      await queryClient.invalidateQueries({ queryKey: ["schools", "content", type] });
      navigate(`/schools/content/${type}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: t.contentSaveError, description: err?.data?.error });
    }
  }

  if (isLoading || !item) {
    return <Loader2 className="size-6 animate-spin" />;
  }

  // گیتِ موضوعیِ UI: معلمی که درسِ این آیتم را ندارد، اصلاً دکمه‌ی
  // ویرایش/حذف نمی‌بیند (سرور هم ۴۰۳ می‌دهد؛ این فقط UXِ بهتر است).
  const canWriteThisItem = isAdmin || (!!item.subject && assignableSubjects.includes(item.subject));

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(`/schools/content/${type}`)}>
        <ArrowRight className="me-1 size-4" /> {t.backToList}
      </Button>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>{item.title}</CardTitle>
            {item.subject && <Badge variant="secondary" className="text-[10px]">{item.subject}</Badge>}
          </div>
          {canWrite && canWriteThisItem && (
            // طبقِ گزارشِ کاربر: دکمه‌ی فقط-آیکنِ قبلی برایِ معلم به‌سختی دیده
            // می‌شد — حالا هم آیکن و هم برچسبِ متنیِ «ویرایش»/«حذف» دارد.
            <div className="flex gap-2">
              <Button variant={editing ? "secondary" : "outline"} onClick={() => setEditing((s) => !s)}>
                <Pencil className="me-1.5 size-4" /> {t.editContentButton}
              </Button>
              <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={handleDelete}>
                <Trash2 className="me-1.5 size-4" /> {t.deleteContentButton}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} dir="auto" />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-foreground">{t.contentSubjectField}</label>
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
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-foreground">{t.contentImageUrlField}</label>
                <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={t.contentImageUrlPlaceholder} dir="ltr" />
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-fit">
                {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                {t.saveButton}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {item.imageUrl && (
                <img src={item.imageUrl} alt={item.title} className="max-h-64 w-fit rounded-md border object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
              )}
              {item.type === "formula" ? (
                <FormulaBody text={item.body} />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-7" dir="auto">
                  {item.body}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
