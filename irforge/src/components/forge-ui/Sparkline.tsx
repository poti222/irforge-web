import { useId } from "react";

/**
 * A dependency-free sparkline (area + line) in the accent colour. `values`
 * are plotted left→right in a fixed 100×32 box that stretches to the width of
 * its container, so it needs no measuring and renders on the server.
 */
export function Sparkline({ values, className = "h-10 w-full" }: { values: number[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return <div className={className} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - ((v - min) / span) * 26] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L100,32 L0,32 Z`;
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.38" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg${id})`} />
      <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
