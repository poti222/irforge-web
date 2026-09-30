import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardList, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listSchoolClasses, listSchoolAssignments, getMyAssignmentSubmission, submitAssignment } from "@/lib/schools-api";

/**
 * pages/schools/student/assignments.tsx — «تکالیف من» (فاز ۳، بندِ ۳):
 * تکالیفِ همه‌یِ کلاس‌هایی که دانش‌آموز در آن‌هاست + ارسال/دیدنِ نمره.
 */
export default function StudentAssignmentsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAssignments);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  // ?mine=true حالا برایِ دانش‌آموز هم روسترِ خودش (roleInClass="student") را
  // فیلتر می‌کند (فاز ۳ — ببینید routes/schoolClasses.ts)، نه کلِ کلاس‌هایِ مدرسه.
  const { data: classes, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navAssignments}</h1>
        <p className="text-sm text-muted-foreground">{t.studentAssignmentsDescription}</p>
      </div>
      {!classes || classes.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <div className="flex flex-col gap-4">
          {classes.map((c) => (
            <ClassAssignments key={c.id} schoolId={schoolId!} classId={c.id} className={c.name} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClassAssignments({ schoolId, classId, className }: { schoolId: string; classId: string; className: string }) {
  const t = useT("schools") as any;
  const { data: assignments } = useQuery({
    queryKey: ["schools", "assignments", schoolId, classId],
    queryFn: () => listSchoolAssignments(schoolId, classId),
  });

  if (!assignments || assignments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{className}</h2>
      {assignments.map((a) => (
        <AssignmentCard key={a.id} schoolId={schoolId} assignment={a} />
      ))}
    </div>
  );
}

function AssignmentCard({ schoolId, assignment }: { schoolId: string; assignment: { id: string; title: string; description: string | null; dueDate: string | null } }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: mySubmission } = useQuery({
    queryKey: ["schools", "my-submission", assignment.id],
    queryFn: () => getMyAssignmentSubmission(schoolId, assignment.id),
  });
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      await submitAssignment(schoolId, assignment.id, content);
      await queryClient.invalidateQueries({ queryKey: ["schools", "my-submission", assignment.id] });
      toast({ title: t.assignmentSubmitted });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.assignmentSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><ClipboardList className="size-4" /> {assignment.title}</span>
          {mySubmission?.grade && <Badge>{mySubmission.grade}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {assignment.description && <p className="text-sm text-muted-foreground">{assignment.description}</p>}
        {mySubmission ? (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <p className="whitespace-pre-wrap">{mySubmission.content}</p>
            {mySubmission.feedback && <p className="mt-1 text-xs text-muted-foreground">{t.fieldFeedback}: {mySubmission.feedback}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder={t.assignmentSubmissionPlaceholder} />
            <Button size="sm" onClick={handleSubmit} disabled={saving || !content.trim()} className="w-fit">
              {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
              {t.submitAssignmentButton}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
