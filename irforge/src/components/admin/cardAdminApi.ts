/**
 * cardAdminApi.ts — هوک‌های react-query برای «کارت‌به‌کارت خودکار» در پنلِ مدیریت
 * (`api-server/src/routes/adminCardAutoConfirm.ts`، فقط سوپرادمین). کلیدها همه با پیشوندِ ["card-admin"] شروع می‌شوند تا
 * دکمه‌ی «به‌روزرسانی»ِ بالایِ پنل یک‌جا همه را invalidate کند.
 */
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const CARD_ADMIN_KEY = ["card-admin"] as const;
const base = "/api/admin/card-autoconfirm";

export type Scope = "platform" | "bot";
export type Health =
  | { status: "never"; lastSmsAt: null }
  | { status: "ok" | "stale"; lastSmsAt: string; hoursSince: number };

export type AdminOverview = {
  generatedAt: string;
  open: Record<Scope, { queued: number; pending: number; awaitingReview: number }>;
  last24h: { created: number; confirmed: number; confirmedBySms: number; confirmedByAdmin: number; expired: number; rejected: number; canceled: number; confirmedAmountToman: number };
  last7d: { created: number; confirmed: number; confirmedAmountToman: number };
  sms24h: { total: number; matched: number; unmatchedDeposits: number; ambiguous: number; ignored: number; other: number };
  channels: { total: number; active: number; platform: number; bot: number; silent: number };
  attention: { staleReviews: number; stuckEffects: number; ambiguousSms: number; unmatchedDepositsRecent: number; problemEvents24h: number };
  sweeper: null | {
    at: string; expired: number; promoted: number; purgedIgnoredSms: number; purgedEvents: number;
    staleReviewAlerts: number; silentPhoneAlerts: number; stuckEffectAlerts: number; errors: string[];
  };
  legacyMigration: null | { at: string; ok: boolean; message: string };
};

export type AdminChannel = {
  id: string; scope: Scope; botId: string | null; botName: string | null; ownerEmail: string | null; kind: string;
  cardMasked: string | null; holderName: string | null; bankName: string | null; paymentUrl: string | null;
  minAmountToman: number; bankParser: string; senderAllowlist: string[]; active: boolean; lastSmsAt: string | null;
  health: Health; createdAt: string; webhookUrl: string;
  counts: { open: number; confirmed: number; total: number; smsUnmatched: number };
};

export type AdminRequest = {
  id: string; scope: Scope; botId: string | null; botName: string | null; userId: string; userName: string | null; userEmail: string | null;
  purpose: string; orderId: string | null; status: string; baseAmountToman: number; suffixRial: number; finalAmountRial: number;
  channelId: string; channelKind: string; cardMasked: string | null; createdAt: string; expiresAt: string | null; confirmedAt: string | null;
  confirmedBy: string | null; confirmedByAdminId: string | null; rejectReason: string | null; hasReceipt: boolean;
  receiptUploadedAt: string | null; effect: "none" | "pending" | "claimed" | "done"; matchedSmsId: string | null; legacy: boolean;
};

export type AdminSms = {
  id: string; channelId: string; scope: Scope; botId: string | null; botName: string | null; receivedAt: string; ingestedAt: string;
  sender: string | null; direction: string; amountToman: number | null; amountRial: number | null; parsedOk: boolean; status: string;
  preview: string; isTest: boolean; matchedRequestId: string | null;
};

export type AdminEvent = {
  id: string; at: string; level: "info" | "warn" | "error"; kind: string; scope: string | null; botId: string | null;
  channelId: string | null; requestId: string | null; smsId: string | null; actor: string | null; message: string; data: Record<string, unknown>;
};

export type RequestDetail = {
  request: AdminRequest;
  channel: { id: string; kind: string; holderName: string | null; bankName: string | null; cardMasked: string | null; active: boolean; scope: string };
  matchedSms: AdminSms | null;
  candidateSms: AdminSms[];
  events: AdminEvent[];
};

const qs = (o: Record<string, string | number | undefined | null | false>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const useCardOverview = () =>
  useQuery({ queryKey: [...CARD_ADMIN_KEY, "overview"], queryFn: () => customFetch<AdminOverview>(`${base}/overview`), refetchInterval: 30_000 });

export const useAdminChannels = (f: { scope?: string; q?: string; silent?: boolean }) =>
  useQuery({
    queryKey: [...CARD_ADMIN_KEY, "channels", f],
    queryFn: () => customFetch<{ channels: AdminChannel[]; staleHours: number }>(`${base}/channels${qs({ scope: f.scope, q: f.q, silent: f.silent ? 1 : 0 })}`),
  });

export const useAdminRequests = (f: { scope?: string; status?: string; q?: string; channelId?: string }) =>
  useQuery({
    queryKey: [...CARD_ADMIN_KEY, "requests", f],
    queryFn: () => customFetch<{ requests: AdminRequest[] }>(`${base}/requests${qs({ ...f, limit: 100 })}`),
    refetchInterval: 15_000,
  });

export const useRequestDetail = (id: string | null) =>
  useQuery({
    queryKey: [...CARD_ADMIN_KEY, "request", id],
    queryFn: () => customFetch<RequestDetail>(`${base}/requests/${id}`),
    enabled: Boolean(id),
  });

export const useRequestReceipt = (id: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [...CARD_ADMIN_KEY, "receipt", id],
    queryFn: () => customFetch<{ kind: "image" | "telegram_file_id" | "none"; value: string | null; uploadedAt: string | null }>(`${base}/requests/${id}/receipt`),
    enabled: Boolean(id) && enabled,
  });

export const useAdminSms = (f: { scope?: string; status?: string; channelId?: string }) =>
  useQuery({
    queryKey: [...CARD_ADMIN_KEY, "sms", f],
    queryFn: () => customFetch<{ sms: AdminSms[] }>(`${base}/sms${qs({ ...f, limit: 100 })}`),
    refetchInterval: 15_000,
  });

export const useAdminEvents = (f: { level?: string; kind?: string; scope?: string; requestId?: string; channelId?: string }) =>
  useQuery({
    queryKey: [...CARD_ADMIN_KEY, "events", f],
    queryFn: () => customFetch<{ events: AdminEvent[] }>(`${base}/events${qs({ ...f, limit: 150 })}`),
    refetchInterval: 15_000,
  });

function useInvalidating<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: CARD_ADMIN_KEY }) });
}

export const useDecide = () =>
  useInvalidating((v: { id: string; decision: "approve" | "reject"; reason?: string }) =>
    customFetch<{ decided: boolean; request: { id: string; status: string } }>(`${base}/requests/${v.id}/decide`, {
      method: "POST", body: JSON.stringify({ decision: v.decision, reason: v.reason }),
    }));

export const useAssignSms = () =>
  useInvalidating((v: { smsId: string; requestId: string }) =>
    customFetch<{ ok: true }>(`${base}/sms/${v.smsId}/assign`, { method: "POST", body: JSON.stringify({ requestId: v.requestId }) }));

export const useSetChannelActive = () =>
  useInvalidating((v: { id: string; active: boolean; reason?: string }) =>
    customFetch<{ id: string; active: boolean }>(`${base}/channels/${v.id}/active`, { method: "POST", body: JSON.stringify({ active: v.active, reason: v.reason }) }));

export const useSweepNow = () =>
  useInvalidating(() => customFetch<{ report: NonNullable<AdminOverview["sweeper"]> & { skipped?: string } }>(`${base}/sweep`, { method: "POST" }));

export const useRunMigration = () =>
  useInvalidating((v: { dryRun: boolean }) =>
    customFetch<{ report: { ok: boolean; skipped?: string; dryRun: boolean; orphans: { topups: number; sms: number }; topups: { total: number; migrated: number; alreadyMigrated: number } }; markdown: string }>(
      `${base}/migration/run`, { method: "POST", body: JSON.stringify({ dryRun: v.dryRun }) }));
