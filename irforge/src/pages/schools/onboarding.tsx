import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { submitSchoolOnboarding, type SchoolMemberMe, type SchoolMemberRole, SCHOOL_MEMBER_ROLES } from "@/lib/schools-api";
import { digitsOnly } from "@/lib/digits";
import { gregorianToJalali, jalaliToGregorian, toPersianDigits, JALALI_MONTH_NAMES_FA } from "@/lib/tehran-time";
import { IRAN_CITIES_FLAT } from "@/lib/iran-cities";

/**
 * onboarding.tsx — فرمِ اطلاعاتِ اولیه‌ی «پروفایلِ مدرسه‌ای» (جدا از ویزارد
 * هویتِ سراسری). طبقِ هماهنگی‌های کدبیس (register.tsx/complete-profile.tsx
 * هم همین‌طورند) با useState ساده پیاده شده، نه react-hook-form — چون هیچ
 * فرمِ موجودی در این پروژه از آن استفاده نمی‌کند و افزودنش اینجا یک الگوی
 * تازه و ناهمخوان با بقیه‌ی کدبیس می‌ساخت.
 *
 * فیلدِ «کد معرف» همین‌جا هم هست (علاوه‌بر ویجتِ مستقلِ کنارِ سایدبار بعد از
 * آنبوردینگ) — دقیقاً طبقِ خواستِ کاربر.
 *
 * ─── باگ‌فیکسِ تستِ زنده‌ی کاربر (۴ بند) ────────────────────────────────────
 * ۱) «پایه‌ی تحصیلی باید گزینه‌ای باشد از ۱ تا ۱۲» — به‌جای Input آزاد، یک
 *    Select با ۱۲ گزینه («پایه ۱» تا «پایه ۱۲»)، فقط برای role="student".
 * ۲) «تاریخ تولد به شمسی باشد» — سه Select سال/ماه/روزِ شمسی، با همان
 *    توابعِ تبدیلِ jalaliToGregorian/gregorianToJalali که از قبل در
 *    lib/tehran-time.ts برای فرمِ زمان‌بندیِ کمپینِ drip وجود داشت (نه یک
 *    کتابخانه یا الگوریتمِ تازه). تبدیل همین‌جا (سمتِ کلاینت) به میلادی/ISO
 *    انجام می‌شود، چون ستونِ `birth_date` در دیتابیس از قبل TIMESTAMPTZ است
 *    و انتظارِ ISO دارد — سرور هیچ‌وقت رشته‌ی شمسی نمی‌بیند.
 * ۳) «ثبتِ اطلاعات با خطا مواجه شد» — ریشه‌ی واقعی در بک‌اند بود
 *    (api-server/src/routes/schools.ts: پیشوندِ تکراریِ `/api` باعث ۴۰۴ روی
 *    هر درخواستِ این بخش می‌شد)، همین‌جا هم خطا حالا واقعی‌تر نمایش داده
 *    می‌شود (پیامِ سرور به‌جایِ رشته‌ی همیشه-ثابت، وقتی موجود باشد).
 * ۴) «کد ملی باید ۱۰ رقمی باشد» — اعتبارسنجیِ فوریِ سمتِ کلاینت (blur/submit)
 *    + همان قاعده سمتِ سرور (هیچ اعتبارسنجیِ کدِ‌ملیِ دیگری در کدبیس نبود تا
 *    از آن استفاده شود). `digitsOnly` (لهاز lib/digits.ts، همان چیزی که
 *    فیلدهای مبلغ استفاده می‌کنند) کیبوردِ فارسی/عربی را هم قبول می‌کند.
 * ۵) «شهرها از یک لیستِ معتبر، با combobox» — همان الگوی Popover+Command که
 *    AllBotsTable.tsx برای انتخابِ مالکِ بات استفاده می‌کند؛ دیتای شهرها در
 *    lib/iran-cities.ts (کاملیتِ آن در کامنتِ همان فایل مستند شده).
 */
export default function SchoolsOnboarding({ onDone }: { onDone: (me: SchoolMemberMe) => void }) {
  const t = useT("schools");
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [role, setRole] = useState<SchoolMemberRole | "">("");
  const [grade, setGrade] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [nationalIdError, setNationalIdError] = useState<string | null>(null);

  const todayJalali = useMemo(() => {
    const now = new Date();
    return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }, []);
  const [birthJy, setBirthJy] = useState<string>("");
  const [birthJm, setBirthJm] = useState<string>("");
  const [birthJd, setBirthJd] = useState<string>("");

  const [city, setCity] = useState("");
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
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

  const GRADE_VALUES = useMemo(() => Array.from({ length: 12 }, (_, i) => String(i + 1)), []);

  /** بازه‌ی معقولِ سالِ تولد (شمسی) برای Selectِ سال — از امروز تا ۱۰۰ سال پیش. */
  const birthYearOptions = useMemo(
    () => Array.from({ length: 100 }, (_, i) => todayJalali[0] - i),
    [todayJalali],
  );
  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, i) => i + 1), []);

  function validateNationalId(value: string): string | null {
    if (!value) return null; // خالی بودن با errRequiredFields جدا چک می‌شود
    if (!/^\d{10}$/.test(value)) return t.errNationalIdFormat;
    return null;
  }

  function handleNationalIdChange(raw: string) {
    const digits = digitsOnly(raw).slice(0, 10);
    setNationalId(digits);
    if (nationalIdError) setNationalIdError(validateNationalId(digits));
  }

  /** سه Selectِ شمسی → رشته‌ی ISO میلادی (UTC نیمه‌شب) برای بدنه‌ی درخواست. */
  function birthDateIso(): string | null {
    if (!birthJy || !birthJm || !birthJd) return null;
    const jy = Number(birthJy), jm = Number(birthJm), jd = Number(birthJd);
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    const d = new Date(Date.UTC(gy, gm - 1, gd));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!role) {
      setError(t.errRoleRequired);
      return;
    }

    const nationalIdErr = validateNationalId(nationalId.trim());
    if (nationalIdErr) {
      setNationalIdError(nationalIdErr);
      setError(nationalIdErr);
      return;
    }

    const isoBirthDate = birthDateIso();
    if (!nationalId.trim() || !isoBirthDate || !city.trim()) {
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
        birthDate: isoBirthDate,
        city: city.trim(),
        schoolNameFreeText: schoolNameFreeText.trim() || null,
        inviteCode: inviteCode.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "me"] });
      onDone(me);
    } catch (err: any) {
      // پیامِ واقعیِ سرور (وقتی موجود باشد) به‌جایِ همیشه یک رشته‌ی ثابت —
      // بندِ ۳ گزارشِ کاربر: قبلاً هرچه هم پیش می‌آمد فقط عنوانِ عمومی دیده
      // می‌شد چون description همیشه undefined بود.
      const serverMsg = typeof err?.data?.error === "string" ? err.data.error : undefined;
      toast({ variant: "destructive", title: t.onboardingError, description: serverMsg ?? err?.message });
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
                <Select value={grade} onValueChange={setGrade}>
                  <SelectTrigger id="school-grade">
                    <SelectValue placeholder={t.fieldGradePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADE_VALUES.map((g) => (
                      <SelectItem key={g} value={g}>
                        {fa ? `پایه ${toPersianDigits(g)}` : `Grade ${g}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldBirthDate}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Select value={birthJy} onValueChange={setBirthJy}>
                  <SelectTrigger aria-label={t.fieldBirthYear}>
                    <SelectValue placeholder={t.fieldBirthYear} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {birthYearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {fa ? toPersianDigits(String(y)) : y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={birthJm} onValueChange={setBirthJm}>
                  <SelectTrigger aria-label={t.fieldBirthMonth}>
                    <SelectValue placeholder={t.fieldBirthMonth} />
                  </SelectTrigger>
                  <SelectContent>
                    {JALALI_MONTH_NAMES_FA.map((name, idx) => (
                      <SelectItem key={name} value={String(idx + 1)}>
                        {fa ? name : `${idx + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={birthJd} onValueChange={setBirthJd}>
                  <SelectTrigger aria-label={t.fieldBirthDay}>
                    <SelectValue placeholder={t.fieldBirthDay} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {dayOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {fa ? toPersianDigits(String(d)) : d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldCity}</Label>
              <Popover open={cityPickerOpen} onOpenChange={setCityPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={cityPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className={cn(!city && "text-muted-foreground")}>
                      {city || t.fieldCityPlaceholder}
                    </span>
                    <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder={t.fieldCityPlaceholder} />
                    <CommandList>
                      <CommandEmpty>{t.fieldCityNotFound}</CommandEmpty>
                      <CommandGroup>
                        {IRAN_CITIES_FLAT.map((c) => (
                          <CommandItem
                            key={c}
                            value={c}
                            onSelect={() => { setCity(c); setCityPickerOpen(false); }}
                          >
                            <Check className={cn("me-2 h-4 w-4", city === c ? "opacity-100" : "opacity-0")} />
                            {c}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
              <Input
                id="school-national-id"
                value={nationalId}
                onChange={(e) => handleNationalIdChange(e.target.value)}
                onBlur={() => setNationalIdError(validateNationalId(nationalId.trim()))}
                inputMode="numeric"
                maxLength={10}
                dir="ltr"
                aria-invalid={Boolean(nationalIdError)}
              />
              {nationalIdError && <p className="text-xs text-destructive">{nationalIdError}</p>}
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
