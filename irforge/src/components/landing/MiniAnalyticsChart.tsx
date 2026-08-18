import { useT } from "@/hooks/use-translation";

/**
 * Illustrative sparkline for the analytics bento tile. The shape is a fixed
 * sample curve, not live data — the tile is labelled with a "preview" badge so
 * it never reads as a real account metric. No numbers are printed.
 *
 * NOTE [perf]: this used to be a <AreaChart> from recharts. recharts pulls in
 * d3-scale/-shape/-time, lodash and decimal.js-light — ~900 kB of raw JS
 * (~130 kB gzipped) — and because this tile sits on the LANDING page, which is
 * statically imported so SSG can prerender it, all of that shipped inside the
 * main entry chunk that every first-time visitor downloads before anything
 * renders. For a decorative 7-point curve with no axes, no tooltip and no
 * interaction, that is the single most expensive thing on the site.
 *
 * The curve below is the same monotone-cubic interpolation recharts used
 * (Fritsch–Carlson), computed inline over a fixed 7-point array, drawn as one
 * <path>. Zero dependencies. If this tile ever needs a REAL chart (live data,
 * tooltips, axes), import components/ui/chart.tsx behind a React.lazy()
 * boundary — never statically from a prerendered page.
 */
const SAMPLE = [18, 26, 22, 38, 34, 52, 61];

// viewBox space. preserveAspectRatio="none" stretches this to the tile, and
// vector-effect="non-scaling-stroke" keeps the line 2px however it stretches.
const W = 100;
const H = 40;
const PAD_TOP = 3; // headroom so the peak's stroke isn't clipped

/** Monotone cubic (Fritsch–Carlson) — same shape recharts' type="monotone" draws. */
function monotonePath(values: number[]): { line: string; area: string } {
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const xs = values.map((_, i) => (i / (n - 1)) * W);
  const ys = values.map((v) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP));

  // secant slopes
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    dy.push(ys[i + 1] - ys[i]);
    m.push(dy[i] / dx[i]);
  }

  // tangents
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0; // local extremum — flatten, this is what prevents overshoot
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }

  let line = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = xs[i] + dx[i] / 3;
    const c1y = ys[i] + (t[i] * dx[i]) / 3;
    const c2x = xs[i + 1] - dx[i] / 3;
    const c2y = ys[i + 1] - (t[i + 1] * dx[i]) / 3;
    line +=
      `C${c1x.toFixed(2)},${c1y.toFixed(2)} ` +
      `${c2x.toFixed(2)},${c2y.toFixed(2)} ` +
      `${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }

  // close down to the baseline for the gradient fill
  const area = `${line}L${W},${H}L0,${H}Z`;
  return { line, area };
}

const { line: LINE, area: AREA } = monotonePath(SAMPLE);

export function MiniAnalyticsChart() {
  const tr = useT("landing");

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{tr.analyticsPreviewLabel}</span>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {tr.previewBadge}
        </span>
      </div>
      {/* charts read left-to-right regardless of page direction */}
      <div className="irforge-spark h-28 w-full" dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          role="presentation"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id="irforge-mini-analytics" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={AREA} fill="url(#irforge-mini-analytics)" />
          <path
            d={LINE}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}
