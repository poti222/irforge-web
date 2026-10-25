/**
 * forms/api.ts — هوک‌های react-query برای اندپوینت‌های `botForms.ts`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { PanelButton } from "@/lib/panel-buttons";

export const FORM_FIELD_TYPES = [
  "text", "number", "phone", "email", "photo", "location", "select",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  validation_regex: string;
  error_message: string;
  order: number;
};

export type BotForm = {
  id: string;
  title: string;
  fields: FormField[];
  destination_group: string;
  destination_admin_ids: string[];
  thank_you_message: string;
  /** اختیاری: مدیا و دکمه‌های پیام تشکر — دقیقاً همان شکل PanelButton، تا
   * ButtonBuilder.tsx بدون تغییر اینجا هم استفاده شود. */
  thank_you_media_file_id: string;
  thank_you_media_type: string; // "" | photo | video | audio | document
  thank_you_buttons: PanelButton[];
  is_active: boolean;
  notify_admin: boolean;
  allow_edit: boolean;
  /** پنلِ والد ("" = بدون والد). */
  parent_panel_id: string;
  /** manual = با دکمه · after_payment = خودکار بعد از تأییدِ پرداخت. */
  trigger: "manual" | "after_payment" | string;
  require_approval: boolean;
  /** کارِ بعدی بعد از ثبت (یا بعد از تأییدِ ادمین): "" | panel | url | form | message */
  on_complete_action: "" | "panel" | "url" | "form" | "message" | string;
  on_complete_value: string;
  on_complete_message: string;
  reject_message: string;
  created_at: string;
};

export type FormReferences = {
  panels: Array<{ id: string; title: string }>;
  buttons: Array<{ panelId: string; panelTitle: string; label: string }>;
  commands: Array<{ command: string }>;
};

export const formsKey = (botId: string) => ["bot-forms", botId] as const;
export const formRefsKey = (botId: string, formId: string) => ["bot-form-refs", botId, formId] as const;

export function apiErrorMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
export function apiErrorCode(err: any): string | null {
  return err?.data?.code ?? null;
}

/** فرم‌های قدیمی فیلدهای «جریان» را ندارند — با پیش‌فرض پر می‌شوند تا UI هرگز undefined نبیند. */
export function withFlowDefaults(f: BotForm): BotForm {
  return {
    ...f,
    parent_panel_id: f.parent_panel_id ?? "",
    trigger: f.trigger || "manual",
    require_approval: Boolean(f.require_approval),
    on_complete_action: f.on_complete_action ?? "",
    on_complete_value: f.on_complete_value ?? "",
    on_complete_message: f.on_complete_message ?? "",
    reject_message: f.reject_message ?? "",
  };
}

export function useForms(botId: string) {
  return useQuery({
    queryKey: formsKey(botId),
    queryFn: () => customFetch<{ forms: BotForm[]; count: number }>(`/api/bots/${botId}/forms`),
    select: (d) => ({ ...d, forms: d.forms.map(withFlowDefaults) }),
  });
}

export function useFormReferences(botId: string, formId: string | null) {
  return useQuery({
    queryKey: formRefsKey(botId, formId ?? ""),
    queryFn: () => customFetch<FormReferences>(`/api/bots/${botId}/forms/${formId}/references`),
    enabled: Boolean(formId),
  });
}

function useInvalidateForms(botId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: formsKey(botId) });
    // انتخابگر فرم در سازنده‌ی دکمه‌ها هم باید تازه شود.
    qc.invalidateQueries({ queryKey: ["bot-form-options", botId] });
  };
}

export function useCreateForm(botId: string) {
  const invalidate = useInvalidateForms(botId);
  return useMutation({
    mutationFn: (body: Partial<BotForm>) =>
      customFetch<{ form: BotForm }>(`/api/bots/${botId}/forms`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateForm(botId: string) {
  const invalidate = useInvalidateForms(botId);
  return useMutation({
    mutationFn: ({ formId, patch }: { formId: string; patch: Partial<BotForm> }) =>
      customFetch<{ form: BotForm }>(`/api/bots/${botId}/forms/${formId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteForm(botId: string) {
  const invalidate = useInvalidateForms(botId);
  return useMutation({
    mutationFn: (formId: string) =>
      customFetch<{ deleted: string }>(`/api/bots/${botId}/forms/${formId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
