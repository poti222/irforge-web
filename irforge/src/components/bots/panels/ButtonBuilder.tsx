/**
 * ButtonBuilder.tsx — چیدمان دکمه‌های پنل به‌شکلی که خرابی `row`/`row_start`
 * ممکن نباشد (باگ B9).
 *
 * مدل UI آرایه‌ای از ردیف‌هاست؛ کاربر هرگز عدد `row` نمی‌بیند و نمی‌تواند
 * دستکاری‌اش کند. تبدیل به شکل تختِ نرمال‌شده فقط در `panel-buttons.ts` انجام
 * می‌شود و تست round-trip دارد.
 *
 * جابه‌جایی با **دکمه** است نه drag: روی موبایل کشیدن داخل یک لیست اسکرول‌شونده
 * عملاً کار نمی‌کند، و ↑↓←→ در هر دو جهت RTL/LTR بدون ابهام است.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Plus, Trash2, ArrowUp, ArrowDown, ArrowRight, ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import {
  addButton, addRow, emptyButton, moveButtonHorizontally, moveButtonVertically,
  moveRow, overfullRows, removeButton, removeRow, updateButton,
  MAX_BUTTONS_PER_ROW, canAddToRow, type PanelButton,
} from "@/lib/panel-buttons";
import { buttonActionLabel, buttonStyleLabel } from "./labels";
import type { Panel, PanelCatalog } from "./api";

/** فقط برای انتخاب‌گرِ اکشنِ «ثبت سفارش یک محصول» — نیازی به کل شکلِ CatalogItem نیست. */
function useCatalogItemsForPicker(botId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["bot-panel-catalog-items", botId],
    queryFn: () =>
      customFetch<{ items: Array<{ id: string; name: string; name_fa: string; status: string }> }>(
        `/api/bots/${botId}/catalog/items`,
      ),
    enabled,
  });
}

/** ورودی مناسبِ هر اکشن — نه یک فیلد متنی که uuid دستی بخواهد. */
function ValueField({
  botId,
  button,
  panels,
  forms,
  catalog,
  onChange,
}: {
  botId: string;
  button: PanelButton;
  panels: Panel[];
  forms: Array<{ id: string; title: string }>;
  catalog: PanelCatalog | undefined;
  onChange: (value: string) => void;
}) {
  const t = useT("botPanels");
  const { lang } = useLanguage();

  const isCatalogOrder = button.action === "catalog_order";
  const { data: catalogItems, isLoading: catalogItemsLoading } = useCatalogItemsForPicker(botId, isCatalogOrder);

  if (button.action === "phone" || (catalog?.buttonFixedValues && button.action in catalog.buttonFixedValues)) {
    return <p className="text-xs text-muted-foreground">{t.valueNoneNeeded}</p>;
  }

  if (isCatalogOrder) {
    const activeItems = (catalogItems?.items ?? []).filter((i) => i.status === "active");
    if (catalogItemsLoading) {
      return <p className="text-xs text-muted-foreground">{t.loadingProducts}</p>;
    }
    if (activeItems.length === 0) {
      return <p className="text-xs text-muted-foreground">{t.noProductsYet}</p>;
    }
    return (
      <Select value={button.value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={t.pickProduct} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t.pickProduct}</SelectItem>
          {activeItems.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {(lang === "fa" ? item.name_fa : item.name) || item.name || item.name_fa}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (button.action === "panel") {
    return (
      <Select value={button.value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={t.pickPanel} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t.pickPanel}</SelectItem>
          {panels.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.title || p.id}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (button.action === "form") {
    return (
      <Select value={button.value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={t.pickForm} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t.pickForm}</SelectItem>
          {forms.map((f) => (
            <SelectItem key={f.id} value={f.id}>{f.title || f.id}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (button.action === "url" || button.action === "mini_app") {
    const invalid = Boolean(button.value) && !/^https:\/\//i.test(button.value);
    return (
      <div className="space-y-1">
        <Input
          dir="ltr"
          value={button.value}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
        />
        {invalid && <p className="text-xs text-destructive">{t.errorHttpsRequired}</p>}
      </div>
    );
  }

  return <Input dir="ltr" value={button.value} onChange={(e) => onChange(e.target.value)} />;
}

export function ButtonBuilder({
  botId,
  rows,
  panels,
  forms,
  catalog,
  onChange,
}: {
  botId: string;
  rows: PanelButton[][];
  panels: Panel[];
  forms: Array<{ id: string; title: string }>;
  catalog: PanelCatalog | undefined;
  onChange: (rows: PanelButton[][]) => void;
}) {
  const t = useT("botPanels");
  const actions = catalog?.buttonActions ?? ["panel", "url", "form"];
  const styles = catalog?.buttonStyles ?? ["", "primary", "success", "danger"];
  const overfull = new Set(overfullRows(rows));

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t.noButtons}
        </p>
      )}

      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`rounded-md border p-3 ${overfull.has(rowIndex) ? "border-destructive/50" : ""}`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {t.rowLabel.replace("{n}", String(rowIndex + 1))}
            </span>
            <span className="text-xs text-muted-foreground">
              {t.rowCount.replace("{n}", String(row.length))}
            </span>
            <div className="ms-auto flex items-center gap-1">
              <Button
                variant="ghost" size="icon" aria-label={t.moveRowUp}
                disabled={rowIndex === 0}
                onClick={() => onChange(moveRow(rows, rowIndex, rowIndex - 1))}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost" size="icon" aria-label={t.moveRowDown}
                disabled={rowIndex === rows.length - 1}
                onClick={() => onChange(moveRow(rows, rowIndex, rowIndex + 1))}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost" size="icon" aria-label={t.removeRow}
                onClick={() => onChange(removeRow(rows, rowIndex))}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </div>

          {overfull.has(rowIndex) && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />
              {t.rowTooFull.replace("{max}", String(MAX_BUTTONS_PER_ROW))}
            </p>
          )}

          <div className="space-y-3">
            {row.map((button, colIndex) => (
              <div key={colIndex} className="rounded-md bg-muted/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`btn-label-${rowIndex}-${colIndex}`}>{t.buttonLabel}</Label>
                    <Input
                      id={`btn-label-${rowIndex}-${colIndex}`}
                      value={button.label}
                      maxLength={64}
                      onChange={(e) => onChange(updateButton(rows, rowIndex, colIndex, { label: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`btn-action-${rowIndex}-${colIndex}`}>{t.buttonAction}</Label>
                    <Select
                      value={button.action}
                      onValueChange={(v) =>
                        // مقدار قبلی برای اکشن جدید معنا ندارد و اگر بماند یک
                        // uuid پنل در فیلد URL جا خوش می‌کند — مگر اکشنِ تازه
                        // یکی از اکشن‌های پلاگینیِ مقدارِ‌ثابت باشد (مثلاً
                        // «رزرو نوبت»)، که آن‌وقت خودِ مقدارش را می‌گیرد و
                        // ادمین چیزی برای پرکردن ندارد.
                        onChange(
                          updateButton(rows, rowIndex, colIndex, {
                            action: v,
                            value: catalog?.buttonFixedValues?.[v] ?? "",
                          }),
                        )
                      }
                    >
                      <SelectTrigger id={`btn-action-${rowIndex}-${colIndex}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {actions.map((a) => (
                          <SelectItem key={a} value={a}>{buttonActionLabel(t, a)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t.buttonValue}</Label>
                    <ValueField
                      botId={botId}
                      button={button}
                      panels={panels}
                      forms={forms}
                      catalog={catalog}
                      onChange={(value) => onChange(updateButton(rows, rowIndex, colIndex, { value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`btn-style-${rowIndex}-${colIndex}`}>{t.buttonStyle}</Label>
                    <Select
                      value={button.style || "__default__"}
                      onValueChange={(v) =>
                        onChange(updateButton(rows, rowIndex, colIndex, { style: v === "__default__" ? "" : v }))
                      }
                    >
                      <SelectTrigger id={`btn-style-${rowIndex}-${colIndex}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {styles.map((s) => (
                          <SelectItem key={s || "__default__"} value={s || "__default__"}>
                            {buttonStyleLabel(t, s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <Button
                    variant="outline" size="icon" aria-label={t.moveButtonStart}
                    disabled={colIndex === 0}
                    onClick={() => onChange(moveButtonHorizontally(rows, rowIndex, colIndex, -1))}
                  >
                    <ArrowRight className="size-4 rtl-flip" />
                  </Button>
                  <Button
                    variant="outline" size="icon" aria-label={t.moveButtonEnd}
                    disabled={colIndex === row.length - 1}
                    onClick={() => onChange(moveButtonHorizontally(rows, rowIndex, colIndex, 1))}
                  >
                    <ArrowLeft className="size-4 rtl-flip" />
                  </Button>
                  <Button
                    variant="outline" size="icon" aria-label={t.moveButtonUp}
                    onClick={() => onChange(moveButtonVertically(rows, rowIndex, colIndex, -1))}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="outline" size="icon" aria-label={t.moveButtonDown}
                    onClick={() => onChange(moveButtonVertically(rows, rowIndex, colIndex, 1))}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" aria-label={t.removeButton}
                    className="ms-auto"
                    onClick={() => onChange(removeButton(rows, rowIndex, colIndex))}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* ردیف پر: به‌جای اجازه‌دادن و بعد رد شدن ذخیره سمت سرور، همین‌جا
              جلویش گرفته می‌شود و راه درست پیشنهاد می‌شود. */}
          {canAddToRow(rows, rowIndex) ? (
            <Button
              variant="outline" size="sm" className="mt-3"
              onClick={() => onChange(addButton(rows, rowIndex, emptyButton()))}
            >
              <Plus className="me-1.5 size-3.5" /> {t.addButtonToRow}
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {t.rowAtLimit.replace("{max}", String(MAX_BUTTONS_PER_ROW))}
            </p>
          )}
        </div>
      ))}

      <Button variant="outline" onClick={() => onChange(addRow(rows))}>
        <Plus className="me-1.5 size-4" /> {t.addRow}
      </Button>
    </div>
  );
}
