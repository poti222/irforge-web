import React from "react";
import { Button } from "@/components/ui/button";
import { OrangeRobot } from "@/components/layout/brand-home";

/** Read the persisted UI language without depending on React context — the
 *  boundary must render even when the tree below it (and its providers) failed. */
function readLang(): "fa" | "en" {
  try {
    return localStorage.getItem("irforge_lang") === "en" ? "en" : "fa";
  } catch {
    return "fa";
  }
}

/**
 * A lazy route chunk that failed to load — the classic symptom right after a
 * deploy, when the old page's hashed chunk no longer exists on the server.
 * React caches a rejected `React.lazy()` import forever, so re-rendering the
 * same tree can NEVER succeed: the only real recovery is a full reload (which
 * fetches the new index.html and the new chunk names).
 */
function isChunkLoadError(error?: Error): boolean {
  const msg = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Loading chunk .* failed|Unable to preload CSS/i.test(
    msg,
  );
}

const AUTO_RELOAD_KEY = "irforge_chunk_reload_at";
const AUTO_RELOAD_COOLDOWN_MS = 30_000;

/** Reload at most once per cooldown window, so a chunk that is genuinely
 *  missing (not just stale) can't trap the user in a reload loop. */
function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0);
    if (Date.now() - last < AUTO_RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable — fall through and still try once.
  }
  window.location.reload();
  return true;
}

interface Props {
  children: React.ReactNode;
  /** When true, render a compact fallback that fits inside a page shell
   *  instead of the full-screen version. */
  inline?: boolean;
  /** When this value changes while the boundary is showing an error, the error
   *  is cleared and the children are mounted fresh. Pass the current route so
   *  navigating away from a crashed page never leaves the fallback stuck on
   *  every other page of the shell. */
  resetKey?: string;
}
interface State {
  hasError: boolean;
  error?: Error;
  /** Bumped on every retry; used as a React `key` so the subtree is torn down
   *  and mounted from scratch instead of re-rendered with its broken state. */
  attempt: number;
}

/**
 * App-wide error boundary. Without one, a single render error unmounts the
 * whole React tree and leaves a blank screen. This catches it and shows a
 * friendly, bilingual recovery card (with the robot mascot) plus Retry /
 * Reload / Home actions. Placed globally around the app AND per-page inside
 * the dashboard and school shells (reset by route so navigating away clears
 * the error).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface it for debugging; a real deployment would forward this to a logger.
    console.error("ErrorBoundary caught an error:", error, info);
    // A stale chunk after a deploy heals itself with one automatic reload.
    if (isChunkLoadError(error)) reloadOnceForStaleChunk();
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState((s) => ({ hasError: false, error: undefined, attempt: s.attempt + 1 }));
    }
  }

  /** "Try again". Re-rendering the very same children used to be a no-op for
   *  any deterministic crash (the identical state throws again instantly), so
   *  it looked broken. Now: a stale-chunk error does a real reload, anything
   *  else remounts the subtree from scratch with a fresh `key`. */
  handleRetry = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState((s) => ({ hasError: false, error: undefined, attempt: s.attempt + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }

    const fa = readLang();
    const isFa = fa === "fa";
    const inline = this.props.inline;
    const message = this.state.error?.message?.slice(0, 300);

    return (
      <div
        dir={isFa ? "rtl" : "ltr"}
        className={`flex ${inline ? "min-h-[60vh]" : "min-h-screen"} flex-col items-center justify-center gap-5 bg-background p-6 text-center text-foreground`}
      >
        <div className="flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <OrangeRobot className="size-12" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight">
            {isFa ? "یه چیزی خراب شد" : "Something went wrong"}
          </h1>
          <p className="max-w-sm text-muted-foreground">
            {isFa
              ? "یه خطای غیرمنتظره پیش اومد. صفحه رو دوباره بارگذاری کن؛ اگه بازم تکرار شد به پشتیبانی خبر بده."
              : "An unexpected error occurred. Try reloading — if it keeps happening, let support know."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={this.handleRetry} data-testid="error-retry">
            {isFa ? "تلاش مجدد" : "Try again"}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()} data-testid="error-reload">
            {isFa ? "بارگذاری دوباره" : "Reload"}
          </Button>
          <Button variant="outline" onClick={() => { window.location.href = "/"; }}>
            {isFa ? "خانه" : "Home"}
          </Button>
        </div>
        {message && (
          <details className="max-w-lg text-start text-xs text-muted-foreground" dir="ltr">
            <summary className="cursor-pointer select-none text-center">
              {isFa ? "جزئیات فنی" : "Technical details"}
            </summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3">
              {import.meta.env.DEV && this.state.error?.stack ? String(this.state.error.stack) : message}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
