/**
 * Rising embers for the forge panels. The list is generated once from a fixed
 * formula (no Math.random), so server and client always agree. Pure CSS
 * animation — transform/opacity only; hidden entirely under reduced motion.
 */
const r = (i: number, n: number) => {
  const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const EMBERS = Array.from({ length: 30 }, (_, i) => ({
  left: +(r(i, 1) * 100).toFixed(2),
  size: +(2 + r(i, 2) * 3.2).toFixed(2),
  dur: +(8 + r(i, 3) * 9).toFixed(2),
  delay: +(-r(i, 4) * 16).toFixed(2),
  dx: Math.round((r(i, 5) - 0.5) * 140),
  o: +(0.35 + r(i, 6) * 0.6).toFixed(2),
}));

export function Embers({ count = 30, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {EMBERS.slice(0, count).map((e, i) => (
        <span
          key={i}
          className="forge-ember"
          style={
            {
              insetInlineStart: `${e.left}%`,
              width: e.size,
              height: e.size,
              "--d": `${e.dur}s`,
              "--delay": `${e.delay}s`,
              "--dx": `${e.dx}px`,
              "--o": e.o,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
