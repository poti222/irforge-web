/**
 * settings/cardChannelsApi.ts — هوک‌های react-query برای «کارت‌به‌کارتِ خودکار»
 * (`api-server/src/routes/botPaymentChannels.ts`، فاز ۷). همان الگوی `api.ts`: `customFetch` + هوکِ دستی
 * (این اندپوینت‌ها در openapi.yaml نیستند).
 *
 * ⚠️ secret (`smsSecret`) فقط در پاسخِ ساخت/چرخش می‌آید. عمداً **هرگز** در cacheِ react-query نمی‌ماند:
 * `onSuccess` فقط فهرست را invalidate می‌کند و خودِ پاسخ فقط به فراخواننده می‌رسد (که در stateِ محلی
 * نگهش می‌دارد و با بستنِ دیالوگ پاک می‌کند).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type ChannelKind = "card_manual" | "fixed_link" | "open_link";

export type ChannelHealth =
  | { status: "never"; lastSmsAt: null }
  | { status: "ok" | "stale"; lastSmsAt: string; hoursSince: number };

export type CardChannel = {
  id: string;
  kind: ChannelKind;
  cardMasked: string | null;
  holderName: string | null;
  bankName: string | null;
  paymentUrl: string | null;
  minAmountToman: number;
  senderAllowlist: string[];
  bankParser: string;
  active: boolean;
  lastSmsAt: string | null;
  health: ChannelHealth;
  activeRequests: number;
  webhookUrl: string;
  createdAt: string;
};

export type CardChannelsEnvelope = {
  channels: CardChannel[];
  limits: { maxChannels: number; pro: boolean };
  staleHours: number;
  publicUrlConfigured: boolean;
};

export type CardChannelForm = {
  kind: ChannelKind;
  cardNumber: string;
  holderName: string;
  bankName: string;
  paymentUrl: string;
  minAmountToman: number;
  senderAllowlist: string[];
  bankParser: string;
  active?: boolean;
};

export type TestSmsResult = {
  text: string;
  direction: string;
  amountRial: number | null;
  parsedOk: boolean;
  expectedAmountRial: number;
  matchesExpected: boolean;
};

export type SmsLogEntry = {
  id: string;
  receivedAt: string;
  sender: string | null;
  direction: string;
  amountToman: number | null;
  parsedOk: boolean;
  status: "unmatched" | "matched" | "ambiguous" | "ignored";
  preview: string;
  isTest: boolean;
};

export type CardGuide = { title: string; text: string; tutorialUrl: string; isDefault: boolean };

export const cardChannelsKey = (botId: string) => ["card-channels", botId] as const;
export const cardSmsLogKey = (botId: string, channelId: string) => ["card-channels", botId, channelId, "sms-log"] as const;
export const CARD_GUIDE_QUERY_KEY = ["card-autoconfirm-guide"] as const;

/** «botId»ِ ویژه: کانال‌های خودِ پلتفرم (شارژ کیف‌پولِ سایت) از APIِ سوپرادمین. */
export const PLATFORM_SCOPE = "__platform__";
const base = (botId: string) =>
  botId === PLATFORM_SCOPE ? "/api/admin/card-autoconfirm/platform-channels" : `/api/bots/${botId}/payment-channels`;

export function useCardChannels(botId: string) {
  return useQuery({
    queryKey: cardChannelsKey(botId),
    queryFn: () => customFetch<CardChannelsEnvelope>(base(botId)),
  });
}

export function useCreateCardChannel(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: CardChannelForm) =>
      customFetch<{ channel: CardChannel; smsSecret: string }>(base(botId), { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cardChannelsKey(botId) }),
  });
}

export function useUpdateCardChannel(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channelId: string; patch: Partial<CardChannelForm> }) =>
      customFetch<{ channel: CardChannel }>(`${base(botId)}/${v.channelId}`, { method: "PATCH", body: JSON.stringify(v.patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cardChannelsKey(botId) }),
  });
}

export function useRotateCardSecret(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      customFetch<{ smsSecret: string; channel: CardChannel }>(`${base(botId)}/${channelId}/rotate-secret`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cardChannelsKey(botId) }),
  });
}

export function useDeleteCardChannel(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => customFetch<{ ok: true }>(`${base(botId)}/${channelId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cardChannelsKey(botId) }),
  });
}

export function useTestCardSms(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      customFetch<{ result: TestSmsResult }>(`${base(botId)}/${channelId}/test-sms`, { method: "POST" }),
    onSuccess: (_d, channelId) => qc.invalidateQueries({ queryKey: cardSmsLogKey(botId, channelId) }),
  });
}

export function useCardSmsLog(botId: string, channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: cardSmsLogKey(botId, channelId),
    queryFn: () =>
      customFetch<{ entries: SmsLogEntry[]; health: ChannelHealth; staleHours: number }>(`${base(botId)}/${channelId}/sms-log?limit=20`),
    enabled,
    // «آخرین پیامک دریافتی» تازه بماند تا فروشنده هنگامِ آزمایشِ گوشی نتیجه را ببیند.
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function useCardGuide() {
  return useQuery({
    queryKey: CARD_GUIDE_QUERY_KEY,
    queryFn: () => customFetch<CardGuide>("/api/card-autoconfirm-guide"),
    staleTime: 5 * 60_000,
  });
}

export function useSaveCardGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: { title: string; text: string; tutorialUrl: string }) =>
      customFetch<CardGuide>("/api/admin/card-autoconfirm-guide", { method: "PUT", body: JSON.stringify(g) }),
    onSuccess: (data) => qc.setQueryData(CARD_GUIDE_QUERY_KEY, data),
  });
}
