import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { submitSchoolOnboarding, type SchoolMemberMe, type SchoolMemberRole, SCHOOL_MEMBER_ROLES } from "@/lib/schools-api";

/**
 * onboarding.tsx — فرمِ اطلاعاتِ اولیه‌ی «پروفایلِ مدرسه‌ای» (جدا از ویزارد
 * هویتِ سراسری). طبقِ هماهنگی‌های کدبیس (register.tsx/complete-profile.tsx
 * هم همین‌طورند) با useState ساده پیاده شده، نه react-hook-form — چون هیچ
 * فرمِ موجودی در این پروژه از آن استفاده نمی‌کند و افزودنش اینجا یک الگوی
 * تازه و ناهمخوان با بقیه‌ی کدبیس می‌ساخت.
 *
 * فیلدِ «کد معرف» همین‌جا هم هست (علاوه‌بر ویجتِ مستقلِ کنارِ سایدبار بعد از
 * آنبوردینگ) — دقیقاً طبقِ خواستِ کاربر.
 */
export default function SchoolsOnboarding({ onDone }: { onDone: (me: SchoolMemberMe) => void }) {
  const t = useT("schools");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [role, setRole] = useState<SchoolMemberRole | "">("");
  const [grade, setGrade] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [city, setCity] = useState("");
  const [schoolNameFreeText, setSchoolNameFreeText] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabels: Record<SchoolMemberRole, string> = {
    student: t.roleStudent,
    teacher: t.roleTeacher,
    admin: t.roleAdmin,
    counselor: t.roleCounselor,
    deputy: t.roleDeputy,
    deputy_discipline: t.roleDeputyDiscipline,
    parent: t.roleParent,
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!role) {
      setError(t.errRoleRequired);
      return;
    }
    if (!nationalId.trim() || !birthDate || !city.trim()) {
      setError(t.errRequiredFields);
      return;
    }
    if (role === "student" && !grade.trim()) {
      setError(t.errGradeRequired);
      return;
    }
    setBusy(true);
    try {
      const me = await submitSchoolOnboarding({
        role,
        grade: grade.trim() || null,
        nationalId: nationalId.trim(),
        birthDate: new Date(birthDate).toISOString(),
        city: city.trim(),
        schoolNameFreeText: schoolNameFreeText.trim() || null,
        inviteCode: inviteCode.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "me"] });
      onDone(me);
    } catch (err: any) {
      toast({ variant: "destructive", title: t.onboardingError, description: err?.data?.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-lg items-center justify-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t.onboardingTitle}</CardTitle>
          <CardDescription>{t.onboardingDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldRole}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as SchoolMemberRole)}>
                <SelectTrigger>
                  <SelectValue placeholder={t.fieldRolePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {SCHOOL_MEMBER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabels[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {role === "student" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="school-grade">{t.fieldGrade}</Label>
                <Input id="school-grade" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder={t.fieldGradePlaceholder} />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-birthdate">{t.fieldBirthDate}</Label>
              <Input id="school-birthdate" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-city">{t.fieldCity}</Label>
              <Input id="school-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t.fieldCityPlaceholder} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-name-free">{t.fieldSchoolName}</Label>
              <Input
                id="school-name-free"
                value={schoolNameFreeText}
                onChange={(e) => setSchoolNameFreeText(e.target.value)}
                placeholder={t.fieldSchoolNamePlaceholder}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-national-id">{t.fieldNationalId}</Label>
              <Input id="school-national-id" value={nationalId} onChange={(e) => setNationalId(e.target.value)} dir="ltr" />
            </div>

            <div className="flex flex-col gap-1.5 rounded-md border border-dashed p-3">
              <Label htmlFor="school-invite-code">{t.fieldInviteCode}</Label>
              <Input
                id="school-invite-code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={t.fieldInviteCodePlaceholder}
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground">{t.fieldInviteCodeHint}</p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.onboardingSubmit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
