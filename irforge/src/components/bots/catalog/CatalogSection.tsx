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
 * The fulfillment config is a free-form nested object whose shape depends on
 * `fulfillment_type` (manual/template/file/api/webhook/wallet_credit) — the
 * bot's own `get_fulfillment_config`/`set_fulfillment_config` are deliberate
 * passthroughs with no fixed schema, so this exposes it as a labeled JSON
 * editor with per-type placeholder text rather than six bespoke forms.
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

type Category = {
  id: string; name: string; name_fa: string; parent_id: string; sort_order: number; is_active: boolean;
};
type CatalogItem = {
  id: string; name: string; name_fa: string; description: string; category_id: string;
  price: number; currency: string; compare_at_price: number | null; item_type: string;
  fulfillment_type: string; track_stock: boolean; stock_qty: number; status: string; image_file_id: string;
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

// ─── تنظیمات تحویل ───────────────────────────────────────────────────────────

function fulfillmentPlaceholder(type: string): string {
  switch (type) {
    case "template": return '{\n  "template": "سلام {buyer_name}، این کد شماست: ..."\n}';
    case "file": return '{\n  "file_id": "<telegram file_id>",\n  "file_kind": "document",\n  "caption": "فایل شما"\n}';
    case "api": return '{\n  "url": "https://example.com/issue",\n  "method": "POST",\n  "headers": {},\n  "payload": {},\n  "response_field": "data.code"\n}';
    case "webhook": return '{\n  "url": "https://example.com/hook",\n  "headers": {},\n  "payload": {}\n}';
    case "wallet_credit": return '{\n  "amount_per_unit": 10000,\n  "currency": "IRT"\n}';
    default: return "{}";
  }
}

function FulfillmentConfigEditor({
  botId, item,
}: { botId: string; item: CatalogItem }) {
  const t = useT("botCatalog");
  const { toast } = useToast();
  const qc = useQueryClient();

  const cfgKey = ["bot-catalog-fulfillment", botId, item.id] as const;
  const { data, isLoading } = useQuery({
    queryKey: cfgKey,
    queryFn: () => customFetch<{ fulfillment_type: string; config: Record<string, unknown> }>(`/api/bots/${botId}/catalog/items/${item.id}/fulfillment`),
  });

  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = text ?? (data ? JSON.stringify(data.config, null, 2) : "{}");

  const save = useMutation({
    mutationFn: (config: unknown) =>
      customFetch(`/api/bots/${botId}/catalog/items/${item.id}/fulfillment`, { method: "PUT", body: JSON.stringify({ config }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: cfgKey }); toast({ title: t.fulfillmentConfigSaved }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  function handleSave() {
    try {
      const parsed = JSON.parse(value || "{}");
      setError(null);
      save.mutate(parsed);
    } catch {
      setError(t.fulfillmentConfigInvalidJson);
    }
  }

  const helpKey = `fulfillmentHelp${item.fulfillment_type.replace(/(^|_)([a-z])/g, (_m, _p, c) => c.toUpperCase())}` as keyof typeof t;
  const help = (t as Record<string, string>)[helpKey] ?? t.fulfillmentHelpManual;

  if (isLoading) return <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{help}</p>
      <Textarea
        dir="ltr" rows={8} className="font-mono text-xs"
        value={value}
        placeholder={fulfillmentPlaceholder(item.fulfillment_type)}
        onChange={(e) => { setText(e.target.value); setError(null); }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" onClick={handleSave} disabled={save.isPending}>
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveFulfillmentConfig}
      </Button>
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
  const [imageFileId, setImageFileId] = useState(base?.image_file_id ?? "");

  const itemsKey = ["bot-catalog-items", botId] as const;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name, name_fa: nameFa, description, category_id: categoryId,
        price: Number(price) || 0, currency,
        compare_at_price: compareAtPrice === "" ? null : Number(compareAtPrice),
        item_type: itemType, fulfillment_type: fulfillmentType,
        track_stock: trackStock, stock_qty: Number(stockQty) || 0,
        status, image_file_id: imageFileId,
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

          <div className="space-y-1">
            <Label>{t.fieldImageFileId}</Label>
            <Input dir="ltr" value={imageFileId} onChange={(e) => setImageFileId(e.target.value)} placeholder={t.imageFileIdHint} />
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
                <FulfillmentConfigEditor botId={botId} item={current} />
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

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/catalog`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: categoriesKey }); },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Store className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activate.isPending ? t.activating : t.activatePlugin}
          </Button>
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
