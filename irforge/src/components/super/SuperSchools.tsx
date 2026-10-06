import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Bot, ExternalLink, Loader2, Plus, Search, Settings2, UserPlus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { rememberViewedSchool } from "@/hooks/use-viewed-school";
import {
  SCHOOL_ADMIN_LINKS, SCHOOL_ROLE_LABELS, SCHOOL_ROLE_ORDER, SUPER_QUERY_ROOT, addSuperSchoolMember, createSuperSchool, listSuperSchools,
  updateSuperSchool, type SuperSchool,
} from "./superApi";

/**
 * components/super/SuperSchools.tsx — `/super` ← «مدارس»: مدیریتِ کاملِ همه‌یِ مدارس.
 *
 * فهرستِ غنی (اعضا به‌تفکیکِ نقش، کلاس‌ها، مدیران، باتِ مدرسه)، ساختِ مدرسه (با مدیرِ اختیاری)، ویرایش، افزودنِ عضو، و
 * «مدیریتِ کامل» که همان صفحاتِ /schools/admin/* (اعضا، کلاس‌ها، برنامه‌ها، اعلامیه‌ها، پیام‌ها، هشدارها، ردپا، کدهایِ معرف،
 * باتِ مدرسه) را رویِ مدرسه‌یِ انتخاب‌شده باز می‌کند — بدونِ عضویتِ سوپرادمین (api: `canAccessSchool` برایِ super_admin).
 * حذفِ مدرسه عمداً نیست: ده‌ها جدولِ دانش‌آموزی به آن وصل است و برگشت‌ناپذیر است.
 */

const KEY = [SUPER_QUERY_ROOT, "schools"] as const;

function errText(e: any, fallback: string): string {
  return e?.data?.error ?? e?.message ?? fallback;
}

function RoleChips({ roles, fa }: { roles: Record<string, number>; fa: boolean }) {
  const entries = SCHOOL_ROLE_ORDER.filter((r) => (roles[r] ?? 0) > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((r) => (
        <Badge key={r} variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
          {(fa ? SCHOOL_ROLE_LABELS[r].fa : SCHOOL_ROLE_LABELS[r].en)}: {roles[r]}
        </Badge>
      ))}
    </div>
  );
}

// ─── ساختِ مدرسه ────────────────────────────────────────────────────────────

function CreateSchoolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", city: "", address: "", licenseInfo: "", adminEmail: "", isTestSchool: false });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const create = useMutation({
    mutationFn: () => createSuperSchool({
      name: f.name.trim(), city: f.city.trim() || undefined, address: f.address.trim() || undefined,
      licenseInfo: f.licenseInfo.trim() || undefined, isTestSchool: f.isTestSchool, adminEmail: f.adminEmail.trim() || undefined,
    }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["schools", "my-schools"] });
      toast({ title: fa ? `مدرسه «${s.name}» ساخته شد` : `School “${s.name}” created` });
      setF({ name: "", city: "", address: "", licenseInfo: "", adminEmail: "", isTestSchool: false });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ variant: "destructive", title: fa ? "ساخت ممکن نشد" : "Couldn't create", description: errText(e, "") }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{fa ? "مدرسه‌یِ جدید" : "New school"}</DialogTitle>
          <DialogDescription>{fa ? "عضویتِ مدرسه‌ایِ خودِ شما تغییر نمی‌کند. مدیر اختیاری است؛ بعداً هم می‌شود اضافه کرد." : "Your own school membership isn't touched. The admin is optional; you can add one later."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="ss-name">{fa ? "نامِ مدرسه *" : "School name *"}</Label><Input id="ss-name" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="ss-city">{fa ? "شهر" : "City"}</Label><Input id="ss-city" value={f.city} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ss-addr">{fa ? "آدرس" : "Address"}</Label><Input id="ss-addr" value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="ss-lic">{fa ? "اطلاعاتِ مجوز" : "License info"}</Label><Input id="ss-lic" value={f.licenseInfo} onChange={(e) => set("licenseInfo", e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="ss-admin">{fa ? "ایمیلِ مدیرِ مدرسه (اختیاری)" : "School admin email (optional)"}</Label>
            <Input id="ss-admin" dir="ltr" value={f.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} placeholder="admin@example.com" />
            <p className="text-xs text-muted-foreground">{fa ? "کاربر باید از قبل در پلتفرم ثبت‌نام کرده باشد." : "The user must already have a platform account."}</p>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="ss-test">{fa ? "مدرسه‌یِ آزمایشی" : "Test school"}</Label>
            <Switch id="ss-test" checked={f.isTestSchool} onCheckedChange={(v) => set("isTestSchool", v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{fa ? "انصراف" : "Cancel"}</Button>
          <Button disabled={create.isPending || !f.name.trim()} onClick={() => create.mutate()} data-testid="ss-create-submit">
            {create.isPending && <Loader2 className="me-1.5 size-4 animate-spin" />}{fa ? "ساختن" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── مدیریتِ یک مدرسه ───────────────────────────────────────────────────────

function SchoolDialog({ school, onClose }: { school: SuperSchool; onClose: () => void }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState({
    name: school.name, city: school.city ?? "", address: school.address ?? "", licenseInfo: school.licenseInfo ?? "", isTestSchool: school.isTestSchool,
  });
  const [member, setMember] = useState({ email: "", role: "teacher" });
  const [conflict, setConflict] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => updateSuperSchool(school.id, {
      name: draft.name.trim(), city: draft.city.trim() || null, address: draft.address.trim() || null,
      licenseInfo: draft.licenseInfo.trim() || null, isTestSchool: draft.isTestSchool,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["schools", "my-schools"] }); toast({ title: fa ? "ذخیره شد" : "Saved" }); },
    onError: (e: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: errText(e, "") }),
  });

  const addMember = useMutation({
    mutationFn: (move: boolean) => addSuperSchoolMember(school.id, { email: member.email.trim(), role: member.role, move }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: KEY });
      setConflict(null);
      setMember((m) => ({ ...m, email: "" }));
      toast({ title: r.result === "created" ? (fa ? "عضو اضافه شد" : "Member added") : r.result === "moved" ? (fa ? "عضو منتقل شد" : "Member moved") : (fa ? "نقشِ عضو به‌روز شد" : "Member role updated"),
        description: fa ? "کاربر پروفایلِ مدرسه‌ایِ خودش (کدملی/پایه…) را در اولین ورود کامل می‌کند." : "The user completes their school profile on first visit." });
    },
    onError: (e: any) => {
      if (e?.data?.code === "already_member_elsewhere") setConflict(errText(e, ""));
      else toast({ variant: "destructive", title: fa ? "افزودن ممکن نشد" : "Couldn't add", description: errText(e, "") });
    },
  });

  function openAdmin(path: string) {
    rememberViewedSchool(school.id);
    onClose();
    navigate(path);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="super-school-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{school.name}{school.isTestSchool && <Badge variant="secondary">{fa ? "تست" : "Test"}</Badge>}</DialogTitle>
          <DialogDescription>
            {fa ? `${school.memberCount} عضو · ${school.classCount} کلاس · ${school.adminCount} مدیر` : `${school.memberCount} members · ${school.classCount} classes · ${school.adminCount} admins`}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="manage" className="space-y-3">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="manage"><ExternalLink className="me-1.5 size-4" />{fa ? "مدیریتِ کامل" : "Full management"}</TabsTrigger>
            <TabsTrigger value="edit"><Settings2 className="me-1.5 size-4" />{fa ? "ویرایش" : "Edit"}</TabsTrigger>
            <TabsTrigger value="member"><UserPlus className="me-1.5 size-4" />{fa ? "افزودنِ عضو" : "Add member"}</TabsTrigger>
          </TabsList>

          <TabsContent value="manage" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {fa ? "این‌ها همان صفحاتِ مدیرِ مدرسه‌اند، رویِ همین مدرسه و با دسترسیِ کاملِ سوپرادمین باز می‌شوند."
                : "These are the school admin's own pages, opened on this school with full super-admin access."}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCHOOL_ADMIN_LINKS.map((l) => (
                <Button key={l.path} variant="outline" className="h-auto justify-start whitespace-normal py-2 text-start" onClick={() => openAdmin(l.path)} data-testid={`ss-open-${l.path}`}>
                  <ExternalLink className="me-2 size-4 shrink-0" />{fa ? l.fa : l.en}
                </Button>
              ))}
            </div>
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">{fa ? "مدیران" : "Admins"}</p>
              {school.admins.length === 0 ? <p>{fa ? "هنوز مدیری ندارد — از «افزودنِ عضو» نقشِ «مدیر» بدهید." : "No admin yet — add a member with the “Admin” role."}</p>
                : <ul className="space-y-0.5">{school.admins.map((a) => <li key={a.userId}>{a.name}{a.email ? <span dir="ltr" className="ms-2">{a.email}</span> : null}</li>)}</ul>}
              <p className="mt-2">{fa ? "باتِ مدرسه:" : "School bot:"} {school.bot ? <span dir="ltr">{school.bot.telegramUsername ? `@${school.bot.telegramUsername}` : (fa ? "متصل" : "connected")}</span> : (fa ? "ندارد (از «استخر بات مدرسه» اختصاص می‌یابد)" : "none (assigned from the school bot pool)")}</p>
            </div>
          </TabsContent>

          <TabsContent value="edit" className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="se-name">{fa ? "نام" : "Name"}</Label><Input id="se-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="se-city">{fa ? "شهر" : "City"}</Label><Input id="se-city" value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="se-addr">{fa ? "آدرس" : "Address"}</Label><Input id="se-addr" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="se-lic">{fa ? "اطلاعاتِ مجوز" : "License info"}</Label><Input id="se-lic" value={draft.licenseInfo} onChange={(e) => setDraft((d) => ({ ...d, licenseInfo: e.target.value }))} /></div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="se-test">{fa ? "مدرسه‌یِ آزمایشی" : "Test school"}</Label>
              <Switch id="se-test" checked={draft.isTestSchool} onCheckedChange={(v) => setDraft((d) => ({ ...d, isTestSchool: v }))} />
            </div>
            <Button disabled={save.isPending || !draft.name.trim()} onClick={() => save.mutate()} data-testid="se-save">
              {save.isPending && <Loader2 className="me-1.5 size-4 animate-spin" />}{fa ? "ذخیره" : "Save"}
            </Button>
          </TabsContent>

          <TabsContent value="member" className="space-y-3">
            <p className="text-sm text-muted-foreground">{fa ? "یک کاربرِ موجودِ پلتفرم را با ایمیل و نقش به این مدرسه اضافه کنید." : "Add an existing platform user to this school by email and role."}</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <div className="space-y-1.5"><Label htmlFor="sm-email">{fa ? "ایمیلِ کاربر" : "User email"}</Label><Input id="sm-email" dir="ltr" value={member.email} onChange={(e) => { setConflict(null); setMember((m) => ({ ...m, email: e.target.value })); }} placeholder="user@example.com" /></div>
              <div className="space-y-1.5">
                <Label>{fa ? "نقش" : "Role"}</Label>
                <Select value={member.role} onValueChange={(v) => setMember((m) => ({ ...m, role: v }))}>
                  <SelectTrigger data-testid="sm-role"><SelectValue /></SelectTrigger>
                  <SelectContent>{SCHOOL_ROLE_ORDER.map((r) => <SelectItem key={r} value={r}>{fa ? SCHOOL_ROLE_LABELS[r].fa : SCHOOL_ROLE_LABELS[r].en}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {conflict && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert" data-testid="sm-conflict">
                <p>{conflict}</p>
                <Button size="sm" variant="outline" disabled={addMember.isPending} onClick={() => addMember.mutate(true)} data-testid="sm-move">
                  {fa ? "بله، منتقل کن" : "Yes, move them"}
                </Button>
              </div>
            )}
            <Button disabled={addMember.isPending || !member.email.trim()} onClick={() => addMember.mutate(false)} data-testid="sm-submit">
              {addMember.isPending && <Loader2 className="me-1.5 size-4 animate-spin" />}{fa ? "افزودن" : "Add"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── فهرست ──────────────────────────────────────────────────────────────────

export function SuperSchools() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "real" | "test">("all");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: listSuperSchools });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((s) => {
      if (kind === "real" && s.isTestSchool) return false;
      if (kind === "test" && !s.isTestSchool) return false;
      if (!needle) return true;
      return [s.name, s.city ?? "", s.address ?? "", ...s.admins.map((a) => `${a.name} ${a.email ?? ""}`)].join(" ").toLowerCase().includes(needle);
    });
  }, [data, q, kind]);
  const open = (data ?? []).find((s) => s.id === openId) ?? null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-base font-semibold">{fa ? "همه‌یِ مدارس" : "All schools"}{data ? <span className="ms-2 text-sm font-normal text-muted-foreground">({data.length})</span> : null}</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fa ? "جست‌وجو: نام، شهر، مدیر…" : "Search: name, city, admin…"} className="h-9 w-56 ps-8" data-testid="ss-search" />
          </div>
          <Select value={kind} onValueChange={(v) => setKind(v as any)}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{fa ? "همه" : "All"}</SelectItem>
              <SelectItem value="real">{fa ? "واقعی" : "Real"}</SelectItem>
              <SelectItem value="test">{fa ? "آزمایشی" : "Test"}</SelectItem>
            </SelectContent>
          </Select>
          <RefreshButton queryKeys={[[...KEY]]} label={fa ? "به‌روزرسانی" : "Refresh"} />
          <Button size="sm" onClick={() => setCreating(true)} data-testid="ss-new"><Plus className="me-1.5 size-4" />{fa ? "مدرسه‌یِ جدید" : "New school"}</Button>
        </div>

        {isLoading ? (
          <div className="flex h-20 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">{fa ? "دریافتِ فهرست ممکن نشد." : "Couldn't load the list."} {errText(error, "")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{(data?.length ?? 0) === 0 ? (fa ? "هنوز مدرسه‌ای ساخته نشده." : "No schools yet.") : (fa ? "موردی پیدا نشد." : "No match.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fa ? "مدرسه" : "School"}</TableHead>
                  <TableHead>{fa ? "اعضا" : "Members"}</TableHead>
                  <TableHead>{fa ? "کلاس" : "Classes"}</TableHead>
                  <TableHead>{fa ? "مدیران" : "Admins"}</TableHead>
                  <TableHead>{fa ? "بات" : "Bot"}</TableHead>
                  <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id} data-testid={`ss-row-${s.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">{s.name}{s.isTestSchool && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{fa ? "تست" : "Test"}</Badge>}</div>
                      <div className="text-xs text-muted-foreground">{[s.city, new Date(s.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell><div className="space-y-1"><span className="font-medium">{s.memberCount}</span><RoleChips roles={s.roles} fa={fa} /></div></TableCell>
                    <TableCell>{s.classCount}</TableCell>
                    <TableCell className="max-w-48 text-xs">{s.admins.length ? s.admins.map((a) => a.name).join("، ") : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{s.bot ? <span className="inline-flex items-center gap-1" dir="ltr"><Bot className="size-3.5" />{s.bot.telegramUsername ? `@${s.bot.telegramUsername}` : "✓"}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-end">
                      <Button size="sm" onClick={() => setOpenId(s.id)} data-testid={`ss-manage-${s.id}`}>{fa ? "مدیریت" : "Manage"}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {creating && <CreateSchoolDialog open onOpenChange={setCreating} />}
      {open && <SchoolDialog key={open.id} school={open} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
