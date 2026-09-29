import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Users, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listCounselorStudents, listCounselorNotes, createCounselorNote } from "@/lib/schools-api";

/**
 * pages/schools/counselor/students.tsx — لیستِ دانش‌آموزانِ مشاور + یادداشتِ
 * محرمانه (فاز ۲). فقط role="counselor"/"admin" این صفحه را می‌بینند
 * (سایدبار هم فقط برایِ counselor لینکش می‌کند؛ بک‌اند دوباره چک می‌کند).
 */
export default function CounselorStudentsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navStudentList);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: students, isLoading } = useQuery({
    queryKey: ["schools", "counselor-students", schoolId],
    queryFn: () => listCounselorStudents(schoolId!),
    enabled: !!schoolId,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: notes } = useQuery({
    queryKey: ["schools", "counselor-notes", schoolId, selected],
    queryFn: () => listCounselorNotes(schoolId!, selected!),
    enabled: !!schoolId && !!selected,
  });

  async function handleAddNote() {
    if (!schoolId || !selected || !note.trim()) return;
    setSaving(true);
    try {
      await createCounselorNote(schoolId, selected, note.trim());
      await queryClient.invalidateQueries({ queryKey: ["schools", "counselor-notes", schoolId, selected] });
      setNote("");
      toast({ title: t.noteSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.noteSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navStudentList}</h1>
        <p className="text-sm text-muted-foreground">{t.counselorStudentsDescription}</p>
      </div>

      {!students || students.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.membersEmpty}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> {t.navStudentList}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1">
              {students.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`rounded-md px-3 py-2 text-start text-sm transition ${selected === s.id ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                >
                  {s.grade ?? "—"} · {s.userId}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t.confidentialNotesTitle}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t.selectStudentHint}</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t.fieldNote} />
                    <Button onClick={handleAddNote} disabled={saving || !note.trim()}>
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(notes ?? []).map((n) => (
                      <div key={n.id} className="rounded-md border p-2 text-sm">
                        <p>{n.note}</p>
                        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                    {(!notes || notes.length === 0) && <p className="text-sm text-muted-foreground">{t.noNotesYet}</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
