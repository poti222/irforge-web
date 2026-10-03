import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Loader2, Pencil, Check, X } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

/**
 * components/admin/SuperSchoolsManager.tsx — `/super` بخشِ B (بندِ ۵):
 * نمایِ global همه‌یِ مدارس برایِ سوپرادمین — چیزی که قبلاً هیچ‌جایِ دیگری در
 * این پنل‌ها وجود نداشت (برخلافِ بات‌ها که AllBotsTable از قبل دارد).
 * ویرایش این‌جا PATCH /api/super/schools/:id را صدا می‌زند، نه مسیرِ
 * per-school عادیِ routes/schools.ts (که نیاز به عضویتِ مدیریتی دارد).
 */

interface SuperSchool {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  licenseInfo: string | null;
  isTestSchool: boolean;
  memberCount: number;
  createdAt: string;
}

export function SuperSchoolsManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; city: string; licenseInfo: string }>({ name: "", city: "", licenseInfo: "" });
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["super", "schools"],
    queryFn: () => customFetch<SuperSchool[]>("/api/super/schools", { credentials: "include" as any }),
  });

  function startEdit(s: SuperSchool) {
    setEditingId(s.id);
    setDraft({ name: s.name, city: s.city ?? "", licenseInfo: s.licenseInfo ?? "" });
  }

  async function save(id: string) {
    setSaving(true);
    try {
      await customFetch(`/api/super/schools/${id}`, {
        method: "PATCH",
        credentials: "include" as any,
        body: JSON.stringify({ name: draft.name, city: draft.city || null, licenseInfo: draft.licenseInfo || null }),
      });
      toast({ title: fa ? "ذخیره شد" : "Saved" });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["super", "schools"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{fa ? "همه‌یِ مدارس" : "All schools"}</h2>
          <RefreshButton queryKeys={[["super", "schools"]]} label={fa ? "به‌روزرسانی" : "Refresh"} />
        </div>
        {isLoading ? (
          <div className="flex h-20 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{fa ? "دریافت فهرست ممکن نشد." : "Couldn't load the list."}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{fa ? "هنوز مدرسه‌ای ساخته نشده." : "No schools yet."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fa ? "نام" : "Name"}</TableHead>
                <TableHead>{fa ? "شهر" : "City"}</TableHead>
                <TableHead>{fa ? "مجوز" : "License"}</TableHead>
                <TableHead>{fa ? "اعضا" : "Members"}</TableHead>
                <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  {editingId === s.id ? (
                    <>
                      <TableCell><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell><Input value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell><Input value={draft.licenseInfo} onChange={(e) => setDraft((d) => ({ ...d, licenseInfo: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell>{s.memberCount}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="size-8" disabled={saving} onClick={() => save(s.id)}>
                            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditingId(null)}><X className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>
                        <span className="flex items-center gap-1.5 font-medium">
                          {s.name}
                          {s.isTestSchool && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{fa ? "تست" : "Test"}</Badge>}
                        </span>
                      </TableCell>
                      <TableCell>{s.city ?? "—"}</TableCell>
                      <TableCell>{s.licenseInfo ?? "—"}</TableCell>
                      <TableCell>{s.memberCount}</TableCell>
                      <TableCell className="text-end">
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => startEdit(s)}><Pencil className="size-4" /></Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
