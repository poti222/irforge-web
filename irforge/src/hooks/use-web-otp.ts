import { useEffect } from "react";

/**
 * hooks/use-web-otp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * WebOTP API — lets Chrome on Android read the 6-digit code straight out of
 * the incoming SMS and hand it to this page, without the user leaving the
 * tab, opening Messages, or typing/pasting anything. This only ever applies
 * to codes that arrive as a real SMS (`method === "sms"` in register.tsx,
 * the `sms_code` step in login.tsx) — Telegram and email codes don't arrive
 * as an SMS, so there's nothing for this API to intercept there, and this
 * hook is simply not wired up on those steps.
 *
 * This is a *progressive enhancement*, not a requirement: CodeInput's six
 * boxes work exactly as before regardless of browser support, and nothing
 * here changes what the user sees unless the OS actually offers a code to
 * autofill.
 *
 * Requires the SMS text sent by sendOtpSms (see api-server/src/lib/smsir.ts
 * and the sms.ir template body) to end with the origin-bound line:
 *   @irforge.ir #123456
 * — that trailing `@domain #code` line is what tells the browser both which
 * site is allowed to receive the code and which digits to hand over; it's a
 * platform requirement (https://github.com/WICG/web-otp), not something
 * this hook can relax.
 *
 * Support: Chrome/WebView on Android only (`'OTPCredential' in window`).
 * Desktop browsers and iOS Safari don't implement this API — they fall back
 * to nothing here, though iOS still gets its own native SMS-code suggestion
 * above the keyboard for free via CodeInput's `autoComplete="one-time-code"`
 * on each digit `<input>`, which needs no JS and works independently of
 * this hook.
 */
export function useWebOtp(onCode: (code: string) => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!("OTPCredential" in window) || !navigator.credentials) return;

    // Aborted on unmount/step-change so a code that arrives after the user
    // has already left the SMS-code step (verified another way, went back,
    // etc.) never fires a callback into a component that's no longer
    // showing that step.
    const controller = new AbortController();

    (
      navigator.credentials as {
        get(options: {
          otp: { transport: string[] };
          signal: AbortSignal;
        }): Promise<{ code?: string } | null>;
      }
    )
      .get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((credential) => {
        const code = String(credential?.code ?? "").replace(/\D/g, "");
        if (code) onCode(code);
      })
      .catch(() => {
        // AbortError on unmount/cleanup, or the user dismissed the
        // "allow irforge.ir to read your SMS?" system prompt — either way
        // there's nothing to recover from here; the six boxes still take
        // manual/paste input exactly as before.
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCode is a
    // fresh closure every render (setCode from useState is not, but the
    // wrapper passed in from pages often is); re-subscribing on every
    // render would abort and restart the OS-level listener constantly.
  }, [active]);
}
