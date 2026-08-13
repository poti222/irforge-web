/**
 * settings/api.ts — هوک‌های react-query برای اندپوینت‌های `botSettings.ts`.
 *
 * عمداً با `customFetch` + هوک دستی نوشته شده، نه با کلاینت تولیدشده‌ی orval:
 * این اندپوینت‌ها در `openapi.yaml` نیستند و اضافه‌کردنشان یعنی regenerate کردن
 * کل کلاینت. همان الگویی که `regenerate-admin-code` و `telegram-profile` دارند.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

// ─── شکل داده (آینه‌ی api-server/src/lib/botTypes.ts) ────────────────────────

export type WorkingHours = {
  enabled: boolean;
  open_time: string;
  close_time: string;
  /** 0=دوشنبه … 6=یکشنبه — دقیقاً قرارداد `models.py`. */
  days: number[];
  closed_message: string;
};

export type AntiFlood = {
  enabled: boolean;
  max_messages: number;
  interval_seconds: number;
  ban_duration_seconds: number;
  warn_message: string;
};

export type BotSettings = {
  language: string;
  welcome_msg: string;
  welcome_enabled: boolean;
  error_msg: string;
  not_found_msg: string;
  panel_inactive_msg: string;
  banned_msg: string;
  maintenance_msg: string;
  watermark: string;
  watermark_enabled: boolean;
  maintenance: boolean;
  force_join_channels: string[];
  force_join_message: string;
  working_hours: WorkingHours;
  anti_flood: AntiFlood;
  home_panel_id: string | null;
  support_username: string;
  support_message: string;
  currency: string;
  payment_info: string;
  order_confirm_msg: string;
  order_reject_msg: string;
  order_track_msg: string;
  updated_at: string;
};

export type SettingsEnvelope = { settings: BotSettings; cacheBust: boolean };

export const botSettingsKey = (botId: string) => ["bot-settings", botId] as const;

/** پیام خطای فارسیِ سرور را از بدنه‌ی پاسخ بیرون می‌کشد. */
export function apiErrorMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

/** کد خطای ساختاریافته‌ی سرور (`entity_on_postgres`, `no_sheet`, ...). */
export function apiErrorCode(err: any): string | null {
  return err?.data?.code ?? null;
}

// ─── تنظیمات ────────────────────────────────────────────────────────────────

export function useBotSettings(botId: string) {
  return useQuery({
    queryKey: botSettingsKey(botId),
    queryFn: () => customFetch<SettingsEnvelope>(`/api/bots/${botId}/settings`),
  });
}

export function usePatchBotSettings(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<BotSettings>) =>
      customFetch<SettingsEnvelope>(`/api/bots/${botId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => qc.setQueryData(botSettingsKey(botId), data),
  });
}

// ─── کانال‌های عضویت اجباری ─────────────────────────────────────────────────

export function useAddForceJoinChannel(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: string) =>
      customFetch<{ channels: string[] }>(`/api/bots/${botId}/settings/channels`, {
        method: "POST",
        body: JSON.stringify({ channel }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: botSettingsKey(botId) }),
  });
}

export function useRemoveForceJoinChannel(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (index: number) =>
      customFetch<{ channels: string[] }>(`/api/bots/${botId}/settings/channels/${index}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: botSettingsKey(botId) }),
  });
}

// ─── ساعت کاری / آنتی‌فلاد ──────────────────────────────────────────────────

export function useSaveWorkingHours(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workingHours: WorkingHours) =>
      customFetch<{ working_hours: WorkingHours }>(`/api/bots/${botId}/settings/working-hours`, {
        method: "PUT",
        body: JSON.stringify(workingHours),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: botSettingsKey(botId) }),
  });
}

export function useSaveAntiFlood(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (antiFlood: AntiFlood) =>
      customFetch<{ anti_flood: AntiFlood }>(`/api/bots/${botId}/settings/anti-flood`, {
        method: "PUT",
        body: JSON.stringify(antiFlood),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: botSettingsKey(botId) }),
  });
}
