/**
 * FormFlowCard.tsx — «جریان و اتصال» یک فرم: پنلِ والد، زمانِ نمایش (دستی /
 * بعد از پرداخت)، تأییدِ ادمین و کارِ بعدی (رفتن به پنل، باز شدنِ لینک، فرمِ
 * بعدی یا فقط یک پیام).
 *
 * منطقِ اجرا سمتِ بات است (`handlers/form_builder.py::_run_followup`,
 * `cb_form_approval`, `send_forms_after_payment`)؛ اینجا فقط تنظیمات ذخیره می‌شود.
 */
import { GitBranch } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import type { Panel } from "../panels/api";
import type { BotForm } from "./api";

const NONE = "__none__";

/** آیا تنظیمِ «کارِ بعدی» ناقص/نامعتبر است؟ (برای غیرفعال کردنِ دکمه‌ی ذخیره) */
export function flowInvalid(draft: BotForm): "target" | "url" | null {
  const a = draft.on_complete_action;
  if ((a === "panel" || a === "form") && !draft.on_complete_value) return "target";
  if (a === "url" && !/^(https?:\/\/|tg:\/\/)\S+$/i.test(draft.on_complete_value.trim())) return "url";
  return null;
}

export function FormFlowCard({
  draft,
  setDraft,
  panels,
  forms,
}: {
  draft: BotForm;
  setDraft: (fn: (p: BotForm) => BotForm) => void;
  panels: Panel[];
  forms: BotForm[];
}) {
  const t = useT("botForms");
  const problem = flowInvalid(draft);
  const action = draft.on_complete_action;
  const otherForms = forms.filter((f) => f.id !== draft.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4" /> {t.flowTitle}
        </CardTitle>
        <CardDescription>{t.flowDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t.parentPanelLabel}</Label>
            <Select
              value={draft.parent_panel_id || NONE}
              onValueChange={(v) => setDraft((p) => ({ ...p, parent_panel_id: v === NONE ? "" : v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t.parentPanelNone}</SelectItem>
                {panels.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title || p.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t.parentPanelHint}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t.triggerLabel}</Label>
            <Select value={draft.trigger || "manual"} onValueChange={(v) => setDraft((p) => ({ ...p, trigger: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">{t.triggerManual}</SelectItem>
                <SelectItem value="after_payment">{t.triggerAfterPayment}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {draft.trigger === "after_payment" ? t.triggerAfterPaymentHint : t.triggerManualHint}
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="form-approval">{t.requireApproval}</Label>
            <p className="text-xs text-muted-foreground">{t.requireApprovalHint}</p>
          </div>
          <Switch
            id="form-approval"
            checked={draft.require_approval}
            onCheckedChange={(v) => setDraft((p) => ({ ...p, require_approval: v }))}
          />
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label>{draft.require_approval ? t.nextActionLabelApproved : t.nextActionLabel}</Label>
            <Select
              value={action || NONE}
              onValueChange={(v) =>
                setDraft((p) => ({
                  ...p,
                  on_complete_action: v === NONE ? "" : v,
                  on_complete_value: "",
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t.nextNone}</SelectItem>
                <SelectItem value="panel">{t.nextPanel}</SelectItem>
                <SelectItem value="url">{t.nextUrl}</SelectItem>
                <SelectItem value="form">{t.nextForm}</SelectItem>
                <SelectItem value="message">{t.nextMessage}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action === "panel" && (
            <Select
              value={draft.on_complete_value || NONE}
              onValueChange={(v) => setDraft((p) => ({ ...p, on_complete_value: v === NONE ? "" : v }))}
            >
              <SelectTrigger aria-invalid={problem === "target" || undefined}><SelectValue placeholder={t.nextPickPanel} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t.nextPickPanel}</SelectItem>
                {panels.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title || p.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {action === "form" && (
            <Select
              value={draft.on_complete_value || NONE}
              onValueChange={(v) => setDraft((p) => ({ ...p, on_complete_value: v === NONE ? "" : v }))}
            >
              <SelectTrigger aria-invalid={problem === "target" || undefined}><SelectValue placeholder={t.nextPickForm} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t.nextPickForm}</SelectItem>
                {otherForms.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.title || f.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {action === "url" && (
            <Input
              dir="ltr"
              placeholder="https://example.com/..."
              value={draft.on_complete_value}
              aria-invalid={problem === "url" || undefined}
              onChange={(e) => setDraft((p) => ({ ...p, on_complete_value: e.target.value }))}
            />
          )}

          {problem && (
            <p className="text-sm text-destructive">{problem === "url" ? t.errorNextUrl : t.errorNextTarget}</p>
          )}

          {action !== "" && (
            <div className="space-y-1.5">
              <Label htmlFor="form-next-msg">{t.nextMessageLabel}</Label>
              <Textarea
                id="form-next-msg"
                rows={2}
                value={draft.on_complete_message}
                onChange={(e) => setDraft((p) => ({ ...p, on_complete_message: e.target.value }))}
              />
            </div>
          )}

          {draft.require_approval && (
            <div className="space-y-1.5">
              <Label htmlFor="form-reject-msg">{t.rejectMessageLabel}</Label>
              <Textarea
                id="form-reject-msg"
                rows={2}
                placeholder={t.rejectMessagePlaceholder}
                value={draft.reject_message}
                onChange={(e) => setDraft((p) => ({ ...p, reject_message: e.target.value }))}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
