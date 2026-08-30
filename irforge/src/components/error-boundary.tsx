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

interface Props {
  children: React.ReactNode;
  /** When true, render a compact fallback that fits inside a page shell
   *  instead of the full-screen version. */
  inline?: boolean;
}
interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * App-wide error boundary. Without one, a single render error unmounts the
 * whole React tree and leaves a blank screen. This catches it and shows a
 * friendly, bilingual recovery card (with the robot mascot) plus Reload /
 * Home actions. Placed globally around the app AND per-page inside the
 * dashboard shell (keyed by route so navigating away clears the error).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface it for debugging; a real deployment would forward this to a logger.
    console.error("ErrorBoundary caught an error:", error, info);
  }

  /** Re-render the same children in place, no navigation. Fixes transient
   *  crashes (a bad query result, a stale prop on first render) without the
   *  cost of a full page reload — try this before Reload. */
  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const fa = readLang();
    const isFa = fa === "fa";
    const inline = this.props.inline;

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
        {import.meta.env.DEV && this.state.error && (
          <pre className="mt-2 max-w-lg overflow-auto rounded-lg border bg-muted/40 p-3 text-start text-xs text-muted-foreground">
            {String(this.state.error.stack || this.state.error.message)}
          </pre>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
