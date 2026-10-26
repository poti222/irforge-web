import { customFetch } from "@workspace/api-client-react";

/**
 * lib/discord-bots-api.ts — انواع و هِلپرهای API بخش «بات‌ساز دیسکورد» (`/api/discord-bots`).
 * مثل `schools-api.ts` مستقیم با `customFetch` کار می‌کند (دامنه‌ی تازه، بیرون از openapi.yaml).
 * منبعِ حقیقتِ اکشن‌ها/رویدادها `GET /api/discord-bots/meta` است (کاتالوگِ مشترک با سرویس پایتون).
 */

export type DiscordRuntimeState = "offline" | "starting" | "online" | "error";

export interface DiscordBotSummary {
  id: string;
  name: string;
  description: string | null;
  tokenSet: boolean;
  botUserId: string | null;
  botUsername: string | null;
  applicationId: string | null;
  inviteUrl: string | null;
  desiredState: "running" | "stopped";
  status: "active" | "suspended";
  runtimeState: DiscordRuntimeState;
  runtimeErrorCode: string | null;
  runtimeError: string | null;
  guildCount: number;
  latencyMs: number | null;
  runtimeHeartbeatAt: string | null;
  runnerStale: boolean;
  blueprintVersion: number;
  counts: { commands: number; events: number };
  privilegedIntents: string[];
  createdAt: string;
  updatedAt: string;
  /** فقط در جزئیاتِ یک بات. */
  blueprint?: DiscordBlueprint;
  /** فقط در پنل ادمین. */
  ownerUsername?: string | null;
  userId?: string;
}

export interface CatalogField {
  key: string;
  label: string;
  labelEn: string;
  type: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
  help?: string;
  helpEn?: string;
  supportsVariables?: boolean;
}
export interface CatalogAction {
  type: string;
  label: string;
  labelEn: string;
  category: "message" | "moderation" | "logic" | "data";
  icon: string;
  botPermissions: string[];
  fields: CatalogField[];
}
export interface CatalogEvent { id: string; label: string; labelEn: string; variables: string[]; needsIntents: string[] }
export interface DiscordCatalog {
  version: number;
  limits: Record<string, number>;
  commandPermissions: string[];
  optionTypes: string[];
  commandTypes: string[];
  activityTypes: string[];
  buttonStyles: string[];
  inputStyles: string[];
  operators: { id: string; label: string; labelEn: string }[];
  events: CatalogEvent[];
  actions: CatalogAction[];
  variableGroups: Record<string, string[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DiscordBlueprint {
  prefix: string;
  status: { type: string; text: string };
  settings: { allow_role_mentions: boolean };
  variables: Record<string, string>;
  commands: any[];
  events: any[];
  /** تنظیمات خامِ ماژول‌های آماده (خوش‌آمدگویی، ری‌اکشن‌رول …)؛ رویدادهای آن‌ها با برچسب `module` در events/commands هستند. */
  modules?: Record<string, any>;
}

export interface DiscordLogEntry { id: number; level: "info" | "warn" | "error"; message: string; at: string }

export class DiscordApiError extends Error {
  code: string;
  errors?: string[];
  constructor(code: string, errors?: string[]) {
    super(code);
    this.code = code;
    this.errors = errors;
  }
}

/** customFetch خطای HTTP را می‌اندازد؛ بدنه‌ی `{error, errors}` را از آن بیرون می‌کشیم. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await customFetch<T>(url, init);
  } catch (e: any) {
    const data = e?.data ?? e?.response?.data ?? null;
    throw new DiscordApiError(String(data?.error ?? e?.message ?? "request_failed"), Array.isArray(data?.errors) ? data.errors : undefined);
  }
}
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const discordMeta = () => call<{ catalog: DiscordCatalog; defaultBlueprint: DiscordBlueprint; maxBotsPerUser: number }>("/api/discord-bots/meta");
export const listDiscordBots = () => call<{ bots: DiscordBotSummary[]; maxBotsPerUser: number }>("/api/discord-bots");
export const getDiscordBot = (id: string) => call<{ bot: DiscordBotSummary }>(`/api/discord-bots/${id}`);
export const createDiscordBot = (input: { name: string; token?: string; description?: string }) =>
  call<{ bot: DiscordBotSummary }>("/api/discord-bots", json("POST", input));
export const patchDiscordBot = (id: string, patch: { name?: string; description?: string | null }) =>
  call<{ bot: DiscordBotSummary }>(`/api/discord-bots/${id}`, json("PATCH", patch));
export const saveDiscordBlueprint = (id: string, blueprint: DiscordBlueprint) =>
  call<{ bot: DiscordBotSummary; unchanged?: boolean }>(`/api/discord-bots/${id}/blueprint`, json("PUT", { blueprint }));
export const setDiscordToken = (id: string, token: string) =>
  call<{ bot: DiscordBotSummary }>(`/api/discord-bots/${id}/token`, json("PUT", { token }));
export const controlDiscordBot = (id: string, action: "start" | "stop" | "restart") =>
  call<{ bot: DiscordBotSummary }>(`/api/discord-bots/${id}/${action}`, json("POST"));
export const deleteDiscordBot = (id: string) => call<{ ok: true }>(`/api/discord-bots/${id}`, json("DELETE"));
export const getDiscordLogs = (id: string, after = 0) => call<{ logs: DiscordLogEntry[] }>(`/api/discord-bots/${id}/logs?after=${after}`);
export const getDiscordKv = (id: string) => call<{ items: { key: string; value: string; updatedAt: string }[] }>(`/api/discord-bots/${id}/kv`);
export const adminListDiscordBots = () => call<{ bots: DiscordBotSummary[] }>("/api/admin/discord-bots");
export const adminSuspendDiscordBot = (id: string, suspended: boolean) =>
  call<{ bot: DiscordBotSummary }>(`/api/admin/discord-bots/${id}/suspend`, json("POST", { suspended }));

/** پیام‌های خطای قابل‌فهم برای کاربر (fa / en). */
export function discordErrorText(code: string, fa: boolean): string {
  const m: Record<string, [string, string]> = {
    token_invalid: ["توکن نامعتبر است. در Discord Developer Portal → Bot → Reset Token بزنید و توکن تازه را وارد کنید.", "Invalid token. In the Discord Developer Portal → Bot → Reset Token, then paste the new one."],
    token_format: ["فرمت توکن درست نیست (باید سه بخشِ جداشده با نقطه باشد).", "Token format looks wrong (three dot-separated parts)."],
    token_in_use: ["این بات قبلاً در IrForge ثبت شده است.", "This bot is already registered on IrForge."],
    token_missing: ["اول توکن بات را ثبت کنید.", "Add the bot token first."],
    discord_unreachable: ["ارتباط با دیسکورد برقرار نشد؛ کمی بعد دوباره تلاش کنید.", "Couldn't reach Discord; try again shortly."],
    bot_limit_reached: ["به سقف تعداد بات دیسکورد رسیده‌اید.", "You've reached the Discord bot limit."],
    blueprint_invalid: ["تنظیمات بات خطا دارند؛ موارد زیر را اصلاح کنید.", "The bot configuration has errors; fix the items below."],
    still_running: ["بات هنوز روشن است؛ دستور توقف ارسال شد. چند ثانیه بعد دوباره حذف کنید.", "The bot is still running; a stop was requested. Try deleting again in a few seconds."],
    bot_suspended: ["این بات توسط مدیریت تعلیق شده است.", "This bot was suspended by an administrator."],
    name_required: ["نام بات را وارد کنید.", "Enter a bot name."],
    invalid_blueprint: ["بلوپرینت نامعتبر است.", "Invalid blueprint."],
    intents_missing: ["Intentهای «Message Content» و «Server Members» در Developer Portal (بخش Bot → Privileged Gateway Intents) فعال نیستند.", "“Message Content” / “Server Members” intents aren't enabled in the Developer Portal (Bot → Privileged Gateway Intents)."],
    token_decrypt: ["خطای داخلی در خواندن توکن؛ لطفاً توکن را دوباره ثبت کنید.", "Internal error reading the token; please re-enter it."],
    no_token: ["توکن ثبت نشده است.", "No token set."],
    crash: ["اتصال بات قطع شد؛ سیستم خودکار دوباره تلاش می‌کند.", "The bot disconnected; it will retry automatically."],
    capacity: ["ظرفیت سرور اجراکننده پر است؛ بعداً تلاش می‌شود.", "The runner is at capacity; will retry later."],
  };
  const hit = m[code];
  return hit ? (fa ? hit[0] : hit[1]) : fa ? "خطای ناشناخته" : "Unknown error";
}
