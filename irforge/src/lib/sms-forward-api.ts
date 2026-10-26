import { customFetch } from "@workspace/api-client-react";

/**
 * lib/sms-forward-api.ts — «ارسال پیامک به تلگرام» (`/api/sms-forward`).
 * مثل discord-bots-api.ts مستقیم با `customFetch` کار می‌کند (دامنه‌ی تازه، بیرون از openapi.yaml).
 */

export type SmsForwardVia = "bot" | "userbot" | "both";

export interface SmsForwardAccount {
  publicId: string;
  /** مسیرِ نسبیِ وبهوک؛ آدرسِ کامل = origin + این مسیر */
  webhookPath: string;
  enabled: boolean;
  lastReceivedAt: string | null;
  createdAt: string;
  bot: { configured: boolean; username: string | null };
  userbot: { configured: boolean; label: string | null; available: boolean };
}

export interface SmsForwardRule {
  id: string;
  name: string;
  enabled: boolean;
  senderFilter: string[];
  keyword: string | null;
  via: SmsForwardVia;
  chatRef: string;
  sortOrder: number;
}

export interface SmsForwardLogRow {
  id: string;
  ruleId: string | null;
  ruleName: string | null;
  receivedAt: string;
  sender: string | null;
  textLen: number;
  status: "sent" | "failed" | "no_rule" | "duplicate";
  via: string | null;
  error: string | null;
}

export interface SmsForwardOverview {
  account: SmsForwardAccount | null;
  rules: SmsForwardRule[];
  log: SmsForwardLogRow[];
}

export type SmsForwardRuleInput = Partial<Omit<SmsForwardRule, "id" | "sortOrder">>;

export class SmsForwardApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** customFetch خطای HTTP را می‌اندازد؛ پیامِ فارسیِ سرور (`error`) را بیرون می‌کشیم. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await customFetch<T>(url, init);
  } catch (e: any) {
    const data = e?.data ?? e?.response?.data ?? null;
    throw new SmsForwardApiError(String(data?.error ?? e?.message ?? "request_failed"), String(data?.code ?? "request_failed"));
  }
}
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const B = "/api/sms-forward";
export const getSmsForwardOverview = () => call<SmsForwardOverview>(`${B}/overview`);
export const createSmsForwardAccount = () => call<{ account: SmsForwardAccount; secret: string }>(`${B}/account`, json("POST"));
export const rotateSmsForwardSecret = () => call<{ secret: string }>(`${B}/account/rotate-secret`, json("POST"));
export const setSmsForwardEnabled = (enabled: boolean) => call<{ ok: true }>(`${B}/account`, json("PATCH", { enabled }));
export const deleteSmsForwardAccount = () => call<{ ok: true }>(`${B}/account`, json("DELETE"));
export const setSmsForwardBot = (token: string) => call<{ ok: true; username: string }>(`${B}/bot`, json("PUT", { token }));
export const deleteSmsForwardBot = () => call<{ ok: true }>(`${B}/bot`, json("DELETE"));
export const smsForwardUserbotSendCode = (phone: string) => call<{ ok: true; codeViaApp: boolean }>(`${B}/userbot/send-code`, json("POST", { phone }));
export const smsForwardUserbotVerify = (code: string, password?: string) =>
  call<{ ok: boolean; label?: string; passwordNeeded?: boolean }>(`${B}/userbot/verify`, json("POST", { code, password }));
export const deleteSmsForwardUserbot = () => call<{ ok: true }>(`${B}/userbot`, json("DELETE"));
export const createSmsForwardRule = (input: SmsForwardRuleInput) => call<{ rule: SmsForwardRule }>(`${B}/rules`, json("POST", input));
export const updateSmsForwardRule = (id: string, input: SmsForwardRuleInput) => call<{ rule: SmsForwardRule }>(`${B}/rules/${id}`, json("PATCH", input));
export const deleteSmsForwardRule = (id: string) => call<{ ok: true }>(`${B}/rules/${id}`, json("DELETE"));
export const testSmsForwardRule = (id: string) => call<{ ok: boolean; via: string | null; error: string | null }>(`${B}/rules/${id}/test`, json("POST"));
