/**
 * CommandsMenuEditor.tsx — منوی «/»ِ تلگرام، **همان‌طور که الان واقعاً روی تلگرام هست**.
 *
 * لایوباگ ۲۰۲۶-۱۰-۰۶: «بات نوشاذین همه‌یِ کامندها رو خودش اضافه کرده … کامندها رو از بات نمیگیره و تو سایت نشون
 * بده تا حذف یا اضافه یا ترتیب عوض کنی». لیستِ این‌جا از `getMyCommands`ِ تلگرام می‌آید (نه از حدسِ سایت)، پس هر
 * چیزی که روی منو نشسته دیده و قابلِ حذف است؛ هیچ کامندی خودکار اضافه نمی‌شود.
 *
 * state را والد (`CommandsEditor`) نگه می‌دارد چون سوییچ‌هایِ «نمایش در تلگرام»ِ جدول‌هایِ پایین هم همین پیش‌نویس را
 * عوض می‌کنند؛ «ذخیره» کلِ لیست را یک‌جا روی بات و `bot_settings.bot_commands` می‌نویسد.
 */
import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, RadioTower, Save, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { MENU_DESC_MAX, MENU_MAX, moveEntry, removeEntry, setEntryDescription, type MenuEntry } from "./commandsMenu";

export type MenuCandidate = { command: string; description: string; group: "custom" | "core" | "plugin" };

export function CommandsMenuEditor({
  draft,
  onChange,
  dirty,
  live,
  saving,
  onSave,
  onRevert,
  knownCommands,
  candidates,
  onAdd,
}: {
  draft: MenuEntry[];
  onChange: (next: MenuEntry[]) => void;
  dirty: boolean;
  /** منو زنده از تلگرام خوانده شده یا (به‌خاطرِ قطعیِ تلگرام) لیستِ ذخیره‌شده است. */
  live: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
  /** نام‌هایی که سایت می‌شناسد؛ بقیه «فقط روی تلگرام» برچسب می‌خورند. */
  knownCommands: ReadonlySet<string>;
  /** کامندهایی که هنوز در منو نیستند و قابلِ افزودن‌اند. */
  candidates: MenuCandidate[];
  onAdd: (c: MenuCandidate) => void;
}) {
  const t = useT("botCommands");
  // Select کنترل‌نشده است؛ با عوض‌شدنِ key بعد از هر افزودن به حالتِ placeholder برمی‌گردد.
  const [addKey, setAddKey] = useState(0);
  const full = draft.length >= MENU_MAX;

  const groupLabel = (g: MenuCandidate["group"]) =>
    g === "custom" ? t.targetGroupOther : g === "core" ? t.sourceCore : t.sourcePlugin;

  return (
    <Card data-testid="commands-menu-card">
      <CardHeader className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <RadioTower className="size-4" /> {t.menuTitle}
          </CardTitle>
          {live ? (
            <Badge variant="secondary" className="gap-1" data-testid="menu-live-badge">
              <span className="size-1.5 rounded-full bg-emerald-500" /> {t.menuLiveBadge}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600" data-testid="menu-stored-badge">
              <AlertTriangle className="size-3" /> {t.menuStoredBadge}
            </Badge>
          )}
        </div>
        <CardDescription>{t.menuDesc}</CardDescription>
        {!live && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.menuStoredWarn}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {draft.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="menu-empty">
            {t.menuEmpty}
          </p>
        ) : (
          <ol className="space-y-2" data-testid="menu-list">
            {draft.map((m, i) => (
              <li key={m.command} className="flex flex-wrap items-center gap-2 rounded-md border p-2" data-testid={`menu-item-${m.command}`}>
                <code dir="ltr" className="min-w-0 shrink-0 font-mono text-sm">/{m.command}</code>
                {!knownCommands.has(m.command) && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">{t.menuUnknownBadge}</Badge>
                )}
                <Input
                  className="h-8 min-w-40 flex-1"
                  value={m.description}
                  maxLength={MENU_DESC_MAX}
                  aria-label={t.menuItemDescription}
                  placeholder={t.menuItemDescription}
                  onChange={(e) => onChange(setEntryDescription(draft, m.command, e.target.value))}
                />
                <div className="ms-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost" size="icon" className="size-8" aria-label={t.moveCommandUp}
                    disabled={i === 0} onClick={() => onChange(moveEntry(draft, m.command, "up"))}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="size-8" aria-label={t.moveCommandDown}
                    disabled={i === draft.length - 1} onClick={() => onChange(moveEntry(draft, m.command, "down"))}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="size-8" aria-label={t.menuRemoveItem}
                    onClick={() => onChange(removeEntry(draft, m.command))}
                  >
                    <X className="size-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1 sm:max-w-xs">
            <Select
              key={addKey}
              disabled={full || candidates.length === 0}
              onValueChange={(v) => {
                const c = candidates.find((x) => x.command === v);
                if (c) onAdd(c);
                setAddKey((k) => k + 1);
              }}
            >
              <SelectTrigger data-testid="menu-add-select" aria-label={t.menuAddPlaceholder}>
                <SelectValue placeholder={candidates.length === 0 ? t.menuNothingToAdd : t.menuAddPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.command} value={c.command}>
                    <span dir="ltr" className="font-mono">/{c.command}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{groupLabel(c.group)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.length > 0 && (
            <Button variant="outline" size="sm" data-testid="menu-clear" onClick={() => onChange([])}>
              <Trash2 className="me-1.5 size-3.5" /> {t.menuClear}
            </Button>
          )}
          <span className="ms-auto text-xs text-muted-foreground" dir="ltr">{draft.length}/{MENU_MAX}</span>
        </div>

        {dirty && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2" data-testid="menu-unsaved">
            <p className="min-w-0 flex-1 text-xs">{t.menuUnsaved}</p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={saving} onClick={onRevert}>
                <Undo2 className="me-1.5 size-3.5" /> {t.menuRevert}
              </Button>
              <Button size="sm" disabled={saving} onClick={onSave} data-testid="menu-save">
                {saving ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Save className="me-1.5 size-3.5" />}
                {t.menuSave}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
