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
 * swap out.
 *
 * sms.ir (below, `sendViaSmsIr`) is exactly the "doesn't fit a single
 * templated JSON body" case the header above always anticipated: it
 * authenticates with an `x-api-key` header (not `Authorization: Bearer`),
 * and its compliant OTP path (`/v1/send/verify`) doesn't take free text at
 * all — the message wording lives in a pre-approved template on sms.ir's
 * own panel, and the request only supplies the template id plus the
 * {name, value} parameters (the code) that fill its placeholders. That is
 * a different shape than "any {to, text} gateway", so it gets its own
 * adapter instead of being forced through fillTemplate. Selected via
 * SMS_PROVIDER=sms.ir; every other value keeps using the generic path.
 *
 * Same never-throw contract as the rest of the delivery layer.
 */
import { logger } from "./logger";

export interface SmsMessage {
  to: string;
  text: string;
  /**
   * The raw OTP code, when this message *is* one — sms.ir's verify API
   * (and any other template-based provider) sends this as a template
   * parameter, never as part of a free-text body. Optional because most
   * callers (and every generic-gateway send) only ever have `text`.
   */
  code?: string;
}

export interface DeliveryResult {
  ok: boolean;
  provider: string;
  error?: string;
}

export function smsConfigIssue(env: NodeJS.ProcessEnv = process.env): string | null {
  if ((env.SMS_PROVIDER || "").trim().toLowerCase() === "sms.ir") {
    if (!env.SMS_IR_API_KEY?.trim()) return "SMS_IR_API_KEY is not set — SMS delivery is disabled.";
    if (!env.SMS_IR_TEMPLATE_ID?.trim() && !env.SMS_IR_LINE_NUMBER?.trim()) {
      return "Neither SMS_IR_TEMPLATE_ID nor SMS_IR_LINE_NUMBER is set — sms.ir needs one of the two to know how to send.";
    }
    return null;
  }
  if (!env.SMS_GATEWAY_URL?.trim()) return "SMS_GATEWAY_URL is not set — SMS delivery is disabled.";
  return null;
}

const SMS_IR_VERIFY_URL = "https://api.sms.ir/v1/send/verify";
const SMS_IR_BULK_URL = "https://api.sms.ir/v1/send/bulk";

/**
 * sms.ir has two send shapes and this picks whichever the operator has
 * configured:
 *   - SMS_IR_TEMPLATE_ID set → `/v1/send/verify`, the compliant OTP path.
 *     Requires a template already approved on the sms.ir panel with one
 *     placeholder (named SMS_IR_TEMPLATE_PARAM, default "Code"); only
 *     `msg.code` (falling back to `msg.text` for a non-OTP caller) is
 *     ever sent — never the composed sentence, since the wording is the
 *     template's job, not this code's.
 *   - otherwise, SMS_IR_LINE_NUMBER set → `/v1/send/bulk`, plain free text
 *     from a dedicated line. Works for any message, but plain OTP text is
 *     more likely to be spam-filtered than a verify template in Iran.
 * Neither set → not_configured, same contract as the generic path.
 */
async function sendViaSmsIr(
  msg: SmsMessage,
  env: NodeJS.ProcessEnv,
  fetchFn: FetchFn,
): Promise<DeliveryResult> {
  const apiKey = env.SMS_IR_API_KEY?.trim();
  if (!apiKey) {
    logger.debug({ to: msg.to }, "sendViaSmsIr skipped: SMS_IR_API_KEY not configured");
    return { ok: false, provider: "sms.ir", error: "not_configured" };
  }

  const templateId = env.SMS_IR_TEMPLATE_ID?.trim();
  const lineNumber = env.SMS_IR_LINE_NUMBER?.trim();
  if (!templateId && !lineNumber) {
    logger.debug({ to: msg.to }, "sendViaSmsIr skipped: neither SMS_IR_TEMPLATE_ID nor SMS_IR_LINE_NUMBER configured");
    return { ok: false, provider: "sms.ir", error: "not_configured" };
  }

  const url = templateId ? SMS_IR_VERIFY_URL : SMS_IR_BULK_URL;
  const body = templateId
    ? {
        mobile: msg.to,
        templateId: Number(templateId),
        parameters: [{ name: env.SMS_IR_TEMPLATE_PARAM?.trim() || "Code", value: msg.code ?? msg.text }],
      }
    : { lineNumber, messageText: msg.text, mobiles: [msg.to] };

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, to: msg.to }, "sendViaSmsIr: gateway returned a non-2xx status");
      return { ok: false, provider: "sms.ir", error: `http_${res.status}` };
    }
    // sms.ir's own success envelope is `{status: 1, ...}` — anything else
    // (e.g. `{status: <errorCode>, message: "..."}`) is a 200 that still
    // failed to actually queue the message (bad templateId, unverified
    // mobile format, insufficient credit, …).
    const data = (await res.json().catch(() => null)) as { status?: number; message?: string } | null;
    if (data && data.status !== 1) {
      logger.warn({ to: msg.to, smsIrStatus: data.status, smsIrMessage: data.message }, "sendViaSmsIr: sms.ir reported failure");
      return { ok: false, provider: "sms.ir", error: `smsir_${data.status ?? "unknown"}` };
    }
    return { ok: true, provider: "sms.ir" };
  } catch (err) {
    logger.warn({ err, to: msg.to }, "sendViaSmsIr failed (non-fatal)");
    return { ok: false, provider: "sms.ir", error: "request_failed" };
  }
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
  if ((env.SMS_PROVIDER || "").trim().toLowerCase() === "sms.ir") {
    return sendViaSmsIr(msg, env, fetchFn);
  }

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
