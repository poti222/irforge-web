import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, ImageOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  createSchoolContentItem,
  getSchoolMe,
  listSchoolContent,
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
 * این فقط UI را برای همان‌ها نشان می‌دهد). آپلودِ تصویر عمداً غیرفعال است
 * (طبقِ خواستِ کاربر) — یک نشانِ «به‌زودی» به‌جایش.
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
  const schoolId = me?.schoolId ?? undefined;

  const { data: items, isLoading } = useQuery({
    queryKey: ["schools", "content", type, schoolId],
    queryFn: () => listSchoolContent(type, schoolId),
  });

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createSchoolContentItem({ type, title: title.trim(), body, language: language.trim() || null, schoolId: schoolId ?? null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "content", type] });
      setTitle("");
      setBody("");
      setLanguage("");
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{label}</h1>
        {canWrite && (
          <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
            <Plus className="me-1 size-4" /> {t.addContentButton}
          </Button>
        )}
      </div>

      {canWrite && showForm && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.contentTitleField}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ImageOff className="size-3.5" />
              {t.imageUploadComingSoon}
            </div>
            <Button onClick={handleCreate} disabled={saving || !title.trim()} className="w-fit">
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
                    {item.language && (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {item.language}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
