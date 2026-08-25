import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useT } from "@/hooks/use-translation";

/**
 * TurnstileWidget.tsx — IRFORGE_PROMPT_V3 Phase 42.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around Cloudflare Turnstile's own script — no npm package,
 * since Cloudflare ships the widget as a plain `<script>` that exposes
 * `window.turnstile`. The script is loaded once and shared across every
 * mounted widget (a page could in principle render more than one).
 *
 * A Turnstile token is single-use: after a failed submit (e.g. the server
 * rejected it, or some other field failed validation) the caller must get a
 * fresh one before retrying, which is why `reset()` is exposed via ref
 * instead of this component silently re-rendering a stale, already-spent
 * widget.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("turnstile script failed to load")));
        return;
      }
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("turnstile script failed to load"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface TurnstileWidgetHandle {
  /** Gets a fresh token — call after a failed submit before retrying. */
  reset: () => void;
}

export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  { siteKey: string; onVerify: (token: string) => void; onExpire?: () => void; className?: string }
>(({ siteKey, onVerify, onExpire, className }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();
  const [failed, setFailed] = useState(false);
  const t = useT("captcha");

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onVerify,
          "error-callback": () => setFailed(true),
          "expired-callback": () => onExpire?.(),
          theme: resolvedTheme === "dark" ? "dark" : "light",
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, resolvedTheme]);

  // Never blocks the rest of the form from rendering — a script/network
  // failure here still lets the visitor submit; the server's own fail-open
  // behavior for a misconfigured gate (lib/captchaVerify.ts) covers the
  // rest. This just tells them why nothing appeared, instead of silence.
  if (failed) return <p className={className ? `${className} text-xs text-muted-foreground` : "text-xs text-muted-foreground"}>{t.loadError}</p>;
  return <div ref={containerRef} className={className} />;
});
TurnstileWidget.displayName = "TurnstileWidget";
