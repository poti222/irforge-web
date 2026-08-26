/**
 * lib/captchaVerify.ts — IRFORGE_PROMPT_V3 Phase 42.
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies a Cloudflare Turnstile token against Cloudflare's own siteverify
 * endpoint — the server-side half of the anti-abuse gate on signup and
 * free-trial-bot creation (the two actions a script can repeat for free).
 *
 * The secret key is intentionally read straight from `process.env` here and
 * nowhere else: `platformSettings.ts`'s own header warns that everything in
 * that file is assumed safe to ship to the client, so a real secret has no
 * business living there. `getCaptchaSettings()` only ever hands back the
 * public `siteKey` and the `enabled` flag.
 */
import { logger } from "./logger";
import { getCaptchaSettings } from "./platformSettings";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * `true` means "let the request through" — either the gate isn't configured
 * at all (nothing to check), or Cloudflare confirmed the token is genuine.
 * `false` means Cloudflare explicitly rejected the token, or the gate is on
 * and the caller sent no token at all (the one pattern a script bypassing
 * the browser widget would produce).
 *
 * A network/parse failure talking to Cloudflare itself resolves `true`: this
 * gate is a supplement to the existing rate limiting on these routes, not
 * the only thing standing between the site and abuse, so an outage on
 * Cloudflare's end must never take registration or trial signup down with it.
 */
export async function verifyCaptchaToken(token: unknown, remoteIp?: string): Promise<boolean> {
  const settings = await getCaptchaSettings();
  if (!settings.enabled) return true;

  const secret = process.env.TURNSTILE_SECRET_KEY ?? "";
  if (!secret) {
    logger.warn("captcha is enabled (siteKey set) but TURNSTILE_SECRET_KEY is missing — allowing requests through");
    return true;
  }

  if (typeof token !== "string" || !token.trim()) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) {
      logger.warn({ status: res.status }, "captcha verify: turnstile siteverify returned a non-2xx status");
      return true;
    }
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    logger.warn({ err }, "captcha verify: request to turnstile siteverify failed");
    return true;
  }
}
