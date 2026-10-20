import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Plus, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useEmojiContext, customEmojiQueryKey } from "./emoji-context";
import {
  EMOJI_NAME_RE, addLibraryPack, emojiToken, importEmojiIds, importEmojiPacks, listEmojiLibrary, saveCustomEmojis, type CustomEmoji,
} from "@/lib/custom-emoji";

/**
 * مدیریتِ ایموجیِ سفارشی/متحرک: افزودن با پک (t.me/addemoji/…) یا شناسه، فعال/غیرفعال‌کردنِ دسته‌جمعی،
 * تغییرِ نامِ توکن، حذف. فقط ایموجی‌هایِ فعال در انتخابگرِ همه‌یِ متن‌ها دیده می‌شوند.
 */
export function CustomEmojiManager() {
  const ctx = useEmojiContext();
  const { toast } = useToast();
  const qc = useQueryClient();
  const botId = ctx?.botId ?? "";
  const server = ctx?.emojis ?? [];

  const [draft, setDraft] = useState<CustomEmoji[] | null>(null);
  const list = draft ?? server;
  const dirty = draft !== null;
  const [packs, setPacks] = useState("");
  const [ids, setIds] = useState("");
  const [q, setQ] = useState("");

  const refresh = (emojis: CustomEmoji[]) => {
    qc.setQueryData(customEmojiQueryKey(botId), { emojis });
    setDraft(null);
  };
  const fail = (err: any) => toast({ variant: "destructive", title: "خطا", description: err?.message ?? "عملیات ناموفق بود" });

  const save = useMutation({
    mutationFn: () => saveCustomEmojis(botId, list),
    onSuccess: (r) => { refresh(r.emojis); toast({ title: "ذخیره شد" }); },
    onError: fail,
  });
  const importPack = useMutation({
    mutationFn: () => importEmojiPacks(botId, packs.split(/[\s,\n]+/).filter(Boolean)),
    onSuccess: (r) => {
      refresh(r.emojis);
      setPacks("");
      const ok = r.report.filter((x) => !x.error);
      const errs = r.report.filter((x) => x.error);
      toast({
        title: `${ok.reduce((n, x) => n + x.added, 0)} ایموجی اضافه شد`,
        description: errs.length ? errs.map((e) => `${e.pack}: ${e.error}`).join(" — ") : undefined,
        variant: errs.length && !ok.length ? "destructive" : undefined,
      });
    },
    onError: fail,
  });
  const importIds = useMutation({
    mutationFn: () => importEmojiIds(botId, ids.split(/[\s,\n]+/).filter(Boolean)),
    onSuccess: (r) => { refresh(r.emojis); setIds(""); toast({ title: "شناسه‌ها اضافه شد" }); },
    onError: fail,
  });

  const library = useQuery({ queryKey: ["emoji-library"], queryFn: listEmojiLibrary, staleTime: 60_000 });
  const addPack = useMutation({
    mutationFn: (slug: string) => addLibraryPack(botId, slug),
    onSuccess: (r) => {
      refresh(r.emojis);
      toast({ title: r.added > 0 ? `${r.added} ایموجی اضافه شد` : "همه‌یِ این پک از قبل در فهرست هست" });
    },
    onError: fail,
  });
  const edit = (fn: (l: CustomEmoji[]) => CustomEmoji[]) => setDraft(fn(list));
  // بر اساسِ `id` (یکتا)، نه `name`: وقتی دو ردیف نامِ یکسان دارند (دقیقاً حالتی که باید اصلاح شود) تغییرِ یکی نباید روی دیگری هم اعمال شود.
  const patch = (id: string, p: Partial<CustomEmoji>) => edit((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? list.filter((e) => e.name.includes(s) || e.pack.toLowerCase().includes(s) || e.fallback.includes(s)) : list;
  }, [list, q]);

  const nameClash = (e: CustomEmoji) => list.filter((x) => x.name === e.name).length > 1;
  const invalid = list.some((e) => !EMOJI_NAME_RE.test(e.name) || nameClash(e));
  const enabledCount = list.filter((e) => e.enabled).length;
  const setAll = (enabled: boolean) => edit((l) => l.map((e) => (shown.some((s) => s.id === e.id) ? { ...e, enabled } : e)));

  if (!ctx) return null;

  return (
    <div className="space-y-4" dir="rtl" data-testid="custom-emoji-manager">
      {library.data && library.data.packs.length > 0 && (
        <Card data-testid="emoji-library">
          <CardHeader className="space-y-1.5">
            <CardTitle>پک‌هایِ آماده</CardTitle>
            <CardDescription className="leading-7">با یک کلیک پک را به همین ربات اضافه کنید؛ بعد از ذخیره‌یِ فهرست در همه‌یِ متن‌ها قابل‌استفاده است.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {library.data.packs.map((p) => {
              const have = p.preview.length > 0 && p.preview.every((x) => list.some((e) => e.id === x.id));
              return (
                <div key={p.slug} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{p.title}</span>
                      <Badge variant={p.free ? "secondary" : "outline"}>{p.free ? "رایگان" : `${p.priceToman.toLocaleString("fa-IR")} تومان`}</Badge>
                      {p.animated && <Badge variant="outline">متحرک</Badge>}
                    </div>
                    <p className="truncate text-lg leading-none">{p.preview.map((x) => x.emoji).join(" ")}</p>
                    <p className="text-xs text-muted-foreground">{p.count.toLocaleString("fa-IR")} ایموجی</p>
                  </div>
                  <Button size="sm" variant={have ? "outline" : "default"} disabled={dirty || !p.free || addPack.isPending} onClick={() => addPack.mutate(p.slug)} title={dirty ? "ابتدا تغییراتِ فهرست را ذخیره یا لغو کنید" : !p.free ? "خریدِ پک هنوز فعال نشده" : undefined}>
                    {addPack.isPending && addPack.variables === p.slug ? <Loader2 className="me-1.5 size-4 animate-spin" /> : have ? <Check className="me-1.5 size-4" /> : <Plus className="me-1.5 size-4" />}
                    {have ? "اضافه شده" : "افزودن"}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="space-y-1.5">
          <CardTitle>ایموجی‌هایِ متحرک</CardTitle>
          <CardDescription className="leading-7">
            ایموجی‌ها را اضافه و فعال کنید؛ بعد در هر متنِ پیام دکمه‌یِ 🙂 را بزنید یا مثلاً <code dir="ltr">:fire:</code> بنویسید. ربات هنگامِ ارسال آن را به ایموجیِ متحرکِ تلگرام تبدیل می‌کند.
          </CardDescription>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-6 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              تلگرام ایموجیِ سفارشی را فقط برایِ باتی نشان می‌دهد که یوزرنیمِ اضافه از Fragment خریده (یا پیام‌هایِ مستقیمِ بات‌ی که صاحبش Premium دارد). در غیرِ این صورت ایموجیِ معمولیِ کنارِ هر ردیف نمایش داده می‌شود و پیام سالم می‌ماند. دکمه‌هایِ شیشه‌ای و نامِ کامند ایموجیِ متحرکِ متنی نمی‌گیرند.
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">افزودنِ پک (لینک یا نام)</label>
            <textarea
              value={packs}
              onChange={(e) => setPacks(e.target.value)}
              dir="ltr"
              rows={3}
              placeholder={"https://t.me/addemoji/PackName\nیا فقط PackName"}
              className="w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm outline-none focus-visible:border-primary/60"
            />
            <Button size="sm" onClick={() => importPack.mutate()} disabled={!packs.trim() || importPack.isPending || dirty} title={dirty ? "ابتدا تغییراتِ فهرست را ذخیره یا لغو کنید" : undefined}>
              {importPack.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}
              افزودنِ پک
            </Button>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">افزودن با شناسه‌یِ ایموجی</label>
            <textarea
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              dir="ltr"
              rows={3}
              placeholder="5368324170671202286, …"
              className="w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm outline-none focus-visible:border-primary/60"
            />
            <Button size="sm" variant="outline" onClick={() => importIds.mutate()} disabled={!ids.trim() || importIds.isPending || dirty} title={dirty ? "ابتدا تغییراتِ فهرست را ذخیره یا لغو کنید" : undefined}>
              {importIds.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}
              افزودن
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              فهرست <Badge variant="outline" className="ms-2">{enabledCount} فعال از {list.length}</Badge>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setAll(true)} disabled={!shown.length}><Check className="me-1 size-4" />فعال‌کردنِ نتایج</Button>
              <Button size="sm" variant="outline" onClick={() => setAll(false)} disabled={!shown.length}>غیرفعال‌کردنِ نتایج</Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || invalid || save.isPending}>
                {save.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}ذخیره
              </Button>
              {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>لغوِ تغییرات</Button>}
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در نام، پک یا ایموجی…" className="ps-9" />
          </div>
          {invalid && <p className="text-xs text-destructive">نامِ هر ایموجی باید یکتا و فقط حروفِ لاتین کوچک/عدد/_ باشد (۲ تا ۳۲ کاراکتر، شروع با حرف).</p>}
        </CardHeader>
        <CardContent>
          {ctx.isLoading ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">هنوز ایموجی‌ای اضافه نشده؛ بالا یک پک اضافه کنید.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((e) => (
                <li key={e.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xl" title={e.animated ? "متحرک" : "ثابت"}>{e.fallback}</span>
                  <div className="min-w-0 flex-1">
                    <Input
                      value={e.name}
                      dir="ltr"
                      onChange={(ev) => patch(e.id, { name: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                      className={`h-8 text-xs ${nameClash(e) || !EMOJI_NAME_RE.test(e.name) ? "border-destructive" : ""}`}
                      aria-label={`نامِ ${emojiToken(e.name)}`}
                    />
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="ltr">{e.pack || "—"}{e.animated ? " · animated" : ""}</p>
                  </div>
                  <Switch checked={e.enabled} onCheckedChange={(v) => patch(e.id, { enabled: v })} aria-label="فعال" />
                  <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => edit((l) => l.filter((x) => x.id !== e.id))} aria-label="حذف">
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
