/**
 * lib/smsSender.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 12 — the SMS half of the delivery layer.
 *
 * Unlike email, there is no universal "SMTP of SMS" — every gateway (local
 * Iranian providers, Twilio, etc.) has its own bespoke REST shape, and
 * nothing in this codebase or its docs names a specific one to build
 * against. So "pluggable" here is a generic, config-driven HTTP gateway:
 * point SMS_GATEWAY_URL at whatever provider's endpoint, describe its
 * request body once as a JSON template in SMS_GATEWAY_BODY_TEMPLATE, and
 * this fills in {to}/{text}/{apiKey} — no per-provider code to write or
 * swap out. An operator whose gateway doesn't fit a single templated JSON
 * body (rare) can still add a real per-vendor adapter later without
 * touching any caller of sendSms.
 *
 * Same never-throw contract as the rest of the delivery layer.
 */
import { logger } from "./logger";

export interface SmsMessage {
  to: string;
  text: string;
}

export interface DeliveryResult {
  ok: boolean;
  provider: string;
  error?: string;
}

export function smsConfigIssue(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.SMS_GATEWAY_URL?.trim()) return "SMS_GATEWAY_URL is not set — SMS delivery is disabled.";
  return null;
}

/**
 * Fills `{placeholder}` tokens found in string leaves of a parsed JSON
 * template with real values, then re-serialises. Substituting into the
 * parsed *structure* (not the raw template text) means a value containing
 * a quote, backslash, or brace can never corrupt the resulting JSON — the
 * naive alternative (`.replace()` on the template string itself) would
 * silently break the request body the moment `text` needed escaping.
 */
function fillTemplate(node: unknown, values: Record<string, string>): unknown {
  if (typeof node === "string") {
    return node.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? values[key] : whole));
  }
  if (Array.isArray(node)) return node.map((n) => fillTemplate(n, values));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillTemplate(v, values)]));
  }
  return node;
}

const DEFAULT_BODY_TEMPLATE = JSON.stringify({ to: "{to}", text: "{text}", apiKey: "{apiKey}" });

export type FetchFn = typeof fetch;

export async function sendSms(
  msg: SmsMessage,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchFn = fetch,
): Promise<DeliveryResult> {
  const url = env.SMS_GATEWAY_URL?.trim();
  if (!url) {
    logger.debug({ to: msg.to }, "sendSms skipped: SMS_GATEWAY_URL not configured");
    return { ok: false, provider: "none", error: "not_configured" };
  }

  const apiKey = env.SMS_GATEWAY_API_KEY ?? "";
  const method = (env.SMS_GATEWAY_METHOD || "POST").toUpperCase();
  let bodyObj: unknown;
  try {
    bodyObj = fillTemplate(JSON.parse(env.SMS_GATEWAY_BODY_TEMPLATE || DEFAULT_BODY_TEMPLATE), {
      to: msg.to,
      text: msg.text,
      apiKey,
    });
  } catch (err) {
    logger.warn({ err }, "sendSms: SMS_GATEWAY_BODY_TEMPLATE is not valid JSON, using default shape");
    bodyObj = fillTemplate(JSON.parse(DEFAULT_BODY_TEMPLATE), { to: msg.to, text: msg.text, apiKey });
  }

  try {
    const res = await fetchFn(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(bodyObj),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, to: msg.to }, "sendSms: gateway returned a non-2xx status");
      return { ok: false, provider: "http", error: `http_${res.status}` };
    }
    return { ok: true, provider: "http" };
  } catch (err) {
    logger.warn({ err, to: msg.to }, "sendSms failed (non-fatal)");
    return { ok: false, provider: "http", error: "request_failed" };
  }
}
