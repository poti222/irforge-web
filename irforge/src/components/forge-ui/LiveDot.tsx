import { cn } from "@/lib/utils";

export type Tone = "ok" | "idle" | "warn" | "bad";

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-400",
  idle: "bg-zinc-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
};

/** A status dot; `pulse` adds the expanding ring (CSS-only, off under reduced motion). */
export function LiveDot({ tone = "ok", pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden="true">
      {pulse && <span className={cn("forge-ring absolute inset-0 rounded-full", DOT[tone])} style={{ animationIterationCount: "infinite", animationDuration: "1.8s" }} />}
      <span className={cn("relative inline-block size-2 rounded-full", DOT[tone])} />
    </span>
  );
}

export const TONE_PILL: Record<Tone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  idle: "border-border bg-muted/60 text-muted-foreground",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
};

export function StatusPill({ tone, pulse, children, className }: { tone: Tone; pulse?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        TONE_PILL[tone],
        className,
      )}
    >
      <LiveDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}
