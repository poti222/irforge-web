/**
 * FilesSection.tsx — کتابخانه‌ی فایل‌ها (پلاگین `files`).
 * هر «فایل» = یک لینک مستقیم تلگرام که چند پیام را تحویل می‌دهد.
 *
 * جریان: «فایل جدید» → بات به ادمین‌ها می‌نویسد → ادمین در بات پیام‌ها را می‌فرستد و
 * «تمام شد» می‌زند → برمی‌گردد اینجا؛ فایل با تعداد پیام‌ها ظاهر شده و اسم/دکمه‌ها
 * را تنظیم می‌کند. API: `api-server/src/routes/files.ts`.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { FolderOpen, Loader2, Plus, Trash2, Pencil, Copy, Link2, Send, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

type LinkButton = { label: string; url: string };
type Bundle = {
  id: string;
  title: string;
  description: string;
  status: "collecting" | "ready";
  is_active: boolean;
  item_count: number;
  downloads: number;
  ttl: number;
  protect: boolean;
  buttons: LinkButton[];
  legacy: boolean;
};

const TEXTS = {
  fa: {
    title: "کتابخانه‌ی فایل‌ها",
    intro: "هر فایل یک لینک مستقیم است که چند پیام (هر نوعی) را برای کاربر می‌فرستد. «فایل جدید» را بزنید، در بات فایل‌ها را بفرستید و «تمام شد» را بزنید.",
    newFile: "فایل جدید",
    started: "به ادمین‌های بات پیام داده شد",
    startedDesc: "در تلگرام به بات فایل‌هایتان را بفرستید (فوروارد هم قبول است) و «✅ تمام شد» را بزنید؛ بعد برگردید اینجا.",
    collecting: "در حال دریافت از بات…",
    collectingHint: "در بات فایل‌ها را بفرستید و «✅ تمام شد» را بزنید. بعد از آن این کارت خودکار کامل می‌شود.",
    resend: "ارسال دوباره‌ی پیام به بات",
    resent: "پیام دوباره ارسال شد",
    cancel: "لغو",
    ready: "فعال",
    inactive: "غیرفعال",
    messages: "پیام",
    downloads: "دریافت",
    copyLink: "کپی لینک",
    copied: "لینک کپی شد",
    edit: "ویرایش",
    del: "حذف",
    delConfirm: "این فایل و لینکش حذف شود؟",
    empty: "هنوز فایلی ندارید.",
    imported: (n: number, name: string) => `${n} پیام وارد شد: ${name}`,
    name: "اسم فایل",
    desc: "توضیح (اختیاری)",
    buttons: "دکمه‌های زیر پیام (لینک)",
    addButton: "افزودن دکمه",
    btnLabel: "متن دکمه",
    btnUrl: "https://…",
    ttl: "حذف خودکار از چت کاربر (ثانیه، ۰ = هرگز)",
    protect: "ضد فوروارد و ذخیره",
    active: "فعال",
    save: "ذخیره",
    saved: "ذخیره شد",
    close: "بستن",
    err: "خطا",
    legacy: "تک‌فایل (قدیمی)",
    noBot: "یوزرنیم بات هنوز مشخص نیست؛ لینک کامل نمی‌شود.",
  },
  en: {
    title: "Files library",
    intro: "Each file is a direct link that delivers several messages (any type). Press “New file”, send your files to the bot, then press “Done”.",
    newFile: "New file",
    started: "The bot messaged your admins",
    startedDesc: "In Telegram, send your files to the bot (forwards are fine) and press “✅ Done”, then come back here.",
    collecting: "Collecting from the bot…",
    collectingHint: "Send the files in the bot and press “✅ Done”. This card completes itself afterwards.",
    resend: "Resend the prompt",
    resent: "Prompt sent again",
    cancel: "Cancel",
    ready: "Active",
    inactive: "Inactive",
    messages: "messages",
    downloads: "downloads",
    copyLink: "Copy link",
    copied: "Link copied",
    edit: "Edit",
    del: "Delete",
    delConfirm: "Delete this file and its link?",
    empty: "No files yet.",
    imported: (n: number, name: string) => `${n} messages imported: ${name}`,
    name: "File name",
    desc: "Description (optional)",
    buttons: "Link buttons under the message",
    addButton: "Add button",
    btnLabel: "Button text",
    btnUrl: "https://…",
    ttl: "Auto-delete from the user's chat (seconds, 0 = never)",
    protect: "Block forwarding & saving",
    active: "Active",
    save: "Save",
    saved: "Saved",
    close: "Close",
    err: "Error",
    legacy: "Single file (legacy)",
    noBot: "The bot's username isn't known yet; the link can't be completed.",
  },
} as const;

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

export function FilesSection({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const t = (lang === "fa" ? TEXTS.fa : TEXTS.en) as typeof TEXTS.fa;
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-files", bot.id];
  const base = `/api/bots/${bot.id}/files/bundles`;
  const [editing, setEditing] = useState<Bundle | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ bundles: Bundle[] }>(base),
    // تا وقتی فایلی در حال دریافت است، هر چند ثانیه تازه شود تا «تمام شد» خودکار دیده شود.
    refetchInterval: (q) => ((q.state.data as any)?.bundles?.some((b: Bundle) => b.status === "collecting") ? 3000 : false),
  });
  const bundles = data?.bundles ?? [];

  // وقتی فایلی از «در حال دریافت» به «آماده» رسید، تعداد پیام‌های واردشده را اعلام کن.
  const prevStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const b of bundles) {
      if (prevStatus.current[b.id] === "collecting" && b.status === "ready") {
        toast({ title: t.imported(b.item_count, b.title) });
      }
    }
    prevStatus.current = Object.fromEntries(bundles.map((b) => [b.id, b.status]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const fail = (err: any) => toast({ variant: "destructive", title: t.err, description: errMessage(err, t.err) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () =>
      customFetch(base, { method: "POST", body: JSON.stringify({ returnUrl: window.location.href }) }),
    onSuccess: () => { toast({ title: t.started, description: t.startedDesc }); refresh(); },
    onError: fail,
  });
  const resend = useMutation({
    mutationFn: (id: string) => customFetch(`${base}/${id}/resend`, { method: "POST" }),
    onSuccess: () => toast({ title: t.resent }),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`${base}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (b: Bundle) => customFetch(`${base}/${b.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !b.is_active }) }),
    onSuccess: refresh,
    onError: fail,
  });

  const linkOf = (b: Bundle) => (bot.username ? `https://t.me/${bot.username.replace(/^@/, "")}?start=${b.id}` : "");
  const copyLink = (b: Bundle) => {
    const link = linkOf(b);
    if (!link) { toast({ variant: "destructive", title: t.noBot }); return; }
    void navigator.clipboard?.writeText(link).then(() => toast({ title: t.copied })).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-2xl">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><FolderOpen className="size-5" /> {t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.intro}</p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="files-new">
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t.newFile}
        </Button>
      </div>

      {isLoading && <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>}
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">{errMessage(error, t.err)}</div>}
      {!isLoading && !error && bundles.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t.empty}</p>}

      <div className="grid gap-3">
        {bundles.map((b) => (
          <Card key={b.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium">{b.title || "—"}</span>
                  {b.status === "collecting" ? (
                    <Badge variant="secondary" className="gap-1"><Loader2 className="size-3 animate-spin" /> {t.collecting}</Badge>
                  ) : (
                    <Badge variant={b.is_active ? "default" : "outline"}>{b.is_active ? t.ready : t.inactive}</Badge>
                  )}
                  {b.legacy && <Badge variant="outline">{t.legacy}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{b.item_count} {t.messages}</span>
                  <span className="flex items-center gap-1"><Download className="size-3" /> {b.downloads} {t.downloads}</span>
                </div>
              </div>

              {b.status === "collecting" ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t.collectingHint}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => resend.mutate(b.id)} disabled={resend.isPending}>
                      <Send className="size-4" /> {t.resend}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(b.id)}>
                      <X className="size-4" /> {t.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs" dir="ltr">
                    <Link2 className="size-3.5 shrink-0" />
                    <span className="truncate">{linkOf(b) || b.id}</span>
                    <Button size="sm" variant="ghost" className="ms-auto h-6 px-2" onClick={() => copyLink(b)}>
                      <Copy className="size-3.5" /> {t.copyLink}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={b.is_active} onCheckedChange={() => toggle.mutate(b)} /> {t.active}
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(b)}><Pencil className="size-4" /> {t.edit}</Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => { if (window.confirm(t.delConfirm)) remove.mutate(b.id); }}
                      >
                        <Trash2 className="size-4" /> {t.del}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <EditDialog
          key={editing.id}
          t={t}
          bundle={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            try {
              await customFetch(`${base}/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
              toast({ title: t.saved });
              setEditing(null);
              refresh();
            } catch (err) {
              fail(err);
            }
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  t, bundle, onClose, onSave,
}: {
  t: typeof TEXTS.fa;
  bundle: Bundle;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description);
  const [ttl, setTtl] = useState(String(bundle.ttl));
  const [protect, setProtect] = useState(bundle.protect);
  const [buttons, setButtons] = useState<LinkButton[]>(bundle.buttons);
  const [saving, setSaving] = useState(false);

  const setButton = (i: number, patch: Partial<LinkButton>) =>
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t.edit}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t.name}</Label>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t.desc}</Label>
            <Textarea value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t.buttons}</Label>
            {buttons.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder={t.btnLabel} value={b.label} maxLength={60} onChange={(e) => setButton(i, { label: e.target.value })} />
                <Input dir="ltr" placeholder={t.btnUrl} value={b.url} onChange={(e) => setButton(i, { url: e.target.value })} />
                <Button size="icon" variant="ghost" onClick={() => setButtons((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {buttons.length < 8 && (
              <Button size="sm" variant="outline" onClick={() => setButtons((prev) => [...prev, { label: "", url: "" }])}>
                <Plus className="size-4" /> {t.addButton}
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t.ttl}</Label>
            <Input type="number" min={0} max={3600} value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={protect} onCheckedChange={setProtect} /> {t.protect}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t.close}</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave({ title, description, ttl: Number(ttl) || 0, protect, buttons });
              setSaving(false);
            }}
          >
            {saving && <Loader2 className="size-4 animate-spin" />} {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
