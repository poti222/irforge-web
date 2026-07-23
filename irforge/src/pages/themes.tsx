import { useState } from "react";
import {
  useListThemes,
  useCreateTheme,
  useUpdateTheme,
  useDeleteTheme,
  useApplyTheme,
  getListThemesQueryKey,
} from "@workspace/api-client-react";
import type { Theme, ThemeInputMode } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Palette, Plus, Check, Trash2, Loader2, Pencil, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

type FormState = {
  id: string | null;
  name: string;
  mode: ThemeInputMode;
  primaryColor: string;
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
  borderRadius: string;
  fontFamily: string;
};

const NEW_THEME: FormState = {
  id: null,
  name: "",
  mode: "dark",
  primaryColor: "#f97316",
  backgroundColor: "#0b0b0d",
  foregroundColor: "#fafafa",
  accentColor: "#f59e0b",
  borderRadius: "0.5rem",
  fontFamily: "Inter",
};

// Y4: mock Telegram chat preview that recolors live from the form values.
function BotChatPreview({ form }: { form: FormState }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const bubble = (radius: string) => ({
    borderRadius: radius,
    transition: "background-color 200ms ease, color 200ms ease, border-radius 200ms ease",
  });
  return (
    <div
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{ backgroundColor: form.backgroundColor, color: form.foregroundColor, fontFamily: form.fontFamily }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 text-white"
        style={{ backgroundColor: form.primaryColor, transition: "background-color 200ms ease" }}
      >
        <div className="flex size-7 items-center justify-center rounded-full bg-white/25 text-sm font-bold">🤖</div>
        <span className="text-sm font-semibold">{fa ? "ربات نمونه" : "Sample Bot"}</span>
      </div>
      <div className="space-y-2 p-4" dir={fa ? "rtl" : "ltr"}>
        <div className="max-w-[75%] px-3 py-2 text-sm" style={{ ...bubble(form.borderRadius), backgroundColor: "rgba(127,127,127,0.18)" }}>
          {fa ? "سلام! چطور می‌تونم کمکت کنم؟" : "Hi! How can I help you?"}
        </div>
        <div className="ms-auto max-w-[75%] px-3 py-2 text-sm text-white" style={{ ...bubble(form.borderRadius), backgroundColor: form.primaryColor }}>
          {fa ? "قیمت پلن‌ها رو نشونم بده" : "Show me the plan prices"}
        </div>
        <button
          className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white"
          style={{ ...bubble(form.borderRadius), backgroundColor: form.accentColor }}
        >
          <Send className="size-3" /> {fa ? "مشاهده پلن‌ها" : "View plans"}
        </button>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" className="font-mono text-xs" />
      </div>
    </div>
  );
}

export default function Themes() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: themes, isLoading } = useListThemes();
  const createTheme = useCreateTheme();
  const updateTheme = useUpdateTheme();
  const deleteTheme = useDeleteTheme();
  const applyTheme = useApplyTheme();

  const [form, setForm] = useState<FormState>(NEW_THEME);
  const [deleting, setDeleting] = useState<Theme | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListThemesQueryKey() });
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function edit(theme: Theme) {
    setForm({
      id: theme.id,
      name: theme.name,
      mode: theme.mode,
      primaryColor: theme.primaryColor,
      backgroundColor: theme.backgroundColor || NEW_THEME.backgroundColor,
      foregroundColor: theme.foregroundColor || NEW_THEME.foregroundColor,
      accentColor: theme.accentColor || NEW_THEME.accentColor,
      borderRadius: theme.borderRadius || NEW_THEME.borderRadius,
      fontFamily: theme.fontFamily || NEW_THEME.fontFamily,
    });
  }

  function save() {
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: fa ? "نام تم الزامی است" : "Theme name is required" });
      return;
    }
    const data = {
      name: form.name.trim(),
      mode: form.mode,
      primaryColor: form.primaryColor,
      backgroundColor: form.backgroundColor,
      foregroundColor: form.foregroundColor,
      accentColor: form.accentColor,
      borderRadius: form.borderRadius,
      fontFamily: form.fontFamily,
    };
    const onError = (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    if (form.id) {
      updateTheme.mutate({ themeId: form.id, data }, {
        onSuccess: () => { invalidate(); toast({ title: fa ? "تم به‌روزرسانی شد" : "Theme updated" }); },
        onError,
      });
    } else {
      createTheme.mutate({ data }, {
        onSuccess: () => { invalidate(); setForm(NEW_THEME); toast({ title: fa ? "تم ساخته شد" : "Theme created" }); },
        onError,
      });
    }
  }

  function apply(theme: Theme) {
    applyTheme.mutate({ data: { themeId: theme.id } }, {
      onSuccess: () => { invalidate(); toast({ title: fa ? `تم «${theme.name}» اعمال شد` : `Applied “${theme.name}”` }); },
      onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message }),
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteTheme.mutate({ themeId: deleting.id }, {
      onSuccess: () => {
        invalidate();
        if (form.id === deleting.id) setForm(NEW_THEME);
        setDeleting(null);
        toast({ title: fa ? "تم حذف شد" : "Theme deleted" });
      },
      onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message }),
    });
  }

  const saving = createTheme.isPending || updateTheme.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{fa ? "سازنده تم" : "Theme Builder"}</h1>
          <p className="text-muted-foreground">
            {fa ? "تم اختصاصی ربات خود را بسازید و اعمال کنید." : "Design and apply custom themes for your bot."}
          </p>
        </div>
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setForm(NEW_THEME)}>
          <Plus className="me-2 h-4 w-4" /> {fa ? "تم جدید" : "New theme"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Theme list */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">{fa ? "تم‌های شما" : "Your themes"}</h3>
          {isLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />)}</div>
          ) : themes && themes.length > 0 ? (
            themes.map((theme) => (
              <Card key={theme.id} className={theme.isActive ? "border-primary" : ""}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {theme.name}
                    {theme.isActive && <Badge>{fa ? "فعال" : "active"}</Badge>}
                    {theme.isDefault && <Badge variant="secondary">{fa ? "پیش‌فرض" : "default"}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-1.5">
                    {[theme.primaryColor, theme.backgroundColor, theme.accentColor].filter(Boolean).map((c, i) => (
                      <span key={i} className="size-6 rounded-full border" style={{ backgroundColor: c || undefined }} />
                    ))}
                    <span className="ms-auto text-xs text-muted-foreground">{theme.mode}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant={theme.isActive ? "outline" : "default"} disabled={theme.isActive || applyTheme.isPending} onClick={() => apply(theme)}>
                      {applyTheme.isPending && applyTheme.variables?.data.themeId === theme.id
                        ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                        : <Check className="me-1 h-3.5 w-3.5" />}
                      {theme.isActive ? (fa ? "اعمال‌شده" : "Applied") : (fa ? "اعمال" : "Apply")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => edit(theme)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(theme)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-center">
              <Palette className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{fa ? "هنوز تمی نساخته‌اید." : "No themes yet."}</p>
            </div>
          )}
        </div>

        {/* Editor + live preview */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {form.id ? (fa ? "ویرایش تم" : "Edit theme") : (fa ? "تم جدید" : "New theme")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="theme-name">{fa ? "نام" : "Name"}</Label>
                <Input id="theme-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{fa ? "حالت" : "Mode"}</Label>
                <Select value={form.mode} onValueChange={(v) => set({ mode: v as ThemeInputMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">light</SelectItem>
                    <SelectItem value="dark">dark</SelectItem>
                    <SelectItem value="system">system</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ColorField label={fa ? "رنگ اصلی" : "Primary"} value={form.primaryColor} onChange={(v) => set({ primaryColor: v })} />
              <ColorField label={fa ? "پس‌زمینه" : "Background"} value={form.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
              <ColorField label={fa ? "متن" : "Foreground"} value={form.foregroundColor} onChange={(v) => set({ foregroundColor: v })} />
              <ColorField label={fa ? "تأکید" : "Accent"} value={form.accentColor} onChange={(v) => set({ accentColor: v })} />
              <div className="space-y-1.5">
                <Label htmlFor="theme-radius">{fa ? "گردی گوشه‌ها" : "Border radius"}</Label>
                <Input id="theme-radius" dir="ltr" value={form.borderRadius} onChange={(e) => set({ borderRadius: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="theme-font">{fa ? "فونت" : "Font family"}</Label>
                <Input id="theme-font" dir="ltr" value={form.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                  {form.id ? (fa ? "ذخیره تغییرات" : "Save changes") : (fa ? "ساخت تم" : "Create theme")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{fa ? "پیش‌نمایش زنده" : "Live preview"}</h3>
            <BotChatPreview form={form} />
          </div>
        </div>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف تم؟" : "Delete theme?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa ? `تم «${deleting?.name}» حذف می‌شود.` : `“${deleting?.name}” will be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTheme.isPending}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleteTheme.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteTheme.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
