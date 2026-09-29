import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, UserPlus, UserX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe,
  listSchoolMembers,
  updateSchoolMember,
  removeSchoolMember,
  createGuardianship,
  SCHOOL_MEMBER_ROLES,
  type SchoolMemberRole,
} from "@/lib/schools-api";

/**
 * pages/schools/admin/members.tsx — «مدیریتِ اعضا» (فاز ۲).
 * خواندن برایِ مدیر/معاون/معاون‌انضباطی/مشاور (بک‌اند اعمال می‌کند)؛ ولی
 * تغییرِ نقش/حذف/پیوندِ والد فقط مدیر می‌بیند — بقیه فقط جدول را می‌بینند.
 */
export default function SchoolMembersPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navMemberManagement);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const isAdmin = me?.role === "admin";

  const { data: members, isLoading } = useQuery({
    queryKey: ["schools", "members", schoolId],
    queryFn: () => listSchoolMembers(schoolId!),
    enabled: !!schoolId,
  });

  const [linkingFor, setLinkingFor] = useState<string | null>(null);
  const [parentUserId, setParentUserId] = useState("");
  const [linking, setLinking] = useState(false);

  async function handleRoleChange(memberId: string, role: SchoolMemberRole) {
    if (!schoolId) return;
    try {
      await updateSchoolMember(schoolId, memberId, { role });
      await queryClient.invalidateQueries({ queryKey: ["schools", "members", schoolId] });
      toast({ title: t.memberUpdated });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.memberUpdateError, description: err?.data?.error });
    }
  }

  async function handleRemove(memberId: string) {
    if (!schoolId) return;
    try {
      await removeSchoolMember(schoolId, memberId);
      await queryClient.invalidateQueries({ queryKey: ["schools", "members", schoolId] });
      toast({ title: t.memberRemoved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.memberUpdateError, description: err?.data?.error });
    }
  }

  async function handleLink(studentMemberId: string) {
    if (!schoolId || !parentUserId.trim()) return;
    setLinking(true);
    try {
      await createGuardianship(schoolId, { parentUserId: parentUserId.trim(), studentMemberId });
      toast({ title: t.guardianshipLinked });
      setLinkingFor(null);
      setParentUserId("");
    } catch (err: any) {
      toast({ variant: "destructive", title: t.memberUpdateError, description: err?.data?.error });
    } finally {
      setLinking(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navMemberManagement}</h1>
        <p className="text-sm text-muted-foreground">{t.membersPageDescription}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.membersListTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {!members || members.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">{t.membersEmpty}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.memberColName}</TableHead>
                  <TableHead>{t.memberColRole}</TableHead>
                  <TableHead>{t.memberColGrade}</TableHead>
                  <TableHead>{t.memberColJoined}</TableHead>
                  {isAdmin && <TableHead className="text-end">{t.memberColActions}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{m.userName ?? "—"}</span>
                        <span className="text-xs text-muted-foreground" dir="ltr">{m.userEmail ?? m.userId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select value={m.role ?? undefined} onValueChange={(v) => handleRoleChange(m.id, v as SchoolMemberRole)}>
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder={t.fieldRolePlaceholder} />
                          </SelectTrigger>
                          <SelectContent>
                            {SCHOOL_MEMBER_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>{t[`role_${r}`] ?? r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>{t[`role_${m.role}`] ?? m.role ?? "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>{m.grade ?? "—"}</TableCell>
                    <TableCell dir="ltr" className="text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="flex items-center justify-end gap-1">
                        {m.role === "student" && (
                          <AlertDialog open={linkingFor === m.id} onOpenChange={(o) => setLinkingFor(o ? m.id : null)}>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" title={t.linkParentButton}>
                                <UserPlus className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t.linkParentButton}</AlertDialogTitle>
                                <AlertDialogDescription>{t.linkParentHint}</AlertDialogDescription>
                              </AlertDialogHeader>
                              <Input value={parentUserId} onChange={(e) => setParentUserId(e.target.value)} placeholder={t.fieldUserId} dir="ltr" />
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t.cancelButton}</AlertDialogCancel>
                                <AlertDialogAction disabled={linking || !parentUserId.trim()} onClick={() => handleLink(m.id)}>
                                  {linking && <Loader2 className="me-2 size-4 animate-spin" />}
                                  {t.linkParentConfirm}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title={t.removeMemberButton}>
                              <UserX className="size-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t.removeMemberButton}</AlertDialogTitle>
                              <AlertDialogDescription>{t.removeMemberConfirm}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t.cancelButton}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleRemove(m.id)}>{t.removeMemberButton}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
