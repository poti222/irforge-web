import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FlaskConical, Loader2, LogIn, Trash2, Sparkles } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { SCHOOL_MEMBER_ROLES, type SchoolMemberRole } from "@/lib/schools-api";
import { setAuthToken, getAuthToken } from "@/lib/auth-token";
import { SUPER_STASH_KEY } from "@/lib/super-stash";

/**
 * components/admin/TestIdentitiesManager.tsx — `/super` بخشِ C.
 *
 * عمداً جعلِ هویتِ موجود (middleware/impersonation.ts، read-only) را لمس
 * نمی‌کند — نگاه کن توضیحِ همین تصمیم در routes/testIdentities.ts. اینجا
 * فقط: ساختن یک هویتِ آزمایشیِ *واقعی*، «ورود» بهش (سوییچِ توکن در
 * localStorage با نگه‌داشتنِ توکنِ فعلی برای برگشت)، و پاکسازی.
 */

export interface TestIdentity {
  userId: string;
  name: string;
  email: string;
  schoolId: string | null;
  schoolName: string | null;
  role: SchoolMemberRole | null;
  grade: string | null;
  createdAt: string;
}

interface SchoolOption { id: string; name: string; isTestSchool: boolean }

export function TestIdentitiesManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [role, setRole] = useState<SchoolMemberRole | "">("");
  const [grade, setGrade] = useState("");
  const [schoolChoice, setSchoolChoice] = useState<string>(""); // schoolId یا "__new__"
  const [newSchoolName, setNewSchoolName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const { data: identities, isLoading } = useQuery({
    queryKey: ["super", "test-identities"],
    queryFn: () => customFetch<TestIdentity[]>("/api/super/test-identities", { credentials: "include" as any }),
  });

  const { data: schools } = useQuery({
    queryKey: ["super", "test-identities", "schools"],
    queryFn: () => customFetch<SchoolOption[]>("/api/super/test-identities/schools", { credentials: "include" as any }),
  });

  async function create() {
    if (!role) return;
    if (role === "student" && !grade.trim()) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: fa ? "پایه لازم است" : "Grade is required" });
      return;
    }
    const isNew = schoolChoice === "__new__";
    if (isNew && !newSchoolName.trim()) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: fa ? "نام مدرسه‌ی آزمایشی لازم است" : "Test school name is required" });
      return;
    }
    if (!isNew && !schoolChoice) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: fa ? "یک مدرسه انتخاب کن" : "Pick a school" });
      return;
    }
    setCreating(true);
    try {
      await customFetch("/api/super/test-identities", {
        method: "POST",
        credentials: "include" as any,
        body: JSON.stringify({
          role,
          grade: role === "student" ? grade.trim() : undefined,
          schoolId: isNew ? undefined : schoolChoice,
          newSchoolName: isNew ? newSchoolName.trim() : undefined,
        }),
      });
      toast({ title: fa ? "هویتِ آزمایشی ساخته شد" : "Test identity created" });
      setRole("");
      setGrade("");
      setSchoolChoice("");
      setNewSchoolName("");
      queryClient.invalidateQueries({ queryKey: ["super", "test-identities"] });
      queryClient.invalidateQueries({ queryKey: ["super", "test-identities", "schools"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setCreating(false);
    }
  }

  async function enter(identity: TestIdentity) {
    setBusyRow("enter:" + identity.userId);
    try {
      const result = await customFetch<{ token: string }>(`/api/super/test-identities/${identity.userId}/enter`, {
        method: "POST",
        credentials: "include" as any,
      });
      // نگه‌داشتنِ توکنِ سوپرادمینِ واقعیِ فعلی برای برگشت — فقط اگر از قبل
      // در حالِ تستِ یک هویتِ دیگر نبوده‌ایم (وگرنه استکِ تستِ تویِ تست می‌شد).
      const current = getAuthToken();
      if (current && !localStorage.getItem(SUPER_STASH_KEY)) {
        try { localStorage.setItem(SUPER_STASH_KEY, current); } catch { /* ignore */ }
      }
      setAuthToken(result.token);
      toast({ title: fa ? "وارد هویتِ آزمایشی شدی" : "Entered test identity" });
      window.location.href = "/schools";
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setBusyRow(null);
    }
  }

  async function remove(identity: TestIdentity) {
    setBusyRow("delete:" + identity.userId);
    try {
      await customFetch(`/api/super/test-identities/${identity.userId}`, { method: "DELETE", credentials: "include" as any });
      toast({ title: fa ? "حذف شد" : "Deleted" });
      queryClient.invalidateQueries({ queryKey: ["super", "test-identities"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setBusyRow(null);
    }
  }

  async function cleanupTestSchools() {
    setCleaning(true);
    try {
      const result = await customFetch<{ deletedSchools: number; deletedUsers: number }>("/api/super/test-schools/cleanup", {
        method: "POST",
        credentials: "include" as any,
      });
      toast({
        title: fa ? "پاکسازی شد" : "Cleaned up",
        description: fa
          ? `${result.deletedSchools} مدرسه و ${result.deletedUsers} حسابِ آزمایشی حذف شد.`
          : `${result.deletedSchools} schools and ${result.deletedUsers} test accounts deleted.`,
      });
      queryClient.invalidateQueries({ queryKey: ["super", "test-identities"] });
      queryClient.invalidateQueries({ queryKey: ["super", "test-identities", "schools"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4" />
            {fa ? "ساختِ هویتِ آزمایشیِ تازه" : "Create a new test identity"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={role} onValueChange={(v) => setRole(v as SchoolMemberRole)}>
              <SelectTrigger>
                <SelectValue placeholder={fa ? "نقش" : "Role"} />
              </SelectTrigger>
              <SelectContent>
                {SCHOOL_MEMBER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role === "student" && (
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder={fa ? "پایه" : "Grade"} />
            )}
          </div>

          <Select value={schoolChoice} onValueChange={setSchoolChoice}>
            <SelectTrigger>
              <SelectValue placeholder={fa ? "یک مدرسه‌ی واقعی یا ساختِ مدرسه‌ی آزمایشیِ تازه" : "An existing school, or create a fresh test school"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">{fa ? "+ ساختِ مدرسه‌ی آزمایشیِ تازه" : "+ Create a new test school"}</SelectItem>
              {(schools ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.isTestSchool ? (fa ? "(آزمایشی)" : "(test)") : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {schoolChoice === "__new__" && (
            <Input value={newSchoolName} onChange={(e) => setNewSchoolName(e.target.value)} placeholder={fa ? "نامِ مدرسه‌ی آزمایشی" : "Test school name"} />
          )}

          <Button onClick={create} disabled={creating || !role}>
            {creating ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Sparkles className="me-1.5 size-4" />}
            {fa ? "ساختِ هویتِ آزمایشی" : "Create test identity"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{fa ? "هویت‌های آزمایشیِ موجود" : "Existing test identities"}</CardTitle>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={cleaning}>
                {cleaning ? <Loader2 className="me-1.5 size-4 animate-spin" /> : null}
                {fa ? "پاکسازی مدارس تست" : "Clean up test schools"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{fa ? "پاکسازی همه‌یِ مدارسِ تست؟" : "Clean up all test schools?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {fa
                    ? "همه‌یِ مدارسی که isTestSchool هستند، همراهِ هویت‌های آزمایشیِ متعلق به آن‌ها حذف می‌شوند. رکوردهای تاریخیِ جزئی (مثلاً یک پیامِ قدیمی) ممکن است باقی بمانند."
                    : "Every school flagged as a test school, plus its test identities, will be deleted. Minor historical records (e.g. an old chat message) may remain."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction onClick={cleanupTestSchools}>{fa ? "پاکسازی" : "Clean up"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-20 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : !identities || identities.length === 0 ? (
            <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
              {fa ? "هنوز هویتِ آزمایشی‌ای ساخته نشده." : "No test identities yet."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fa ? "حساب" : "Account"}</TableHead>
                  <TableHead>{fa ? "مدرسه" : "School"}</TableHead>
                  <TableHead>{fa ? "نقش" : "Role"}</TableHead>
                  <TableHead>{fa ? "ساخته‌شده" : "Created"}</TableHead>
                  <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {identities.map((id) => (
                  <TableRow key={id.userId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-1.5 font-medium">
                          {id.name}
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{fa ? "تست" : "Test"}</Badge>
                        </span>
                        <span className="text-xs text-muted-foreground" dir="ltr">{id.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>{id.schoolName ?? "—"}</TableCell>
                    <TableCell>{id.role ?? "—"}{id.grade ? ` · ${id.grade}` : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground" dir="ltr">
                      {new Date(id.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" disabled={busyRow === "enter:" + id.userId} onClick={() => enter(id)}>
                          {busyRow === "enter:" + id.userId ? <Loader2 className="size-3.5 animate-spin" /> : <LogIn className="size-3.5" />}
                          {fa ? "ورود" : "Enter"}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={busyRow === "delete:" + id.userId} onClick={() => remove(id)}>
                          {busyRow === "delete:" + id.userId ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    </TableCell>
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
