import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Megaphone, BellRing, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listSchoolAnnouncements, createSchoolAnnouncement, type SchoolAnnouncementKind } from "@/lib/schools-api";

/**
 * pages/schools/announcements.tsx — فیدِ «پیام همگانی»/«اعلامیه‌ی تعطیلی»
 * (فاز ۲). خودِ فید برایِ همه‌یِ نقش‌ها قابلِ‌خواندن است؛ فرمِ نوشتن فقط برایِ
 * admin/deputy/deputy_discipline نشان داده می‌شود (بک‌اند هم فقط admin/deputy
 * را می‌پذیرد — انضباطی طبقِ اسپکِ فاز ۲ فقط خواندن دارد).
 */
export default function SchoolAnnouncementsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navBroadcast);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const canWrite = me?.role === "admin" || me?.role === "deputy";

  const { data: items, isLoading } = useQuery({
    queryKey: ["schools", "announcements", schoolId],
    queryFn: () => listSchoolAnnouncements(schoolId!),
    enabled: !!schoolId,
  });

  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<SchoolAnnouncementKind>("broadcast");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!schoolId || !title.trim()) return;
    setSaving(true);
    try {
      await createSchoolAnnouncement(schoolId, { kind, title: title.trim(), body });
      await queryClient.invalidateQueries({ queryKey: ["schools", "announcements", schoolId] });
      setTitle(""); setBody(""); setShowForm(false);
      toast({ title: t.announcementSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.announcementSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.announcementsTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.announcementsDescription}</p>
        </div>
        {canWrite && (
          <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
            <Plus className="me-1 size-4" /> {t.addAnnouncementButton}
          </Button>
        )}
      </div>

      {canWrite && showForm && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldAnnouncementKind}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as SchoolAnnouncementKind)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="broadcast">{t.navBroadcast}</SelectItem>
                  <SelectItem value="closure">{t.navClosureAnnouncement}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldAnnouncementTitle}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldAnnouncementBody}</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
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
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.announcementsEmpty}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex-row items-center justify-between gap-2 pb-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  {a.kind === "closure" ? <BellRing className="size-4 text-destructive" /> : <Megaphone className="size-4 text-primary" />}
                  {a.title}
                </CardTitle>
                <Badge variant={a.kind === "closure" ? "destructive" : "outline"}>
                  {a.kind === "closure" ? t.navClosureAnnouncement : t.navBroadcast}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                <p className="mt-2 text-xs text-muted-foreground" dir="ltr">{new Date(a.createdAt).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
