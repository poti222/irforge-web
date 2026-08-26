/**
 * SupportLinksSettings.tsx — کانال آموزشی/اینستاگرام + لیستِ لینک‌های آموزشی.
 *
 * تا امروز این‌ها در `src/config/support.ts` hardcode بودند، با یک کامنت
 * TODO صریح که می‌گفت باید از یک پنل تنظیماتِ سوپرادمین بیایند. این همان پنل
 * است. مقدارها در جدول `platform_settings` (کلید `support_links`) ذخیره
 * می‌شوند و اگر خالی باشند، سرور به همان مقدارهای پیش‌فرضِ قدیمی برمی‌گردد —
 * ببینید api-server/src/lib/platformSettings.ts.
 *
 * `tutorialLinks` یک لیست است، نه یک فیلد ثابت: سوپرادمین می‌تواند چند لینکِ
 * نام‌دار (مثلاً «شروع کار»، «اتصال درگاه پرداخت») اضافه/حذف/ویرایش کند. همین
 * لیست به‌شکل یک کالاوت زرد در فضای کاری بات نمایش داده می‌شود
 * (TutorialLinksCallout.tsx).
 */
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2, Save, GraduationCap, Instagram } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { SUPPORT_LINKS_QUERY_KEY, type SupportLinksSettings, type TutorialLink } from "@/config/support";

export const ADMIN_SUPPORT_LINKS_KEY = ["admin-support-links"] as const;

/** کلید موقتِ سمت-کلاینت برای یک ردیفِ تازه که هنوز id واقعی نگرفته. */
function draftId(): string {
  return `draft_${Math.random().toString(36).slice(2)}`;
}

export function SupportLinksSettings() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ADMIN_SUPPORT_LINKS_KEY,
    queryFn: () => customFetch<SupportLinksSettings>("/api/admin/support-links"),
  });

  const [draft, setDraft] = useState<SupportLinksSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  if (!draft) {
    return <div className="h-64 animate-pulse rounded-md bg-muted" />;
  }

  function patch(fields: Partial<SupportLinksSettings>) {
    setDraft((d) => (d ? { ...d, ...fields } : d));
  }

  function patchLink(id: string, fields: Partial<TutorialLink>) {
    setDraft((d) =>
      d ? { ...d, tutorialLinks: d.tutorialLinks.map((l) => (l.id === id ? { ...l, ...fields } : l)) } : d,
    );
  }

  function addLink() {
    setDraft((d) =>
      d ? { ...d, tutorialLinks: [...d.tutorialLinks, { id: draftId(), label: "", url: "" }] } : d,
    );
  }

  function removeLink(id: string) {
    setDraft((d) => (d ? { ...d, tutorialLinks: d.tutorialLinks.filter((l) => l.id !== id) } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await customFetch<SupportLinksSettings>("/api/admin/support-links", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDraft(saved);
      queryClient.invalidateQueries({ queryKey: ADMIN_SUPPORT_LINKS_KEY });
      // بازدیدکننده‌های فعلی سایت (فوتر، صفحه‌ی پشتیبانی، مقاله‌های آموزشی)
      // بدون رفرش، مقدار تازه را ببینند.
      queryClient.invalidateQueries({ queryKey: SUPPORT_LINKS_QUERY_KEY });
      toast({ title: fa ? "لینک‌های پشتیبانی ذخیره شد" : "Support links saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const invalidLinks = draft.tutorialLinks.some((l) => !l.label.trim() || !l.url.trim());

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{fa ? "لینک‌های آموزشی و پشتیبانی" : "Support & tutorial links"}</CardTitle>
        <CardDescription>
          {fa
            ? "کانال آموزشی، اینستاگرام و لیستِ لینک‌های آموزشیِ نام‌دار که در فوتر، صفحه‌ی پشتیبانی، مقاله‌های آموزشی و فضای کاری بات نمایش داده می‌شوند."
            : "The education channel, Instagram, and named tutorial links shown in the footer, the support page, learn articles, and the bot workspace."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">{fa ? "کانال آموزشی" : "Education channel"}</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edu-url">{fa ? "آدرس کانال" : "Channel URL"}</Label>
              <Input
                id="edu-url" dir="ltr" placeholder="https://t.me/..."
                value={draft.educationChannelUrl}
                onChange={(e) => patch({ educationChannelUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edu-handle">{fa ? "نام نمایشی" : "Display handle"}</Label>
              <Input
                id="edu-handle" dir="ltr" placeholder="@channel"
                value={draft.educationChannelHandle}
                onChange={(e) => patch({ educationChannelHandle: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <Instagram className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">{fa ? "اینستاگرام" : "Instagram"}</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ig-url">{fa ? "آدرس صفحه" : "Profile URL"}</Label>
              <Input
                id="ig-url" dir="ltr" placeholder="https://instagram.com/..."
                value={draft.instagramUrl}
                onChange={(e) => patch({ instagramUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ig-handle">{fa ? "نام نمایشی" : "Display handle"}</Label>
              <Input
                id="ig-handle" dir="ltr" placeholder="@handle"
                value={draft.instagramHandle}
                onChange={(e) => patch({ instagramHandle: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t pt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{fa ? "لینک‌های آموزشیِ نام‌دار" : "Named tutorial links"}</h4>
            <Button type="button" variant="outline" size="sm" onClick={addLink} className="gap-1.5">
              <Plus className="size-3.5" /> {fa ? "افزودن لینک" : "Add link"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {fa
              ? "این لیست در فضای کاری بات به‌شکل یک کادر زرد نمایش داده می‌شود."
              : "This list is shown in the bot workspace as a yellow callout."}
          </p>

          {draft.tutorialLinks.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {fa ? "هنوز لینکی اضافه نشده." : "No links added yet."}
            </p>
          )}

          <div className="space-y-3">
            {draft.tutorialLinks.map((link) => (
              <div key={link.id} className="flex items-start gap-2 rounded-lg border p-3">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`link-label-${link.id}`} className="text-xs">{fa ? "عنوان" : "Label"}</Label>
                    <Input
                      id={`link-label-${link.id}`}
                      placeholder={fa ? "مثلاً «شروع کار»" : "e.g. \"Getting started\""}
                      value={link.label}
                      onChange={(e) => patchLink(link.id, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`link-url-${link.id}`} className="text-xs">{fa ? "آدرس" : "URL"}</Label>
                    <Input
                      id={`link-url-${link.id}`} dir="ltr" placeholder="https://..."
                      value={link.url}
                      onChange={(e) => patchLink(link.id, { url: e.target.value })}
                    />
                  </div>
                </div>
                <Button
                  type="button" variant="ghost" size="icon"
                  className="mt-5 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removeLink(link.id)}
                  aria-label={fa ? "حذف" : "Remove"}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          {invalidLinks && (
            <p className="text-xs text-amber-500">
              {fa
                ? "لینک‌های ناقص (بدون عنوان یا آدرس) موقع ذخیره نادیده گرفته می‌شوند."
                : "Incomplete links (missing a label or URL) are dropped on save."}
            </p>
          )}
        </section>

        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {fa ? "ذخیره" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
