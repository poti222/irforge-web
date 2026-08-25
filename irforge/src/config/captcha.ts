/**
 * config/captcha.ts — IRFORGE_PROMPT_V3 Phase 42.
 * ─────────────────────────────────────────────────────────────────────────────
 * The public half of the Cloudflare Turnstile captcha gate: whether it's on,
 * and the site key needed to render the widget. Mirrors config/currency.ts's
 * shape. There is no secret key here — see api-server/src/lib/platformSettings.ts
 * for why that one is env-only and never leaves the server.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface CaptchaConfig {
  enabled: boolean;
  siteKey: string;
}

export const DEFAULT_CAPTCHA_CONFIG: CaptchaConfig = { enabled: false, siteKey: "" };

export const CAPTCHA_CONFIG_QUERY_KEY = ["captcha-config"] as const;

/**
 * Off by default — a visitor loading the registration/trial form before this
 * resolves (or on a site that never configured captcha) just sees no widget,
 * exactly like today.
 */
export function useCaptchaConfig(): CaptchaConfig {
  const { data } = useQuery({
    queryKey: CAPTCHA_CONFIG_QUERY_KEY,
    queryFn: () => customFetch<CaptchaConfig>("/api/captcha-config"),
    initialData: DEFAULT_CAPTCHA_CONFIG,
    staleTime: 5 * 60 * 1000,
  });
  return data;
}
