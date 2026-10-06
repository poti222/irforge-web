/**
 * lib/dashboard-attention.ts — IRFORGE_PROMPT_V3 Phase 49
 *
 * The dashboard used to only show read-only counters (total bots, total
 * users, ...) and a history feed — a status readout. Nothing on it ever
 * pointed at a bot that actually needs the owner to do something right now
 * (a rejected payment, a bot stuck in error, a trial about to lapse); that
 * was only ever visible as a small badge buried in the /bots grid, or a
 * one-time dismissable trial-warning dialog (see trial-warning-dialog.tsx)
 * that doesn't come back once read.
 *
 * This is the pure "which bots need attention, and why" computation, kept
 * framework-free so it's unit-testable without mocking the API client.
 */
import type { Bot } from "@workspace/api-client-react";

export type AttentionReason =
  | "expired"
  | "trialEndingSoon"
  | "tierExpired"
  | "tierEndingSoon"
  | "error"
  | "paymentRejected"
  | "pendingPayment";

/** Trial bots with this many days or fewer left surface as "ending soon". */
const TRIAL_WARNING_DAYS = 3;

type AttentionBot = Pick<Bot, "status" | "isTrial" | "trialDaysLeft"> & Partial<Pick<Bot, "tierExpiresAt" | "tierDaysLeft">>;

export function attentionReason(bot: AttentionBot): AttentionReason | null {
  switch (bot.status) {
    case "expired":
      return "expired";
    case "tier_expired":
      return "tierExpired";
    case "error":
      return "error";
    case "payment_rejected":
      return "paymentRejected";
    case "pending_payment":
      return "pendingPayment";
    default:
      break;
  }
  if (bot.isTrial && bot.trialDaysLeft != null && bot.trialDaysLeft <= TRIAL_WARNING_DAYS) {
    return "trialEndingSoon";
  }
  // استاندارد/پرو ۳۰ روزه‌اند: نزدیکِ پایان باید در داشبورد دیده شود (نه فقط داخلِ صفحه‌یِ بات).
  if (bot.tierExpiresAt && bot.tierDaysLeft != null && bot.tierDaysLeft >= 0 && bot.tierDaysLeft <= TRIAL_WARNING_DAYS) {
    return "tierEndingSoon";
  }
  return null;
}

export function botsNeedingAttention<T extends AttentionBot>(
  bots: readonly T[]
): { bot: T; reason: AttentionReason }[] {
  const out: { bot: T; reason: AttentionReason }[] = [];
  for (const bot of bots) {
    const reason = attentionReason(bot);
    if (reason) out.push({ bot, reason });
  }
  return out;
}
