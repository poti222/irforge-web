/**
 * lib/mailSender.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 12 — the email half of the delivery layer.
 *
 * (Not to be confused with lib/email.ts, which is address normalisation/
 * uniqueness helpers and has never sent anything.)
 *
 * Plain SMTP via nodemailer rather than a specific vendor SDK: it is the
 * one "provider" every mail service on earth speaks — Gmail, SES, SendGrid,
 * Mailgun, Postmark, a self-hosted Postfix — so "pluggable" here just means
 * pointing SMTP_HOST at whichever one the operator already has, with no
 * vendor-specific code to swap out later.
 *
 * Same never-throw contract as lib/telegram.ts's sendTelegramMessage and
 * lib/registrationBot.ts's senders: a broken mail provider must not break
 * whatever flow is trying to notify a user, and the caller only cares
 * about ok/error, never a raw exception.
 */
import nodemailer from "nodemailer";
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface DeliveryResult {
  ok: boolean;
  provider: string;
  error?: string;
}

export interface MailTransport {
  sendMail(opts: { from: string; to: string; subject: string; html: string; text?: string }): Promise<unknown>;
}

/**
 * Missing SMTP_HOST just means "email delivery isn't configured on this
 * deploy" — not a boot failure, unlike OTP_SECRET/CORS_ORIGIN: unlike
 * those, nothing about the platform's core operation depends on email
 * actually being deliverable (Telegram remains the primary channel).
 */
export function mailConfigIssue(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.SMTP_HOST?.trim()) return "SMTP_HOST is not set — email delivery is disabled.";
  return null;
}

let _cached: MailTransport | null | undefined;

/**
 * nodemailer's built-in defaults for these are all 2 minutes
 * (connectionTimeout, greetingTimeout, socketTimeout = 120000ms each), which
 * is exactly what produced the 125s hang: a SMTP_HOST that TCP-connects (or
 * looks like it will) but never actually answers leaves nodemailer waiting
 * the full 2 minutes per phase before it gives up. Overriding all three to a
 * short, fail-fast value means a dead/unreachable/firewalled SMTP host turns
 * into a quick error instead of a multi-minute hang on the request.
 * Configurable via SMTP_TIMEOUT_MS in case a slow-but-working provider needs
 * more headroom.
 */
const DEFAULT_SMTP_TIMEOUT_MS = 10_000;

function smtpTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.SMTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SMTP_TIMEOUT_MS;
}

function realTransport(env: NodeJS.ProcessEnv = process.env): MailTransport | null {
  if (_cached !== undefined) return _cached;
  if (mailConfigIssue(env)) {
    _cached = null;
    return _cached;
  }
  const timeout = smtpTimeoutMs(env);
  _cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  }) as unknown as MailTransport;
  return _cached;
}

/** Test-only: clears the cached transport so a changed env is picked up. */
export function _resetMailTransportCache(): void {
  _cached = undefined;
}

export async function sendEmail(
  msg: EmailMessage,
  getTransport: (env?: NodeJS.ProcessEnv) => MailTransport | null = realTransport,
): Promise<DeliveryResult> {
  const transport = getTransport();
  if (!transport) {
    logger.debug({ to: msg.to }, "sendEmail skipped: SMTP not configured");
    return { ok: false, provider: "none", error: "not_configured" };
  }
  const hardTimeoutMs = smtpTimeoutMs(process.env) + 2_000; // small margin over the transport's own timeout
  try {
    await Promise.race([
      transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@localhost",
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("SMTP send timed out"), { code: "ETIMEDOUT_GUARD" })), hardTimeoutMs),
      ),
    ]);
    return { ok: true, provider: "smtp" };
  } catch (err) {
    // logger.warn({ err }) alone often prints as an empty object depending on the
    // logger's serializer, which is why this failure mode looked silent in
    // production. Pull out message/code explicitly so the real SMTP rejection
    // (e.g. Resend's "domain not verified") actually shows up in the logs.
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string; responseCode?: number })?.code;
    const responseCode = (err as { code?: string; responseCode?: number })?.responseCode;
    logger.warn({ message, code, responseCode, to: msg.to }, "sendEmail failed (non-fatal)");
    return { ok: false, provider: "smtp", error: message };
  }
}
