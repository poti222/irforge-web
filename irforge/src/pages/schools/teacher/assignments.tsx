import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardList, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listSchoolAssignments, createSchoolAssignment,
  listAssignmentSubmissions, gradeAssignmentSubmission, listSchoolMembers,
} from "@/lib/schools-api";

/**
 * pages/schools/teacher/assignments.tsx — «تکالیف» (فاز ۳، بندِ ۳): معلم
 * برایِ یکی از کلاس‌های خودش تکلیف می‌سازد و ارسال‌های دانش‌آموزان را
 * می‌بیند/نمره می‌دهد.
 */
export default function TeacherAssignmentsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAssignments);
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
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);

  const { data: assignments } = useQuery({
    queryKey: ["schools", "assignments", schoolId, selectedClassId],
    queryFn: () => listSchoolAssignments(schoolId!, selectedClassId),
    enabled: !!schoolId && !!selectedClassId,
  });

  async function handleCreate() {
    if (!schoolId || !selectedClassId || !title.trim()) return;
    setSaving(true);
    try {
      await createSchoolAssignment(schoolId, { classId: selectedClassId, title: title.trim(), description: description || null, dueDate: dueDate || null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "assignments", schoolId, selectedClassId] });
      setTitle(""); setDescription(""); setDueDate(""); setShowForm(false);
      toast({ title: t.assignmentSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.assignmentSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navAssignments}</h1>
        <p className="text-sm text-muted-foreground">{t.assignmentsPageDescription}</p>
      </div>

      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {myClasses.map((c) => (
              <Card key={c.id} className={selectedClassId === c.id ? "cursor-pointer border-primary" : "cursor-pointer"} onClick={() => setSelectedClassId(c.id)} role="button">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          {selectedClassId && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{t.assignmentsListTitle}</h2>
                <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
                  <Plus className="me-1 size-4" /> {t.addAssignmentButton}
                </Button>
              </div>

              {showForm && (
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-4">
                    <div className="flex flex-col gap-1.5">
                      <Label>{t.fieldAssignmentTitle}</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t.fieldAssignmentDescription}</Label>
                      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:w-56">
                      <Label>{t.fieldAssignmentDueDate}</Label>
                      <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr" />
                    </div>
                    <Button onClick={handleCreate} disabled={saving || !title.trim()} className="w-fit">
                      {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                      {t.saveButton}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {!assignments || assignments.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.assignmentsEmpty}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {assignments.map((a) => (
                    <Card key={a.id}>
                      <CardContent className="flex flex-col gap-2 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-medium">
                            <ClipboardList className="size-4 text-primary" /> {a.title}
                            {a.dueDate && <Badge variant="outline" dir="ltr">{new Date(a.dueDate).toLocaleDateString()}</Badge>}
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => setOpenAssignmentId(openAssignmentId === a.id ? null : a.id)}>
                            {t.viewSubmissionsButton}
                          </Button>
                        </div>
                        {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
                        {openAssignmentId === a.id && (
                          <SubmissionsPanel schoolId={schoolId!} assignmentId={a.id} />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SubmissionsPanel({ schoolId, assignmentId }: { schoolId: string; assignmentId: string }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: submissions, isLoading } = useQuery({
    queryKey: ["schools", "assignment-submissions", assignmentId],
    queryFn: () => listAssignmentSubmissions(schoolId, assignmentId),
  });
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId) });
  const [grades, setGrades] = useState<Record<string, string>>({});

  async function handleGrade(submissionId: string) {
    try {
      await gradeAssignmentSubmission(schoolId, assignmentId, submissionId, { grade: grades[submissionId] ?? null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "assignment-submissions", assignmentId] });
      toast({ title: t.gradeSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.assignmentSaveError, description: err?.data?.error });
    }
  }

  if (isLoading) return <Loader2 className="size-4 animate-spin" />;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2">
      {!submissions || submissions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noSubmissionsYet}</p>
      ) : (
        submissions.map((s) => {
          const person = (members ?? []).find((m) => m.id === s.studentMemberId);
          return (
            <div key={s.id} className="flex flex-col gap-1 rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{person?.userName ?? person?.userEmail ?? s.studentMemberId}</span>
                {s.grade && <Badge>{s.grade}</Badge>}
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{s.content || "—"}</p>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-24"
                  placeholder={t.fieldGrade}
                  value={grades[s.id] ?? s.grade ?? ""}
                  onChange={(e) => setGrades((g) => ({ ...g, [s.id]: e.target.value }))}
                />
                <Button size="sm" variant="outline" onClick={() => handleGrade(s.id)}>{t.saveButton}</Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
