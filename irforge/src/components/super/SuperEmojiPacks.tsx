import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AlertTriangle, Check, ExternalLink, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

/**
 * /super ← «پک‌هایِ ایموجی»: کتابخانه‌یِ پک‌هایِ ایموجیِ سفارشی برایِ همه‌یِ کاربران.
 * ساخت در تلگرام با باتِ پلتفرم (به نامِ حسابِ تلگرامیِ خودِ ادمین)، قیمت (۰ = رایگان) و فعال/غیرفعال.
 * API: api-server/src/routes/emojiPacks.ts
 */
interface Pack {
  slug: string; titleFa: string; titleEn: string; count: number; priceToman: number; active: boolean;
  tgSetName: string | null; created: boolean; animated: boolean; stickers: { name: string; emoji: string }[];
}

const opts = { credentials: "include" as any };
const errText = (e: any) => e?.data?.error ?? e?.message ?? "خطا";
const json = { "Content-Type": "application/json" };

function PackCard({ p }: { p: Pack }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [price, setPrice] = useState(String(p.priceToman));
  const refresh = () => qc.invalidateQueries({ queryKey: ["super-emoji-packs"] });

  const create = useMutation({
    mutationFn: () => customFetch<{ setName: string; count: number; created: boolean }>(`/api/super/emoji-packs/${p.slug}/create`, { ...opts, method: "POST", headers: json, body: "{}" }),
    onSuccess: (r) => { toast({ title: r.created ? "در تلگرام ساخته شد" : "همگام شد", description: r.setName }); refresh(); },
    onError: (e) => toast({ variant: "destructive", title: "ساخت ناموفق بود", description: errText(e) }),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => customFetch(`/api/super/emoji-packs/${p.slug}`, { ...opts, method: "PATCH", headers: json, body: JSON.stringify(body) }),
    onSuccess: () => { toast({ title: "ذخیره شد" }); refresh(); },
    onError: (e) => toast({ variant: "destructive", title: "خطا", description: errText(e) }),
  });
  const priceDirty = price !== String(p.priceToman);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{p.titleFa}</h3>
          <span className="text-xs text-muted-foreground" dir="ltr">{p.slug}</span>
          {p.animated && <Badge variant="outline">متحرک</Badge>}
          <Badge variant={p.created ? "secondary" : "outline"} className={p.created ? "" : "border-amber-500/50 text-amber-600 dark:text-amber-400"}>
            {p.created ? "ساخته‌شده" : "ساخته نشده"}
          </Badge>
          <span className="ms-auto text-xs text-muted-foreground">{p.count.toLocaleString("fa-IR")} ایموجی</span>
        </div>
        <p className="text-xl leading-none">{p.stickers.map((s) => s.emoji).join(" ")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">قیمت (تومان، ۰ = رایگان)</label>
            <Input value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" dir="ltr" inputMode="numeric" />
            <Button size="sm" variant="outline" disabled={!priceDirty || price === "" || patch.isPending} onClick={() => patch.mutate({ priceToman: Number(price) })}>ذخیره</Button>
            {p.priceToman === 0 && <Badge variant="secondary">رایگان</Badge>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={p.active} onCheckedChange={(v) => patch.mutate({ active: v })} disabled={patch.isPending} />
            فعال برایِ کاربران
          </label>
          <div className="ms-auto flex items-center gap-2">
            {p.tgSetName && (
              <a href={`https://t.me/addemoji/${p.tgSetName}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" dir="ltr">
                t.me/addemoji/{p.tgSetName.slice(0, 22)}… <ExternalLink className="size-3" />
              </a>
            )}
            {!p.created && (
              <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Rocket className="me-1.5 size-4" />}ساخت در تلگرام
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SuperEmojiPacks() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["super-emoji-packs"], queryFn: () => customFetch<{ packs: Pack[] }>("/api/super/emoji-packs", opts), retry: false });
  const all = useMutation({
    mutationFn: () => customFetch<{ report: { slug: string; ok: boolean; message: string }[] }>("/api/super/emoji-packs/create-all", { ...opts, method: "POST", headers: json, body: "{}" }),
    onSuccess: (r) => {
      const bad = r.report.filter((x) => !x.ok);
      toast({ title: bad.length ? `${bad.length} پک ناموفق` : "همه ساخته شد", description: (bad.length ? bad : r.report).map((x) => `${x.slug}: ${x.message}`).join(" — ").slice(0, 400), variant: bad.length ? "destructive" : undefined });
      qc.invalidateQueries({ queryKey: ["super-emoji-packs"] });
    },
    onError: (e) => toast({ variant: "destructive", title: "خطا", description: errText(e) }),
  });

  const packs = q.data?.packs ?? [];
  const pending = packs.filter((p) => !p.created).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1 text-sm text-muted-foreground">
          <p>پک‌ها به نامِ حسابِ تلگرامِ خودت ساخته می‌شوند؛ پس تلگرامت باید به سایت وصل باشد و باتِ پلتفرم را قبلاً Start کرده باشی. بعد از ساخت، پک در «ایموجی‌هایِ متحرک» هر ربات برایِ همه دیده می‌شود. قیمتِ ۰ یعنی رایگان.</p>
          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />خریدِ پکِ پولی هنوز فعال نیست؛ تا آن زمان پکِ با قیمتِ بیشتر از ۰ برایِ کاربر قابلِ افزودن نیست.</p>
        </div>
        {pending > 0 && (
          <Button onClick={() => all.mutate()} disabled={all.isPending}>
            {all.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Rocket className="me-1.5 size-4" />}ساختِ همه ({pending.toLocaleString("fa-IR")})
          </Button>
        )}
        {pending === 0 && packs.length > 0 && <Badge variant="secondary"><Check className="me-1 size-3" />همه ساخته شده</Badge>}
      </div>
      {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin" />}
      {q.error && <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{errText(q.error)}</p>}
      <div className="grid gap-3">{packs.map((p) => <PackCard key={p.slug} p={p} />)}</div>
    </div>
  );
}
