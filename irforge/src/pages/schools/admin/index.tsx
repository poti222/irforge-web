import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { BarChart3, ImageIcon, KeyRound, Loader2, Plus, School as SchoolIcon, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useViewedSchool } from "@/hooks/use-viewed-school";
import {
  createSchool, getSchoolMe, updateSchool, listMySchools, listInviteCodes, createInviteCode, toggleInviteCode,
  listSchoolMembers, listSchoolClasses, addSchoolAdmin, SCHOOL_MEMBER_ROLES,
} from "@/lib/schools-api";

/**
 * pages/schools/admin/index.tsx — «مدرسه‌های من» برای نقشِ مدیر.
 *
 * فاز ۲: چندمدرسه‌ایِ واقعی — `school_members` همچنان دقیقاً یک ردیف به
 * ازایِ هر کاربر می‌ماند (همان قراردادِ فاز ۱، برایِ آنبوردینگ/SchoolShell)،
 * ولی جدولِ جداگانه‌ی `school_admins` به یک مدیر اجازه می‌دهد رویِ چند مدرسه
 * هم مدیر باشد؛ سوییچرِ بالا از `GET /api/schools/my-schools` (اتحادِ این دو
 * منبع) پر می‌شود و انتخاب یک مدرسه‌ی دیگر، فرمِ زیر و کارتِ وضعیتِ درسی را
 * برایِ همان مدرسه (نه لزوماً مدرسه‌ی عضویتِ اصلیِ کاربر) نشان می‌دهد.
 */
export default function SchoolsAdminHome() {
  const t = useT("schools");
  usePrivatePageTitle(t.adminMySchools);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  // چندمدرسه‌ایِ فاز ۲: همه‌یِ مدارسی که این مدیر رویشان admin است
  // (عضویتِ اصلی از school_members + بقیه از school_admins) — نگاه کن
  // routes/schools.ts (`GET /api/schools/my-schools`).
  const { data: mySchools } = useQuery({ queryKey: ["schools", "my-schools"], queryFn: listMySchools, enabled: me?.role === "admin" });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [licenseInfo, setLicenseInfo] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");
  // سوییچرِ «مدرسه‌های من» — فاز ۳: این انتخاب حالا سراسری است (ببینید
  // hooks/use-viewed-school.tsx) تا صفحاتِ دیگرِ مدیریتی (اعضا/کلاس‌ها/
  // برنامه‌ها/اعلامیه‌ها) هم همین مدرسه را ببینند، نه فقط این صفحه.
  const { viewedSchoolId, setViewedSchoolId } = useViewedSchool();

  const school = (mySchools ?? []).find((s) => s.id === viewedSchoolId) ?? me?.school ?? null;

  // فرم فقط وقتی مدرسه‌ی نمایش‌داده‌شده تغییر می‌کند مقداردهیِ اولیه می‌شود
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  if (school && initializedFor !== school.id) {
    setName(school.name);
    setAddress(school.address ?? "");
    setCity(school.city ?? "");
    setLicenseInfo(school.licenseInfo ?? "");
    setPhotoUrl(school.photoUrl ?? "");
    setInitializedFor(school.id);
  }

  async function handleSave() {
    if (!school) return;
    setSaving(true);
    try {
      await updateSchool(school.id, { name, address, city, licenseInfo, photoUrl: photoUrl.trim() || null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "my-schools"] });
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
        {school && (mySchools?.length ?? 0) > 0 && (
          <Select value={school.id} onValueChange={setViewedSchoolId}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(mySchools ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
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
                <Label>{t.fieldSchoolPhoto}</Label>
                {/* آپلودِ واقعی خارج از دامنه‌ی فاز ۳ است (این ریپو زیرساختِ
                    فایل ندارد) — به‌جایش یک فیلدِ URLِ ساده با پیش‌نمایشِ زنده،
                    که در فازهای بعد جایگزینِ آپلودِ واقعی می‌شود. */}
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    {photoUrl.trim() ? (
                      <img src={photoUrl.trim()} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                    ) : (
                      <ImageIcon className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  <Input
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder={t.fieldSchoolPhotoPlaceholder}
                    dir="ltr"
                  />
                </div>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-fit">
                {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                {t.saveButton}
              </Button>
            </CardContent>
          </Card>

          <AcademicStatusCard schoolId={school.id} />
          <InviteCodesCard schoolId={school.id} />
          <GrantAdminCard schoolId={school.id} />
        </>
      )}
    </div>
  );
}

/**
 * GrantAdminCard — فاز ۳، بخشِ ۶: رابطِ کاربریِ `POST /api/schools/:id/admins`
 * که از فازِ ۲ بدونِ UI مانده بود. از رویِ لیستِ اعضایِ همین مدرسه انتخاب
 * می‌شود (نه تایپِ آزادِ userId) — چون این لیست از قبل نام/ایمیل دارد و
 * ریسکِ اشتباه‌تایپیِ یک شناسه‌ی خام را حذف می‌کند.
 */
function GrantAdminCard({ schoolId }: { schoolId: string }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId) });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [granting, setGranting] = useState(false);

  const candidates = (members ?? []).filter((m) => m.role !== "admin");

  async function handleGrant() {
    if (!selectedUserId) return;
    setGranting(true);
    try {
      await addSchoolAdmin(schoolId, selectedUserId);
      toast({ title: t.adminGranted });
      setSelectedUserId("");
    } catch (err: any) {
      toast({ variant: "destructive", title: t.schoolSaveError, description: err?.data?.error });
    } finally {
      setGranting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5" /> {t.grantAdminTitle}
        </CardTitle>
        <CardDescription>{t.grantAdminDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>{t.grantAdminSelectLabel}</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger><SelectValue placeholder={t.selectMemberPlaceholder} /></SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.userName ?? m.userEmail ?? m.userId} — {t[`role_${m.role}`] ?? m.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleGrant} disabled={granting || !selectedUserId}>
          {granting ? <Loader2 className="me-2 size-4 animate-spin" /> : <UserPlus className="me-2 size-4" />}
          {t.grantAdminButton}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * AcademicStatusCard — «وضعیتِ درسی» (فاز ۲): چارتِ سادۀ شمارشِ اعضا به
 * تفکیکِ نقش + تعدادِ کلاس‌ها. عمداً عمیق‌تر نیست (نمرات/حضور و غیاب و…
 * هنوز مدل نشده‌اند) — فقط شمارشِ واقعی به‌جایِ استابِ خالیِ فاز ۱.
 */
function AcademicStatusCard({ schoolId }: { schoolId: string }) {
  const t = useT("schools") as any;
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId) });
  const { data: classes } = useQuery({ queryKey: ["schools", "classes", schoolId], queryFn: () => listSchoolClasses(schoolId) });

  const roleCounts = SCHOOL_MEMBER_ROLES.map((role) => ({
    role,
    label: t[`role_${role}`] ?? role,
    count: (members ?? []).filter((m) => m.role === role).length,
  })).filter((r) => r.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-5" /> {t.academicStatusTitle}
        </CardTitle>
        <CardDescription>{t.academicStatusDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex gap-4 text-sm text-muted-foreground">
          <span>{t.statClassesCount}: <b className="text-foreground">{classes?.length ?? 0}</b></span>
          <span>{t.statMembersCount}: <b className="text-foreground">{members?.length ?? 0}</b></span>
        </div>
        {roleCounts.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            {t.academicStatusEmpty}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={roleCounts}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** InviteCodesCard — تولید/فعال‌سازیِ کدهایِ معرف (فاز ۲؛ اندپوینتش از فاز ۱ بود، UI نداشت). */
function InviteCodesCard({ schoolId }: { schoolId: string }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: codes, isLoading } = useQuery({ queryKey: ["schools", "invite-codes", schoolId], queryFn: () => listInviteCodes(schoolId) });
  const [role, setRole] = useState<string>("none");
  const [creating, setCreating] = useState(false);

  async function handleGenerate() {
    setCreating(true);
    try {
      await createInviteCode(schoolId, role === "none" ? null : (role as any));
      await queryClient.invalidateQueries({ queryKey: ["schools", "invite-codes", schoolId] });
      toast({ title: t.inviteCodeCreated });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.schoolSaveError, description: err?.data?.error });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(codeId: string, active: boolean) {
    try {
      await toggleInviteCode(schoolId, codeId, active);
      await queryClient.invalidateQueries({ queryKey: ["schools", "invite-codes", schoolId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.schoolSaveError, description: err?.data?.error });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" /> {t.inviteCodesTitle}
        </CardTitle>
        <CardDescription>{t.inviteCodesDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>{t.fieldRole}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.inviteCodeAnyRole}</SelectItem>
                {SCHOOL_MEMBER_ROLES.map((r) => <SelectItem key={r} value={r}>{t[`role_${r}`] ?? r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleGenerate} disabled={creating}>
            {creating ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}
            {t.generateInviteCodeButton}
          </Button>
        </div>

        {isLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : !codes || codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.inviteCodesEmpty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {codes.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 text-sm" dir="ltr">{c.code}</code>
                  <Badge variant="outline">{c.role ? (t[`role_${c.role}`] ?? c.role) : t.inviteCodeAnyRole}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{c.active ? t.inviteCodeActive : t.inviteCodeInactive}</span>
                  <Switch checked={c.active} onCheckedChange={(v) => handleToggle(c.id, v)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
