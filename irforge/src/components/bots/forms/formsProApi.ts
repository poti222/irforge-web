/**
 * forms/formsProApi.ts — هوک‌هایِ react-query برایِ `routes/botFormsPro.ts`.
 *
 * فقط‌خواندنی، عمداً: ساختن/ویرایشِ سؤال‌هایِ forms_pro همچنان از کنسولِ
 * ادمینِ بات است (`plugins/forms_pro/handlers.py`) — این‌جا فقط آرشیوِ
 * پاسخ‌هایی که بات جمع کرده را نشان می‌دهد
 * (IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT بخشِ ۲).
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type FormsProQuestion = {
  id: number;
  label: string;
  options?: string[];
  allow_custom?: boolean;
};

export type FormsProForm = {
  id: string;
  title: string;
  questions: FormsProQuestion[];
  is_open: boolean;
  created_at?: string;
  question_count: number;
  submission_count: number;
};

export type FormsProSubmission = {
  id: string;
  form_id: string;
  user_id: string;
  username?: string;
  answers: string[];
  created_at?: string;
};

export function apiErrorMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
export function apiErrorCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function useFormsProForms(botId: string) {
  return useQuery({
    queryKey: ["bot-formspro-forms", botId] as const,
    queryFn: () => customFetch<{ forms: FormsProForm[] }>(`/api/bots/${botId}/formspro/forms`),
  });
}

export function useFormsProSubmissions(botId: string, formId: string | null, search: string) {
  return useQuery({
    queryKey: ["bot-formspro-submissions", botId, formId, search] as const,
    queryFn: () =>
      customFetch<{ form: FormsProForm; submissions: FormsProSubmission[] }>(
        `/api/bots/${botId}/formspro/forms/${formId}/submissions?search=${encodeURIComponent(search)}`,
      ),
    enabled: Boolean(formId),
  });
}
