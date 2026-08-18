/**
 * The auth token, as a store React can subscribe to.
 *
 * NOTE: the token used to be read and written as bare `localStorage` calls in
 * six different places. localStorage isn't reactive, so `AuthProvider` had no
 * way to ask "is this visitor even logged in?" before firing `GET /api/auth/me`
 * — which meant EVERY anonymous visitor to the landing page made a request that
 * came back 401. It cost a round-trip on the critical path and PageSpeed
 * flagged it under "Browser errors were logged to the console", because a 401
 * response is logged by the browser itself and cannot be silenced from JS.
 *
 * Everything that mints or clears a session now goes through here, so the
 * `enabled` flag on the /me query is always correct.
 */

const STORAGE_KEY = "irforge_token";

const listeners = new Set<() => void>();

// Cached so getSnapshot() is cheap and, more importantly, referentially stable
// between renders — useSyncExternalStore re-renders in a loop otherwise.
let cached: string | null = readFromStorage();

function readFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage blocked (private mode, embedded webview) — treat as logged out
    return null;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function getAuthToken(): string | null {
  return cached;
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* still hold it in memory for this tab */
  }
  cached = token;
  emit();
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  cached = null;
  emit();
}

export function subscribeAuthToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server snapshot for useSyncExternalStore — the build-time render is anonymous. */
export function getServerAuthToken(): null {
  return null;
}
