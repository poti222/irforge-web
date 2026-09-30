import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, LayoutGrid } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useViewedSchoolId } from "@/hooks/use-viewed-school";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getSchoolMe, listSchoolClasses, createSchoolClass, deleteSchoolClass } from "@/lib/schools-api";

/**
 * pages/schools/admin/classes.tsx — «مدیریتِ کلاس‌ها» (فاز ۲). فقط
 * admin/deputy می‌توانند بسازند/حذف کنند (بک‌اند اعمال می‌کند)؛ لیست را هر
 * عضوِ مدرسه می‌بیند.
 */
export default function SchoolClassesPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navClassManagement);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useViewedSchoolId(me?.schoolId);
  const canWrite = me?.role === "admin" || me?.role === "deputy";

  const { data: classes, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId],
    queryFn: () => listSchoolClasses(schoolId!),
    enabled: !!schoolId,
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!schoolId || !name.trim()) return;
    setSaving(true);
    try {
      await createSchoolClass(schoolId, { name: name.trim(), grade: grade.trim() || null, academicYear: academicYear.trim() || null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "classes", schoolId] });
      setName(""); setGrade(""); setAcademicYear(""); setShowForm(false);
      toast({ title: t.classSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.classSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(classId: string) {
    if (!schoolId) return;
    try {
      await deleteSchoolClass(schoolId, classId);
      await queryClient.invalidateQueries({ queryKey: ["schools", "classes", schoolId] });
      toast({ title: t.classDeleted });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.classSaveError, description: err?.data?.error });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.navClassManagement}</h1>
          <p className="text-sm text-muted-foreground">{t.classesPageDescription}</p>
        </div>
        {canWrite && (
          <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
            <Plus className="me-1 size-4" /> {t.addClassButton}
          </Button>
        )}
      </div>

      {canWrite && showForm && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>{t.fieldClassName}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>{t.fieldGrade}</Label>
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder={t.fieldGradePlaceholder} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>{t.fieldAcademicYear}</Label>
              <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} dir="ltr" placeholder="1404-1405" />
            </div>
            <Button onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.saveButton}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : !classes || classes.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <Card key={c.id} className="transition hover:border-primary/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <Link href={`/schools/admin/classes/${c.id}`} className="flex items-center gap-2 hover:underline">
                    <LayoutGrid className="size-4" /> {c.name}
                  </Link>
                  {canWrite && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost"><Trash2 className="size-4 text-destructive" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t.deleteClassConfirmTitle}</AlertDialogTitle>
                          <AlertDialogDescription>{t.deleteClassConfirmDescription}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t.cancelButton}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(c.id)}>{t.deleteClassButton}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {c.grade ?? "—"} {c.academicYear ? `· ${c.academicYear}` : ""}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
