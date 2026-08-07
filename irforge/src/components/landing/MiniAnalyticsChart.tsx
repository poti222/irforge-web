import { useReducedMotion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, XAxis } from "recharts";
import { useT } from "@/hooks/use-translation";

/**
 * Illustrative sparkline for the analytics bento tile. The shape is a fixed
 * sample curve, not live data — the tile is labelled with a "preview" badge so
 * it never reads as a real account metric. No numbers are printed.
 */
const SAMPLE = [
  { d: "1", v: 18 },
  { d: "2", v: 26 },
  { d: "3", v: 22 },
  { d: "4", v: 38 },
  { d: "5", v: 34 },
  { d: "6", v: 52 },
  { d: "7", v: 61 },
];

export function MiniAnalyticsChart() {
  const tr = useT("landing");
  const reduce = useReducedMotion();

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{tr.analyticsPreviewLabel}</span>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {tr.previewBadge}
        </span>
      </div>
      {/* charts read left-to-right regardless of page direction */}
      <div className="h-28 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={SAMPLE} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="irforge-mini-analytics" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="d" hide />
            <Area
              type="monotone"
              dataKey="v"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#irforge-mini-analytics)"
              isAnimationActive={!reduce}
              animationDuration={900}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
