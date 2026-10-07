import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";

/**
 * One headline number: label + icon on top, big tabular value, optional hint
 * line, optional sparkline bleeding to the bottom edge of the tile.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  spark,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  spark?: number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-[7.5rem] flex-col justify-between gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      <div className="relative z-10">
        <div className="text-2xl font-bold leading-none tracking-tight tabular-nums">{value}</div>
        {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
        {spark && spark.length > 1 && <Sparkline values={spark} className="mt-3 h-8 w-full" />}
      </div>

    </div>
  );
}
