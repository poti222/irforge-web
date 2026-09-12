/**
 * CatalogSection.tsx — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin UI for the `catalog` plugin: categories, items (with plans/options),
 * and each item's fulfillment config. Before this, catalog had create/update
 * logic (`domain.py`) and a full buy-flow + fulfillment queue
 * (`purchase.py`/`fulfillment.py`) with nothing anywhere — bot or website —
 * to ever populate a single item into it (see `lib/catalogStore.ts`'s header
 * comment).
 *
 * IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B2/B4 — the fulfillment
 * config used to be one raw JSON `<Textarea>` regardless of type. Each
 * `fulfillment_type` now gets its own dedicated form (see the `*Fulfillment
 * Form` components below), writing the exact same structured keys each
 * executor in `plugins/catalog/fulfillment.py` (irforge-app) actually reads
 * — the backend API/shape didn't change, only what the frontend sends is
 * structured instead of free-typed JSON. The product's own `buttons` field
 * (`ButtonBuilder`, restricted to url/panel/mini_app) is independent of
 * `fulfillment_type` — it lives in the "content" section next to the
 * product's generic media, not inside the fulfillment section.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import {
  Store, Loader2, Plus, Trash2, Pencil, Archive, ArchiveRestore, PackageOpen, FolderTree,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { MediaList, type MediaMeta } from "../panels/MediaList";
import { ButtonBuilder } from "../panels/ButtonBuilder";
import { usePanels, type PanelCatalog } from "../panels/api";
import { buttonsToRows, rowsToButtons, type PanelButton } from "@/lib/panel-buttons";

type Category = {
  id: string; name: string; name_fa: string; parent_id: string; sort_order: number; is_active: boolean;
};
type CatalogMedia = { type: string; file_id: string; caption: string };
type CatalogItem = {
  id: string; name: string; name_fa: string; description: string; category_id: string;
  price: number; currency: string; compare_at_price: number | null; item_type: string;
  fulfillment_type: string; track_stock: boolean; stock_qty: number; status: string; image_file_id: string;
  media: CatalogMedia[]; body_html: string;
  /** IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B4 — same `PanelButton` shape panels use. */
  buttons: PanelButton[];
};

/**
 * دکمه‌سازِ محصول عیناً همان `ButtonBuilder`یِ پنل‌ساز است، فقط با یک
 * کاتالوگِ محدودشده به‌جایِ `usePanelCatalog` واقعی: محصول مقصدی برای
 * `form`/`sell` یا اکشن‌هایِ پلاگینی ندارد — فقط لینک/پنل/میمنی‌اپ (طبقِ
 * پرامپت، بدونِ `translation` که اصلاً جزوِ این کاتالوگ نیست).
 */
const PRODUCT_BUTTON_CATALOG: PanelCatalog = {
  panelTypes: [],
  buttonActions: ["url", "panel", "mini_app"],
  buttonStyles: ["", "primary", "success", "danger"],
  multiMediaTypes: [],
  textOnlyTypes: [],
  maxButtonsPerRow: 4,
};
type ItemOption = {
  id: string; item_id: string; label: string; price: number; track_stock: boolean;
  stock_qty: number; is_active: boolean; sort_order: number;
};

/**
 * IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۲ — «pool» (استخرِ آیتمِ یکتا) از
 * `plugins/catalog/pool.py`ی بات کاملاً پیاده و تست شده بود
 * (`fulfillment.register_fulfillment_type("pool", pool.deliver_from_pool)`)
 * ولی این لیست جا مانده بود، یعنی از سایت اصلاً قابلِ انتخاب نبود.
 *
 * توجه: بر خلافِ شش نوعِ دیگر، pool پیکربندی‌اش را در
 * `metadata['pool']` نگه می‌دارد، نه `metadata['fulfillment']`ای که
 * `FulfillmentConfigEditor` پایین‌تر می‌خواند/می‌نویسد — یعنی آن ادیتور برای
 * pool صرفاً یک JSON بلااستفاده است (دقیقاً مثل «دستی» که هم به پیکربندی
 * نیاز ندارد)، نه یک ابزار مدیریتِ استخر. مدیریتِ واقعیِ موجودی/آیتم‌های
 * استخر امروز فقط از داخلِ بات ممکن است (`pool_admin.py`، Telegram) — سایت
 * چنین رابطی ندارد؛ `fulfillmentHelpPool` همین را صادقانه به ادمین می‌گوید.
 */
const FULFILLMENT_TYPES = ["manual", "template", "file", "api", "webhook", "wallet_credit", "pool"] as const;
const STATUSES = ["active", "draft", "archived"] as const;

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}
function formatPrice(price: number, currency: string): string {
  return `${price.toLocaleString("fa-IR")} ${currency}`;
}

// ─── دسته‌بندی ───────────────────────────────────────────────────────────────

function CategoryEditor({
  botId, category, onClose,
}: { botId: string; category: Category | null; onClose: () => void }) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? "");
  const [nameFa, setNameFa] = useState(category?.name_fa ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(category?.is_active ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, name_fa: nameFa, sort_order: Number(sortOrder) || 0, is_active: isActive };
      return category
        ? customFetch(`/api/bots/${botId}/catalog/categories/${category.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/catalog/categories`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-catalog-categories", botId] });
      toast({ title: category ? t.categoryUpdated : t.categoryCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{category ? t.editCategory : t.newCategory}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t.fieldCategoryName}</Label>
            <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t.fieldCategoryNameFa}</Label>
            <Input value={nameFa} maxLength={200} onChange={(e) => setNameFa(e.target.value)} placeholder={name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t.fieldSortOrder}</Label>
              <Input type="number" dir="ltr" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <Label className="text-sm">{t.fieldIsActive}</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesTab({ botId }: { botId: string }) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  const categoriesKey = ["bot-catalog-categories", botId] as const;
  const { data, isLoading } = useQuery({
    queryKey: categoriesKey,
    queryFn: () => customFetch<{ categories: Category[] }>(`/api/bots/${botId}/catalog/categories`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${botId}/catalog/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: categoriesKey }); toast({ title: t.categoryDeleted }); },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  const categories = data?.categories ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t.categoriesSectionDesc}</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="me-1.5 size-4" /> {t.newCategory}
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.noCategoriesYet}</p>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{cat.name_fa || cat.name}</p>
                {!cat.is_active && <Badge variant="outline" className="mt-1">{t.categoryInactiveBadge}</Badge>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="icon" variant="ghost" onClick={() => setEditing(cat)}><Pencil className="size-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(cat.id)}><Trash2 className="size-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CategoryEditor botId={botId} category={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ─── گزینه/پلن ───────────────────────────────────────────────────────────────

function OptionEditor({
  botId, itemId, option, onClose,
}: { botId: string; itemId: string; option: ItemOption | null; onClose: () => void }) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [label, setLabel] = useState(option?.label ?? "");
  const [price, setPrice] = useState(String(option?.price ?? 0));
  const [trackStock, setTrackStock] = useState(option?.track_stock ?? false);
  const [stockQty, setStockQty] = useState(String(option?.stock_qty ?? 0));
  const [sortOrder, setSortOrder] = useState(String(option?.sort_order ?? 0));

  const optionsKey = ["bot-catalog-options", botId, itemId] as const;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        label, price: Number(price) || 0, track_stock: trackStock,
        stock_qty: Number(stockQty) || 0, sort_order: Number(sortOrder) || 0,
      };
      return option
        ? customFetch(`/api/bots/${botId}/catalog/options/${option.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/catalog/items/${itemId}/options`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: optionsKey });
      toast({ title: option ? t.optionUpdated : t.optionCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{option ? t.editOption : t.newOption}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t.fieldOptionLabel}</Label>
            <Input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t.fieldOptionPrice}</Label>
              <AmountInput value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldOptionSortOrder}</Label>
              <Input type="number" dir="ltr" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border p-2">
            <Label className="text-sm">{t.fieldOptionTrackStock}</Label>
            <Switch checked={trackStock} onCheckedChange={setTrackStock} />
          </div>
          {trackStock && (
            <div className="space-y-1">
              <Label>{t.fieldOptionStockQty}</Label>
              <Input type="number" dir="ltr" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!label.trim() || save.isPending}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionsEditorPanel({ botId, itemId }: { botId: string; itemId: string }) {
  const t = useT("botCatalog");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ItemOption | "new" | null>(null);

  const optionsKey = ["bot-catalog-options", botId, itemId] as const;
  const { data, isLoading } = useQuery({
    queryKey: optionsKey,
    queryFn: () => customFetch<{ options: ItemOption[] }>(`/api/bots/${botId}/catalog/items/${itemId}/options?includeInactive=1`),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${botId}/catalog/options/${id}/deactivate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: optionsKey }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${botId}/catalog/options/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: optionsKey }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  const options = data?.options ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t.optionsDesc}</p>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="me-1.5 size-4" /> {t.newOption}
        </Button>
      </div>

      {options.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{t.noOptionsYet}</p>
      ) : (
        <div className="space-y-1.5">
          {options.map((opt) => (
            <div key={opt.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <p className={`truncate ${opt.is_active ? "" : "text-muted-foreground line-through"}`}>{opt.label}</p>
                <p dir="ltr" className="text-xs text-muted-foreground">{opt.price.toLocaleString("fa-IR")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(opt)}><Pencil className="size-3.5" /></Button>
                {opt.is_active && (
                  <Button size="icon" variant="ghost" onClick={() => deactivate.mutate(opt.id)}><Archive className="size-3.5" /></Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(opt.id)}><Trash2 className="size-3.5 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <OptionEditor
          botId={botId} itemId={itemId} option={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── تنظیمات تحویل — فرمِ اختصاصیِ هر نوع ────────────────────────────────────
//
// IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B2 — دیگر یک جعبه‌ی JSONِ
// خام نیست؛ هر fulfillment_type فرمِ خودش را دارد و کلیدهایِ مستندشده‌ای
// دقیقاً هم‌شکل با چیزی که هر executor در plugins/catalog/fulfillment.py
// (irforge-app) واقعاً از config می‌خواند می‌نویسد. عکس/رسانه فقط برایِ
// «file» هست (خودِ فایل، نه یک عکسِ تزئینی) — بقیه‌ی انواع از محتوایِ
// عمومیِ خودِ محصول (بخشِ «محتوا» پایین‌تر) استفاده می‌کنند که در لحظه‌ی
// تحویل (یا برایِ manual همین الان، فازِ A1) خودکار برایِ خریدار می‌رود؛
// یک فیلدِ عکسِ دوم اینجا همان چیز را بی‌معنا تکرار می‌کرد.

type KVRow = [string, string];

function objectToRows(obj: unknown): KVRow[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).map(
    ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as KVRow,
  );
}

function rowsToObject(rows: KVRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of rows) {
    const key = k.trim();
    if (key) out[key] = v;
  }
  return out;
}

function KeyValueRows({
  label, rows, onChange,
}: { label: string; rows: KVRow[]; onChange: (rows: KVRow[]) => void }) {
  const t = useT("botCatalog");
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <Input
            dir="ltr" className="flex-1" placeholder={t.fulfillmentKvKey} value={k}
            onChange={(e) => onChange(rows.map((r, idx) => (idx === i ? [e.target.value, r[1]] as KVRow : r)))}
          />
          <Input
            dir="ltr" className="flex-1" placeholder={t.fulfillmentKvValue} value={v}
            onChange={(e) => onChange(rows.map((r, idx) => (idx === i ? [r[0], e.target.value] as KVRow : r)))}
          />
          <Button type="button" size="icon" variant="ghost" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, ["", ""]])}>
        <Plus className="me-1.5 size-3.5" /> {t.fulfillmentKvAdd}
      </Button>
    </div>
  );
}

function useSaveFulfillmentConfig(botId: string, itemId: string) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      customFetch(`/api/bots/${botId}/catalog/items/${itemId}/fulfillment`, { method: "PUT", body: JSON.stringify({ config }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-catalog-fulfillment", botId, itemId] });
      toast({ title: t.fulfillmentConfigSaved });
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });
}

type FulfillmentFormProps = { botId: string; itemId: string; config: Record<string, unknown>; disabled: boolean };

function TemplateFulfillmentForm({ botId, itemId, config, disabled }: FulfillmentFormProps) {
  const t = useT("botCatalog");
  const save = useSaveFulfillmentConfig(botId, itemId);
  const [template, setTemplate] = useState(String(config.template ?? ""));

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t.fulfillmentTemplateHelp}</p>
      <Textarea
        dir="rtl" rows={4} maxLength={4096} value={template}
        placeholder={t.fulfillmentTemplatePlaceholder}
        onChange={(e) => setTemplate(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t.bodyHtmlHint}</p>
      <Button size="sm" onClick={() => save.mutate({ ...config, template })} disabled={disabled || save.isPending || !template.trim()}>
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveFulfillmentConfig}
      </Button>
    </div>
  );
}

const FILE_KINDS = ["document", "photo", "video", "audio"] as const;

function FileFulfillmentForm({ botId, itemId, config, disabled }: FulfillmentFormProps) {
  const t = useT("botCatalog");
  const save = useSaveFulfillmentConfig(botId, itemId);
  const initialFileId = String(config.file_id ?? "");
  const [fileIds, setFileIds] = useState<string[]>(initialFileId ? [initialFileId] : []);
  const [fileKind, setFileKind] = useState(String(config.file_kind ?? "document"));
  const [caption, setCaption] = useState(String(config.caption ?? ""));
  const fileId = fileIds[0] ?? "";

  // آپلودِ مستقیم فقط عکس/صوت را قبول می‌کند (تصمیمِ محصولیِ سراسریِ همین
  // مخزن — `botMedia.ts::ALLOWED_PREFIXES`)؛ سند/ویدیو باید از همان ورودیِ
  // دستیِ file_id که خودِ MediaList دارد («پیشرفته») وارد شود، و همین‌جا
  // نوعش را با این انتخاب‌گر صریح مشخص کند.
  function handleMeta(meta: Record<string, MediaMeta>) {
    const only = Object.values(meta)[0];
    if (only && only.kind !== "unknown") setFileKind(only.kind);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t.fulfillmentFieldFile}</Label>
        <p className="text-xs text-muted-foreground">{t.fulfillmentFileHelp}</p>
        <MediaList botId={botId} fileIds={fileIds} multiple={false} onChange={setFileIds} onMetaChange={handleMeta} />
      </div>
      <div className="space-y-1">
        <Label>{t.fulfillmentFieldFileKind}</Label>
        <Select value={fileKind} onValueChange={setFileKind}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FILE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{(t as Record<string, string>)[`fulfillmentFileKind_${k}`] ?? k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>{t.fulfillmentFieldCaption}</Label>
        <Input dir="rtl" maxLength={1024} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <Button
        size="sm"
        onClick={() => save.mutate({ ...config, file_id: fileId, file_kind: fileKind, caption })}
        disabled={disabled || save.isPending || !fileId}
      >
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveFulfillmentConfig}
      </Button>
    </div>
  );
}

const API_HTTP_METHODS = ["GET", "POST"] as const;

function ApiFulfillmentForm({ botId, itemId, config, disabled }: FulfillmentFormProps) {
  const t = useT("botCatalog");
  const save = useSaveFulfillmentConfig(botId, itemId);
  const [url, setUrl] = useState(String(config.url ?? ""));
  const [method, setMethod] = useState(String(config.method ?? "POST").toUpperCase());
  const [headers, setHeaders] = useState<KVRow[]>(objectToRows(config.headers));
  const [payload, setPayload] = useState<KVRow[]>(objectToRows(config.payload));
  const urlInvalid = Boolean(url) && !/^https?:\/\//i.test(url);

  function handleSave() {
    save.mutate({ ...config, url, method, headers: rowsToObject(headers), payload: rowsToObject(payload) });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label>{t.fulfillmentFieldUrl}</Label>
          <Input dir="ltr" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} aria-invalid={urlInvalid || undefined} />
        </div>
        <div className="space-y-1">
          <Label>{t.fulfillmentFieldMethod}</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {API_HTTP_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {urlInvalid && <p className="text-xs text-destructive">{t.fulfillmentUrlInvalid}</p>}
      <KeyValueRows label={t.fulfillmentFieldHeaders} rows={headers} onChange={setHeaders} />
      <KeyValueRows label={t.fulfillmentFieldPayload} rows={payload} onChange={setPayload} />
      <p className="text-xs text-muted-foreground">{t.fulfillmentApiHelp}</p>
      <Button size="sm" onClick={handleSave} disabled={disabled || save.isPending || !url.trim() || urlInvalid}>
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveFulfillmentConfig}
      </Button>
    </div>
  );
}

function WebhookFulfillmentForm({ botId, itemId, config, disabled }: FulfillmentFormProps) {
  const t = useT("botCatalog");
  const save = useSaveFulfillmentConfig(botId, itemId);
  const [url, setUrl] = useState(String(config.url ?? ""));
  const [headers, setHeaders] = useState<KVRow[]>(objectToRows(config.headers));
  const [payload, setPayload] = useState<KVRow[]>(objectToRows(config.payload));
  const urlInvalid = Boolean(url) && !/^https?:\/\//i.test(url);

  function handleSave() {
    save.mutate({ ...config, url, headers: rowsToObject(headers), payload: rowsToObject(payload) });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t.fulfillmentFieldUrl}</Label>
        <Input dir="ltr" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} aria-invalid={urlInvalid || undefined} />
        {urlInvalid && <p className="text-xs text-destructive">{t.fulfillmentUrlInvalid}</p>}
      </div>
      <KeyValueRows label={t.fulfillmentFieldHeaders} rows={headers} onChange={setHeaders} />
      <KeyValueRows label={t.fulfillmentFieldPayload} rows={payload} onChange={setPayload} />
      <p className="text-xs text-muted-foreground">{t.fulfillmentWebhookHelp}</p>
      <Button size="sm" onClick={handleSave} disabled={disabled || save.isPending || !url.trim() || urlInvalid}>
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveFulfillmentConfig}
      </Button>
    </div>
  );
}

function WalletCreditFulfillmentForm({ botId, itemId, config, disabled }: FulfillmentFormProps) {
  const t = useT("botCatalog");
  const save = useSaveFulfillmentConfig(botId, itemId);
  const [amount, setAmount] = useState(config.amount_per_unit != null ? String(config.amount_per_unit) : "");
  const [currency, setCurrency] = useState(String(config.currency ?? "IRT"));
  const amountNum = Number(amount);
  const amountInvalid = amount !== "" && (!Number.isFinite(amountNum) || amountNum <= 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>{t.fulfillmentFieldAmountPerUnit}</Label>
          <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>{t.fieldCurrency}</Label>
          <Input dir="ltr" value={currency} maxLength={10} onChange={(e) => setCurrency(e.target.value)} />
        </div>
      </div>
      {amountInvalid && <p className="text-xs text-destructive">{t.fulfillmentAmountInvalid}</p>}
      <p className="text-xs text-muted-foreground">{t.fulfillmentWalletCreditHelp}</p>
      <Button
        size="sm"
        onClick={() => save.mutate({ ...config, amount_per_unit: amountNum, currency })}
        disabled={disabled || save.isPending || !amount || amountInvalid}
      >
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveFulfillmentConfig}
      </Button>
    </div>
  );
}

// ─── فروخته‌شده‌هایِ استخرِ آیتمِ یکتا (pool) ─────────────────────────────────
// IRFORGE_POOL_QTY_SOLDLIST_STOREFRONT_PROMPT بخش ۲ — قبلاً این داده فقط از
// خودِ بات (plugins/catalog/pool_admin.py) دیده می‌شد. این‌جا همان تبِ
// `catalog_pool_items`ی سایت (lib/catalogStore.ts::listPoolSold) را می‌خواند
// — فقط برایِ محصولاتِ fulfillment_type="pool"، دقیقاً همان‌جایی که پیش‌ازاین
// فقط یک متنِ راهنما بود.
type PoolSoldRow = {
  id: string; status: string; buyer_id: string; order_id: string;
  payload_type: string; sold_at: string; delivered_at: string;
};

function PoolSoldList({ botId, itemId }: { botId: string; itemId: string }) {
  const t = useT("botCatalog");
  const [query, setQuery] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["bot-catalog-pool-sold", botId, itemId, query] as const,
    queryFn: () => customFetch<{ sold: PoolSoldRow[] }>(
      `/api/bots/${botId}/catalog/items/${itemId}/pool/sold${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  });

  const rows = data?.sold ?? [];

  const statusBadge = (status: string) => {
    if (status === "delivered") return <Badge variant="secondary">{t.poolStatusDelivered}</Badge>;
    if (status === "failed") return <Badge variant="destructive">{t.poolStatusFailed}</Badge>;
    return <Badge variant="outline">{t.poolStatusSold}</Badge>;
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t.fulfillmentHelpPool}</p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.poolSoldSearchPlaceholder}
        className="max-w-xs"
      />
      {isLoading && (
        <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t.loading}
        </div>
      )}
      {isError && <p className="text-sm text-destructive">{t.poolSoldLoadError}</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.poolSoldEmpty}</p>
      )}
      {!isLoading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 text-start font-medium">{t.poolSoldColBuyer}</th>
                <th className="p-2 text-start font-medium">{t.poolSoldColOrder}</th>
                <th className="p-2 text-start font-medium">{t.poolSoldColStatus}</th>
                <th className="p-2 text-start font-medium">{t.poolSoldColDate}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2" dir="ltr">{r.buyer_id || "—"}</td>
                  <td className="p-2" dir="ltr">{r.order_id ? r.order_id.slice(0, 16) : "—"}</td>
                  <td className="p-2">{statusBadge(r.status)}</td>
                  <td className="p-2" dir="ltr">{String(r.sold_at || r.delivered_at || "").slice(0, 16).replace("T", " ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** انواعی که اصلاً کانفیگ ندارند — نه فرمی، نه فیلدی برایِ ذخیره. */
const NO_CONFIG_FULFILLMENT_TYPES = new Set(["manual", "pool"]);

function FulfillmentConfigEditor({
  botId, itemId, fulfillmentType, savedFulfillmentType,
}: { botId: string; itemId: string; fulfillmentType: string; savedFulfillmentType: string }) {
  const t = useT("botCatalog");

  const cfgKey = ["bot-catalog-fulfillment", botId, itemId] as const;
  const { data, isLoading } = useQuery({
    queryKey: cfgKey,
    queryFn: () => customFetch<{ fulfillment_type: string; config: Record<string, unknown> }>(`/api/bots/${botId}/catalog/items/${itemId}/fulfillment`),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  // نوعِ ارسال در فرمِ بالا عوض شده ولی هنوز ذخیره نشده — فرمِ نوعِ تازه را
  // همین الان نشان بده (پذیرشِ فازِ B2: تعویضِ آنی)، ولی خالی، نه با
  // کانفیگِ نوعِ قبلی؛ و ذخیره را قفل کن، چون PUT .../fulfillment سمتِ سرور
  // مقابلِ fulfillment_typeِ هنوز-ذخیره‌شده روی آیتم اعتبارسنجی می‌شود، نه
  // این نوعِ تازه‌ای که این فرم نشانش می‌دهد.
  const typeIsUnsaved = fulfillmentType !== savedFulfillmentType;
  const config = typeIsUnsaved ? {} : (data?.config ?? {});
  const formProps: FulfillmentFormProps = { botId, itemId, config, disabled: typeIsUnsaved };

  const body = (() => {
    switch (fulfillmentType) {
      case "template": return <TemplateFulfillmentForm {...formProps} />;
      case "file": return <FileFulfillmentForm {...formProps} />;
      case "api": return <ApiFulfillmentForm {...formProps} />;
      case "webhook": return <WebhookFulfillmentForm {...formProps} />;
      case "wallet_credit": return <WalletCreditFulfillmentForm {...formProps} />;
      case "pool": return <PoolSoldList botId={botId} itemId={itemId} />;
      case "manual":
      default:
        return <p className="text-xs text-muted-foreground">{t.fulfillmentHelpManual}</p>;
    }
  })();

  return (
    <div className="space-y-2">
      {typeIsUnsaved && !NO_CONFIG_FULFILLMENT_TYPES.has(fulfillmentType) && (
        <p className="text-xs text-amber-600 dark:text-amber-500">{t.fulfillmentSaveTypeFirst}</p>
      )}
      {body}
    </div>
  );
}

// ─── ویرایشگر کالا/سرویس ─────────────────────────────────────────────────────

function ItemEditor({
  botId, item, categories, onClose,
}: { botId: string; item: CatalogItem | "new"; categories: Category[]; onClose: () => void }) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = item === "new" ? null : item;
  const [current, setCurrent] = useState<CatalogItem | null>(base);

  const [name, setName] = useState(base?.name ?? "");
  const [nameFa, setNameFa] = useState(base?.name_fa ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [categoryId, setCategoryId] = useState(base?.category_id ?? "");
  const [price, setPrice] = useState(String(base?.price ?? 0));
  const [currency, setCurrency] = useState(base?.currency ?? "IRT");
  const [compareAtPrice, setCompareAtPrice] = useState(base?.compare_at_price != null ? String(base.compare_at_price) : "");
  const [itemType, setItemType] = useState(base?.item_type ?? "service");
  const [fulfillmentType, setFulfillmentType] = useState(base?.fulfillment_type ?? "manual");
  const [trackStock, setTrackStock] = useState(base?.track_stock ?? false);
  const [stockQty, setStockQty] = useState(String(base?.stock_qty ?? 0));
  const [status, setStatus] = useState(base?.status ?? "active");
  const [mediaFileIds, setMediaFileIds] = useState<string[]>(base?.media?.map((m) => m.file_id) ?? []);
  const [bodyHtml, setBodyHtml] = useState(base?.body_html ?? "");
  const [buttonRows, setButtonRows] = useState<PanelButton[][]>(() => buttonsToRows(base?.buttons ?? []));

  const { data: panelsData } = usePanels(botId);

  const itemsKey = ["bot-catalog-items", botId] as const;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name, name_fa: nameFa, description, category_id: categoryId,
        price: Number(price) || 0, currency,
        compare_at_price: compareAtPrice === "" ? null : Number(compareAtPrice),
        item_type: itemType, fulfillment_type: fulfillmentType,
        track_stock: trackStock, stock_qty: Number(stockQty) || 0,
        status,
        media: mediaFileIds.map((fileId) => ({ type: "photo", file_id: fileId, caption: "" })),
        body_html: bodyHtml,
        buttons: rowsToButtons(buttonRows),
      };
      return current
        ? customFetch<{ item: CatalogItem }>(`/api/bots/${botId}/catalog/items/${current.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch<{ item: CatalogItem }>(`/api/bots/${botId}/catalog/items`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: itemsKey });
      toast({ title: current ? t.itemUpdated : t.itemCreated });
      setCurrent(res.item);
      // ویرایشِ یک کالای موجود بعد از ذخیره بسته می‌شود — دقیقاً همان
      // رفتاری که کاربر از یک فرمِ ویرایش انتظار دارد. برای یک کالای **تازه**
      // (item === "new") عمداً باز می‌ماند: اولین ذخیره‌ست که current را پر
      // می‌کند و بخش‌های گزینه‌ها/تحویل را نشان می‌دهد — بستنِ فوری یعنی
      // کاربر هرگز نمی‌تواند همان لحظه آن‌ها را تنظیم کند.
      if (item !== "new") onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{current ? t.editItem : t.newItem}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t.fieldName}</Label>
              <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldNameFa}</Label>
              <Input value={nameFa} maxLength={200} onChange={(e) => setNameFa(e.target.value)} placeholder={name} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t.fieldDescription}</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>{t.fieldCategory}</Label>
            <Select value={categoryId || "__none__"} onValueChange={(v) => setCategoryId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.noCategoryOption}</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name_fa || c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>{t.fieldPrice}</Label>
              <AmountInput value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldCurrency}</Label>
              <Input dir="ltr" value={currency} maxLength={10} onChange={(e) => setCurrency(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldCompareAtPrice}</Label>
              <AmountInput value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t.fieldItemType}</Label>
              <Input value={itemType} maxLength={40} onChange={(e) => setItemType(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldFulfillmentType}</Label>
              <Select value={fulfillmentType} onValueChange={setFulfillmentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FULFILLMENT_TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>{(t as Record<string, string>)[`fulfillment_${ft}`] ?? ft}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md border p-2">
            <Label className="text-sm">{t.fieldTrackStock}</Label>
            <Switch checked={trackStock} onCheckedChange={setTrackStock} />
          </div>
          {trackStock && (
            <div className="space-y-1">
              <Label>{t.fieldStockQty}</Label>
              <Input type="number" dir="ltr" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
            </div>
          )}

          <div className="space-y-1">
            <Label>{t.fieldStatus}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{(t as Record<string, string>)[`status_${s}`] ?? s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 border-t pt-3">
            <div>
              <p className="text-sm font-medium">{t.contentSectionTitle}</p>
              <p className="text-xs text-muted-foreground">{t.contentSectionDesc}</p>
            </div>
            <MediaList botId={botId} fileIds={mediaFileIds} multiple accept="image/*" onChange={setMediaFileIds} />
            <div className="space-y-1 pt-1">
              <Label>{t.fieldBodyHtml}</Label>
              <Textarea
                dir="rtl" rows={4}
                value={bodyHtml}
                maxLength={4096}
                placeholder={t.bodyHtmlPlaceholder}
                onChange={(e) => setBodyHtml(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t.bodyHtmlHint}</p>
            </div>
            <div className="space-y-1.5 pt-1">
              <Label>{t.buttonsTitle}</Label>
              <p className="text-xs text-muted-foreground">{t.buttonsDesc}</p>
              <ButtonBuilder
                botId={botId}
                rows={buttonRows}
                panels={panelsData?.panels ?? []}
                forms={[]}
                catalog={PRODUCT_BUTTON_CATALOG}
                onChange={setButtonRows}
              />
            </div>
          </div>

          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending} className="w-full">
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>

          {current && (
            <>
              <div className="border-t pt-3">
                <p className="mb-2 text-sm font-medium">{t.optionsTitle}</p>
                <OptionsEditorPanel botId={botId} itemId={current.id} />
              </div>
              <div className="border-t pt-3">
                <p className="mb-2 text-sm font-medium">{t.fulfillmentConfigTitle}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t.fulfillmentConfigDesc}</p>
                <FulfillmentConfigEditor
                  botId={botId} itemId={current.id}
                  fulfillmentType={fulfillmentType} savedFulfillmentType={current.fulfillment_type}
                />
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── فهرست کالا/سرویس ────────────────────────────────────────────────────────

function ItemsTab({ botId, categories }: { botId: string; categories: Category[] }) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const itemsKey = ["bot-catalog-items", botId] as const;
  const { data, isLoading } = useQuery({
    queryKey: itemsKey,
    queryFn: () => customFetch<{ items: CatalogItem[] }>(`/api/bots/${botId}/catalog/items?includeArchived=1`),
  });

  const archive = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${botId}/catalog/items/${id}/archive`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: itemsKey }); toast({ title: t.itemArchived }); },
  });

  const restore = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${botId}/catalog/items/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemsKey }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${botId}/catalog/items/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: itemsKey }); toast({ title: t.itemDeleted }); },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  const allItems = data?.items ?? [];
  const items = showArchived ? allItems : allItems.filter((i) => i.status !== "archived");
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name_fa || categories.find((c) => c.id === id)?.name;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t.itemsSectionDesc}</p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} /> {t.showArchived}
          </label>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="me-1.5 size-4" /> {t.newItem}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.noItemsYet}</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div className="flex min-w-0 items-center gap-3">
                {it.media?.[0]?.file_id && (
                  <img
                    src={`/api/bots/${botId}/media/${encodeURIComponent(it.media[0].file_id)}`}
                    alt=""
                    loading="lazy"
                    className="size-10 shrink-0 rounded border object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`truncate font-medium ${it.status === "archived" ? "text-muted-foreground line-through" : ""}`}>
                      {it.name_fa || it.name}
                    </p>
                    {it.status === "draft" && <Badge variant="outline">{t.status_draft}</Badge>}
                    {it.status === "archived" && <Badge variant="outline">{t.status_archived}</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {categoryName(it.category_id) ?? t.uncategorized} · {formatPrice(it.price, it.currency)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="icon" variant="ghost" onClick={() => setEditing(it)}><Pencil className="size-4" /></Button>
                {it.status === "archived" ? (
                  <Button size="icon" variant="ghost" onClick={() => restore.mutate(it.id)}><ArchiveRestore className="size-4" /></Button>
                ) : (
                  <Button size="icon" variant="ghost" onClick={() => archive.mutate(it.id)}><Archive className="size-4" /></Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(it.id)}><Trash2 className="size-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ItemEditor botId={botId} item={editing} categories={categories} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ─── ورودی سکشن ──────────────────────────────────────────────────────────────

export function CatalogSection({ bot }: { bot: Bot }) {
  const t = useT("botCatalog");
  const qc = useQueryClient();

  const categoriesKey = ["bot-catalog-categories", bot.id] as const;
  const { data: categoriesData, isLoading, error } = useQuery({
    queryKey: categoriesKey,
    queryFn: () => customFetch<{ categories: Category[] }>(`/api/bots/${bot.id}/catalog/categories`),
  });

  const { toast } = useToast();

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/catalog`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: categoriesKey }); },
  });

  // IRFORGE_POOL_QTY_SOLDLIST_STOREFRONT_PROMPT بخش ۳ — «activate» بالا فقط
  // enabled=true می‌نویسد؛ اگر catalog هنوز خریده نشده باشد (پولی است) با
  // ۴۰۲ شکست می‌خورد چون خودِ خرید مسیرِ جدایی دارد. این دکمه هر دو کار را
  // با هم انجام می‌دهد: خریدِ بستهٔ فروشگاه‌ساز (کاتالوگ + کیف‌پول) با یک
  // قیمتِ واحد، به‌جای این‌که کاربر مجبور شود جدا پیدا کند چطور خریدشان کند.
  const buyStorefront = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/storefront`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: categoriesKey }); },
    onError: (err) => toast({ variant: "destructive", description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Store className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
              {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {activate.isPending ? t.activating : t.activatePlugin}
            </Button>
            <Button variant="outline" onClick={() => buyStorefront.mutate()} disabled={buyStorefront.isPending}>
              {buyStorefront.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.buyStorefrontBundle}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <Tabs defaultValue="items" className="space-y-4">
      <TabsList>
        <TabsTrigger value="items"><PackageOpen className="me-1.5 size-4" /> {t.tabItems}</TabsTrigger>
        <TabsTrigger value="categories"><FolderTree className="me-1.5 size-4" /> {t.tabCategories}</TabsTrigger>
      </TabsList>
      <TabsContent value="items">
        <ItemsTab botId={bot.id} categories={categoriesData?.categories ?? []} />
      </TabsContent>
      <TabsContent value="categories">
        <CategoriesTab botId={bot.id} />
      </TabsContent>
    </Tabs>
  );
}
