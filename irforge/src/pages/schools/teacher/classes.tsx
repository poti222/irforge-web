import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Presentation, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listSchoolClasses, listSchoolAnnouncements, createSchoolAnnouncement } from "@/lib/schools-api";

/**
 * pages/schools/teacher/classes.tsx — «کلاس‌های من» برایِ معلم (فاز ۲):
 * کلاس‌هایی که roleInClass="teacher" در آن‌هاست + یک فرمِ سادۀ «اطلاعیه به
 * کلاس» (kind="class" رویِ همان جدولِ اعلامیه‌ها، فقط برایِ همین کلاس‌ها
 * قابلِ‌ارسال — بک‌اند هم همین را اعمال می‌کند).
 */
export default function TeacherClassesPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navClassrooms);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: myClasses, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: classAnnouncements } = useQuery({
    queryKey: ["schools", "announcements", schoolId, selectedClassId],
    queryFn: () => listSchoolAnnouncements(schoolId!, selectedClassId),
    enabled: !!schoolId && !!selectedClassId,
  });

  async function handlePost() {
    if (!schoolId || !selectedClassId || !title.trim()) return;
    setSaving(true);
    try {
      await createSchoolAnnouncement(schoolId, { kind: "class", title: title.trim(), body, classId: selectedClassId });
      await queryClient.invalidateQueries({ queryKey: ["schools", "announcements", schoolId, selectedClassId] });
      setTitle(""); setBody("");
      toast({ title: t.announcementSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.announcementSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navClassrooms}</h1>
        <p className="text-sm text-muted-foreground">{t.teacherClassesDescription}</p>
      </div>

      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {myClasses.map((c) => (
              <Card
                key={c.id}
                className={`cursor-pointer transition hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${selectedClassId === c.id ? "border-primary" : ""}`}
                onClick={() => setSelectedClassId(c.id)}
                // کلِ کارت انتخاب‌کننده است؛ role=button بدونِ tabIndex/کلیدِ Enter و Space برایِ کیبورد کار نمی‌کرد.
                role="button"
                tabIndex={0}
                aria-pressed={selectedClassId === c.id}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClassId(c.id); } }}
                data-testid={`card-teacher-class-${c.id}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Presentation className="size-4" /> {c.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{c.grade ?? "—"}</CardContent>
              </Card>
            ))}
          </div>

          {selectedClassId && (
            <Card>
              <CardHeader><CardTitle className="text-base">{t.postToClassTitle}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.fieldAnnouncementTitle} />
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={t.fieldAnnouncementBody} />
                <Button onClick={handlePost} disabled={saving || !title.trim()} className="w-fit">
                  {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
                  {t.postButton}
                </Button>
                <div className="mt-2 flex flex-col gap-2">
                  {(classAnnouncements ?? []).filter((a) => a.kind === "class").map((a) => (
                    <div key={a.id} className="rounded-md border p-3">
                      <div className="font-medium">{a.title}</div>
                      <p className="text-sm text-muted-foreground">{a.body}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
