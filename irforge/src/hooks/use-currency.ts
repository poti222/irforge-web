import { useCallback, useSyncExternalStore } from "react";
import { useCurrencyDisplay, type CurrencyRate } from "@/config/currency";

/**
 * hooks/use-currency.ts — IRFORGE_PROMPT_V3 Phase 39.
 * ─────────────────────────────────────────────────────────────────────────────
 * The visitor's chosen DISPLAY currency (which "≈ X" line to show next to a
 * Toman price), shared across every component the same way `useLanguage`
 * shares the selected language: one module-level store + useSyncExternalStore,
 * no routing involved since display currency isn't part of the URL.
 *
 * `code: null` means "Toman only" — the default, and the effective state
 * whenever the site has no rates configured, whichever code was last picked.
 */
const STORAGE_KEY = "irforge_currency";

function readInitialCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

let currentCode: string | null = readInitialCode();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentCode;
}

function commitCode(next: string | null) {
  currentCode = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
  listeners.forEach((listener) => listener());
}

export function useCurrency(): {
  rates: CurrencyRate[];
  code: string | null;
  setCode: (code: string | null) => void;
  activeRate: CurrencyRate | null;
} {
  const { rates } = useCurrencyDisplay();
  const storedCode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // A previously-picked code that the admin later removed just falls back to
  // Toman-only — never invent a rate, and never crash on a stale value.
  const activeRate = rates.find((r) => r.code === storedCode) ?? null;
  const code = activeRate ? storedCode : null;

  const setCode = useCallback((next: string | null) => {
    commitCode(next);
  }, []);

  return { rates, code, setCode, activeRate };
}
