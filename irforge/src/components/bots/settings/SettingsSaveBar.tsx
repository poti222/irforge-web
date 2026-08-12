/**
 * SettingsSaveBar.tsx — رفتار مشترک همه‌ی تب‌های تنظیمات.
 *
 * هر تب: state محلی + دکمه‌ی «ذخیره» (تا وقتی چیزی عوض نشده disabled) +
 * دکمه‌ی «بازگردانی» + بنر تأخیر کش بعد از ذخیره + پیام روشن برای
 * `409 entity_on_postgres`.
 */
import { Loader2, Save, RotateCcw, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { apiErrorCode, apiErrorMessage } from "./api";

export function SettingsSaveBar({
  dirty,
  saving,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  const t = useT("botSettings");
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <Button onClick={onSave} disabled={!dirty || saving}>
        {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
        {t.save}
      </Button>
      <Button variant="ghost" onClick={onRevert} disabled={!dirty || saving}>
        <RotateCcw className="me-2 h-4 w-4" /> {t.revert}
      </Button>
      {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">{t.unsavedBadge}</span>}
    </div>
  );
}

/**
 * بنر «تغییرات کِی روی بات دیده می‌شود». عدد را حدس نمی‌زند: سرور در پاسخ
 * می‌گوید cache-bust فعال است یا نه، و متن بر همان اساس عوض می‌شود.
 */
export function CachePropagationNotice({ cacheBust }: { cacheBust: boolean }) {
  const t = useT("botSettings");
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{cacheBust ? t.propagationFast : t.propagationSlow}</span>
    </p>
  );
}

/** خطای ذخیره — با پیام مخصوص برای entityهای مهاجرت‌کرده به Postgres. */
export function SettingsError({ error }: { error: unknown }) {
  const t = useT("botSettings");
  if (!error) return null;
  const code = apiErrorCode(error);
  const message =
    code === "entity_on_postgres" ? t.errorOnPostgres : apiErrorMessage(error, t.errorGeneric);
  return (
    <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
