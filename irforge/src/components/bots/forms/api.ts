/**
 * forms/api.ts — هوک‌های react-query برای اندپوینت‌های `botForms.ts`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

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
  is_active: boolean;
  notify_admin: boolean;
  allow_edit: boolean;
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

export function useForms(botId: string) {
  return useQuery({
    queryKey: formsKey(botId),
    queryFn: () => customFetch<{ forms: BotForm[]; count: number }>(`/api/bots/${botId}/forms`),
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
