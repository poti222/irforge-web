import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, ImageOff, Loader2, Plus, School as SchoolIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { createSchool, getSchoolMe, updateSchool } from "@/lib/schools-api";

/**
 * pages/schools/admin/index.tsx — «مدرسه‌های من» برای نقشِ مدیر.
 *
 * محدودیتِ دانسته‌شده‌ی فاز ۱: جدولِ `school_members` فقط یک `schoolId` به
 * ازایِ هر کاربر نگه می‌دارد (طبقِ اسپکِ دیتابیس)، پس یک مدیر در این فاز
 * دقیقاً همان یک مدرسه‌ای را می‌بیند که در آنبوردینگ به آن پیوسته/ساخته —
 * سوییچرِ زیر UIِ واقعیِ چندمدرسه‌ای را دارد (طبقِ الگویِ سوییچِ بات) ولی با
 * یک آیتم؛ افزودنِ رابطه‌ی many-to-many (مدیرهای متعدد ↔ مدرسه‌های متعدد)
 * برای فاز ۲ گذاشته شده — نگاه کن به گزارشِ نهایی.
 */
export default function SchoolsAdminHome() {
  const t = useT("schools");
  usePrivatePageTitle(t.adminMySchools);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [licenseInfo, setLicenseInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");

  const school = me?.school ?? null;

  // فرم فقط وقتی مدرسه تغییر می‌کند مقداردهیِ اولیه می‌شود
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  if (school && initializedFor !== school.id) {
    setName(school.name);
    setAddress(school.address ?? "");
    setCity(school.city ?? "");
    setLicenseInfo(school.licenseInfo ?? "");
    setInitializedFor(school.id);
  }

  async function handleSave() {
    if (!school) return;
    setSaving(true);
    try {
      await updateSchool(school.id, { name, address, city, licenseInfo });
      await queryClient.invalidateQueries({ queryKey: ["schools", "me"] });
      toast({ title: t.schoolSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.schoolSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSchool() {
    if (!newSchoolName.trim()) return;
    setCreating(true);
    try {
      await createSchool({ name: newSchoolName.trim() });
      await queryClient.invalidateQueries({ queryKey: ["schools", "me"] });
      setNewSchoolName("");
      toast({ title: t.schoolCreated });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.schoolSaveError, description: err?.data?.error });
    } finally {
      setCreating(false);
    }
  }

  if (isLoading) {
    return <Loader2 className="size-6 animate-spin" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t.adminMySchools}</h1>
          <p className="text-sm text-muted-foreground">{t.adminMySchoolsDescription}</p>
        </div>
        {school && (
          <Select value={school.id}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={school.id}>{school.name}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {!school ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SchoolIcon className="size-5" /> {t.noSchoolYetTitle}
            </CardTitle>
            <CardDescription>{t.noSchoolYetDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input value={newSchoolName} onChange={(e) => setNewSchoolName(e.target.value)} placeholder={t.fieldSchoolNamePlaceholder} />
            <Button onClick={handleCreateSchool} disabled={creating || !newSchoolName.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t.createSchoolButton}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t.schoolDetailsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldSchoolNameLabel}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldSchoolAddress}</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldCity}</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldLicenseInfo}</Label>
                <Textarea value={licenseInfo} onChange={(e) => setLicenseInfo(e.target.value)} rows={3} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-2">
                  {t.fieldSchoolPhoto}
                  <Badge variant="outline" className="text-[10px]">
                    {t.comingSoon}
                  </Badge>
                </Label>
                <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  <ImageOff className="size-6" />
                </div>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-fit">
                {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                {t.saveButton}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="size-5" /> {t.academicStatusTitle}
              </CardTitle>
              <CardDescription>{t.academicStatusDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                {t.academicStatusEmpty}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
