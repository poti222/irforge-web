/**
 * lib/smsir.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_SMS_OTP_PROMPT — Phase 1: a dedicated sms.ir sender for OTP codes.
 *
 * Why this exists alongside lib/smsSender.ts:
 * smsSender.ts is a generic, config-driven HTTP gateway (any provider, one
 * JSON body template). sms.ir's *Verify* endpoint doesn't fit that shape —
 * it authenticates via a fixed `X-API-KEY` header (not `Authorization:
 * Bearer`), and the body is a fixed `{ mobile, templateId, parameters }`
 * shape, not a freeform template. Verify (پیامک الگومحور/پترن) is sms.ir's
 * transactional-OTP product: it goes out on their service line rather than
 * their promotional line, so it reaches numbers that have opted out of ads —
 * exactly what an OTP needs and what the generic gateway can't guarantee.
 * So this is a small, purpose-built sibling, not a replacement.
 *
 * Same never-throw contract as smsSender.ts/mailSender.ts: a broken or
 * misconfigured provider must never take down whatever auth flow is trying
 * to send a code. Callers only ever see { success, error? }.
 */
import { logger } from "./logger";

export interface SendOtpResult {
  success: boolean;
  error?: string;
}

const VERIFY_URL = "https://api.sms.ir/v1/send/verify";

/**
 * sms.ir issues two kinds of key: Sandbox (no real SMS sent, no cost, the
 * API just simulates a response — for development/testing) and Production
 * (real SMS, real cost). Rather than one var silently meaning different
 * things in different environments, this keeps them as two separate slots
 * and picks one by NODE_ENV — the same shape OTP_SECRET/mail's SMTP_*
 * already use elsewhere in this file's neighbourhood, so there's one mental
 * model for "which secret is active" across the delivery layer.
 *
 * `SMSIR_API_KEY` (no suffix) is accepted as a fallback for either slot —
 * convenient for a single local `.env` where NODE_ENV switching isn't worth
 * juggling two vars, but Railway should set the DEV/PROD ones explicitly so
 * a production deploy can never accidentally boot on a sandbox key.
 */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const isProduction = env.NODE_ENV === "production";
  const scoped = isProduction ? env.SMSIR_API_KEY_PROD : env.SMSIR_API_KEY_DEV;
  return (scoped || env.SMSIR_API_KEY)?.trim() || undefined;
}

export function smsirConfigIssue(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!resolveApiKey(env)) {
    return "SMSIR_API_KEY (or SMSIR_API_KEY_DEV/SMSIR_API_KEY_PROD) is not set — sms.ir OTP delivery is disabled.";
  }
  if (!env.SMSIR_TEMPLATE_ID?.trim()) {
    return "SMSIR_TEMPLATE_ID is not set — sms.ir OTP delivery is disabled.";
  }
  return null;
}

/**
 * sms.ir's Verify endpoint expects a bare Iranian mobile number in local
 * form (`09xxxxxxxxx`), not E.164 — but everywhere else in this codebase
 * (lib/otp.ts's normalizePhone) numbers are stored as `+98...`. Rather than
 * push that format decision onto every caller, this accepts either shape
 * (`+98...`, `98...`, or already-local `09...`) and normalises it here.
 * Returns null for anything that isn't recognisably an Iranian mobile
 * number — callers should treat that as a validation failure, not send.
 */
export function toLocalIranMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  // Iranian mobiles: 9 + 9 digits = 10 digits total once the leading 0/98 is stripped.
  if (!/^9\d{9}$/.test(digits)) return null;
  return "0" + digits;
}

export type FetchFn = typeof fetch;

/**
 * Sends a one-time code via sms.ir's Verify (pattern) API.
 *
 * The parameter name sent in `parameters` ("CODE") must exactly match the
 * variable name defined for the template in the sms.ir panel — there's no
 * way to discover or validate that from the API itself, so it's a hard
 * assumption here. If the panel's template uses a different variable name,
 * change PARAM_NAME below to match.
 */
const PARAM_NAME = "CODE";

export async function sendOtpSms(
  phone: string,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchFn = fetch,
): Promise<SendOtpResult> {
  const configIssue = smsirConfigIssue(env);
  if (configIssue) {
    logger.debug({ phone }, "sendOtpSms skipped: " + configIssue);
    return { success: false, error: "not_configured" };
  }

  const mobile = toLocalIranMobile(phone);
  if (!mobile) {
    logger.warn({ phone }, "sendOtpSms: not a recognisable Iranian mobile number");
    return { success: false, error: "invalid_phone" };
  }

  const apiKey = resolveApiKey(env) as string;
  const templateId = Number(env.SMSIR_TEMPLATE_ID);
  if (!Number.isFinite(templateId)) {
    logger.warn({ templateId: env.SMSIR_TEMPLATE_ID }, "sendOtpSms: SMSIR_TEMPLATE_ID is not a number");
    return { success: false, error: "not_configured" };
  }

  try {
    const res = await fetchFn(VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        mobile,
        templateId,
        parameters: [{ name: PARAM_NAME, value: code }],
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, phone }, "sendOtpSms: sms.ir returned a non-2xx status");
      return { success: false, error: `http_${res.status}` };
    }

    // sms.ir often returns HTTP 200 even for a logical failure (insufficient
    // credit, invalid number, an unapproved/rejected template, a bad key) —
    // the real result lives in the JSON body's `status` field, where 1 means
    // success. Log the provider's own message for debugging but never hand
    // it back to the caller/frontend verbatim.
    const body = (await res.json().catch(() => null)) as { status?: number; message?: string } | null;
    if (!body || body.status !== 1) {
      logger.warn({ phone, status: body?.status, message: body?.message }, "sendOtpSms: sms.ir reported failure");
      return { success: false, error: `api_status_${body?.status ?? "unknown"}` };
    }

    return { success: true };
  } catch (err) {
    logger.warn({ err, phone }, "sendOtpSms failed (non-fatal)");
    return { success: false, error: "request_failed" };
  }
}
