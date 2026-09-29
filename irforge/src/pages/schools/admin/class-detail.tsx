import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowRight, UserMinus, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listClassMembers, addClassMember, removeClassMember, listSchoolMembers,
} from "@/lib/schools-api";

/**
 * pages/schools/admin/class-detail.tsx — روسترِ یک کلاس: افزودن/حذفِ
 * دانش‌آموز یا تعیینِ معلم. عمداً بدونِ صفحه‌ی جدا برایِ ویرایشِ خودِ کلاس —
 * نام/پایه از همان کارتِ لیست ساخته می‌شود، این‌جا فقط روستر است.
 */
export default function SchoolClassDetailPage() {
  const { id: classId } = useParams<{ id: string }>();
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navClassManagement);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const canWrite = me?.role === "admin" || me?.role === "deputy";

  const { data: classes } = useQuery({
    queryKey: ["schools", "classes", schoolId],
    queryFn: () => listSchoolClasses(schoolId!),
    enabled: !!schoolId,
  });
  const cls = classes?.find((c) => c.id === classId);

  const { data: roster, isLoading } = useQuery({
    queryKey: ["schools", "class-members", classId],
    queryFn: () => listClassMembers(schoolId!, classId),
    enabled: !!schoolId,
  });

  const { data: allMembers } = useQuery({
    queryKey: ["schools", "members", schoolId],
    queryFn: () => listSchoolMembers(schoolId!),
    enabled: !!schoolId && canWrite,
  });

  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<"student" | "teacher">("student");
  const [saving, setSaving] = useState(false);

  const rosterMemberIds = new Set((roster ?? []).map((r) => r.schoolMemberId));
  const availableMembers = (allMembers ?? []).filter((m) => !rosterMemberIds.has(m.id) && (m.role === "student" || m.role === "teacher"));

  async function handleAdd() {
    if (!schoolId || !classId || !selectedMemberId) return;
    setSaving(true);
    try {
      await addClassMember(schoolId, classId, { schoolMemberId: selectedMemberId, roleInClass: selectedRole });
      await queryClient.invalidateQueries({ queryKey: ["schools", "class-members", classId] });
      setSelectedMemberId("");
      toast({ title: t.classMemberAdded });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.classSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(memberId: string) {
    if (!schoolId || !classId) return;
    try {
      await removeClassMember(schoolId, classId, memberId);
      await queryClient.invalidateQueries({ queryKey: ["schools", "class-members", classId] });
      toast({ title: t.classMemberRemoved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.classSaveError, description: err?.data?.error });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/schools/admin/classes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowRight className="size-4" /> {t.backToList}
      </Link>
      <div>
        <h1 className="text-xl font-bold">{cls?.name ?? t.navClassManagement}</h1>
        <p className="text-sm text-muted-foreground">{cls?.grade}</p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t.addClassMemberTitle}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                <SelectTrigger><SelectValue placeholder={t.selectMemberPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {availableMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.userName ?? m.userEmail ?? m.userId} — {t[`role_${m.role}`] ?? m.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as "student" | "teacher")}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="student">{t.role_student}</SelectItem>
                <SelectItem value="teacher">{t.role_teacher}</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} disabled={saving || !selectedMemberId}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              {t.addButton}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t.rosterTitle}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : !roster || roster.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">{t.rosterEmpty}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.memberColName}</TableHead>
                  <TableHead>{t.memberColRole}</TableHead>
                  {canWrite && <TableHead className="text-end">{t.memberColActions}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => {
                  const person = (allMembers ?? []).find((m) => m.id === r.schoolMemberId);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{person?.userName ?? person?.userEmail ?? r.schoolMemberId}</TableCell>
                      <TableCell>{t[`role_${r.roleInClass}`] ?? r.roleInClass}</TableCell>
                      {canWrite && (
                        <TableCell className="text-end">
                          <Button size="icon" variant="ghost" onClick={() => handleRemove(r.id)}>
                            <UserMinus className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
