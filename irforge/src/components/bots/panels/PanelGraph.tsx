/**
 * PanelGraph.tsx — نمای گرافی (canvas) پنل‌ها: هر پنل یک کارت است و کارت‌ها با
 * خط به والدشان وصل‌اند. با کلیک روی کارت پنل باز می‌شود، با هاور روی کارت،
 * مسیر والدها و زیرمجموعه‌هایش پررنگ و بقیه کم‌رنگ می‌شوند.
 *
 * خطِ ممتد = رابطه‌ی والد ← فرزند (`parent_id`).
 * خطِ نقطه‌چین = دکمه‌ای در یک پنل که به پنلِ دیگری می‌رود (action = panel).
 *
 * بدون وابستگی جدید: چیدمان درختی ساده + SVG برای خطوط + pan/zoom دستی.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Ban, Lock, Minus, Plus, Maximize2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { panelTypeLabel } from "./labels";
import type { Panel, PanelNode } from "./api";

const NODE_W = 184;
const NODE_H = 76;
const GAP_X = 28;
const GAP_Y = 72;
const PAD = 48;

type Pos = { x: number; y: number };
type Edge = { from: string; to: string; kind: "child" | "link" };

function subtreeWidth(n: PanelNode, memo: Map<string, number>): number {
  const cached = memo.get(n.id);
  if (cached !== undefined) return cached;
  const w = n.childNodes.length
    ? Math.max(
        NODE_W,
        n.childNodes.reduce((s, c) => s + subtreeWidth(c, memo), 0) + GAP_X * (n.childNodes.length - 1),
      )
    : NODE_W;
  memo.set(n.id, w);
  return w;
}

function layout(tree: PanelNode[]) {
  const memo = new Map<string, number>();
  const pos = new Map<string, Pos>();
  let cursor = PAD;
  let maxY = 0;

  const place = (n: PanelNode, left: number, depth: number) => {
    const w = subtreeWidth(n, memo);
    const y = PAD + depth * (NODE_H + GAP_Y);
    pos.set(n.id, { x: left + (w - NODE_W) / 2, y });
    maxY = Math.max(maxY, y + NODE_H);
    let l = left;
    for (const c of n.childNodes) {
      place(c, l, depth + 1);
      l += subtreeWidth(c, memo) + GAP_X;
    }
  };

  for (const root of tree) {
    place(root, cursor, 0);
    cursor += subtreeWidth(root, memo) + GAP_X * 2;
  }
  return { pos, width: Math.max(cursor, NODE_W + PAD * 2), height: maxY + PAD };
}

/** خطِ شکسته (عمودی-افقی-عمودی) مثل نمای سرویس‌ها. */
function elbow(a: Pos, b: Pos): string {
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  const my = y1 + (y2 - y1) / 2;
  const r = Math.min(10, Math.abs(x2 - x1) / 2, Math.abs(my - y1));
  if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} L${x2},${y2}`;
  const dir = x2 > x1 ? 1 : -1;
  return `M${x1},${y1} L${x1},${my - r} Q${x1},${my} ${x1 + dir * r},${my} L${x2 - dir * r},${my} Q${x2},${my} ${x2},${my + r} L${x2},${y2}`;
}

/** خطِ منحنی برای لینک‌های دکمه‌ای (ممکن است به هر جایی از درخت بروند). */
function curve(a: Pos, b: Pos): string {
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  if (y2 > y1) {
    const dy = (y2 - y1) / 2;
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  }
  // مقصد بالاتر/هم‌سطح: از کنار دور بزن.
  const side = x2 >= x1 ? 1 : -1;
  const off = NODE_W / 2 + 28;
  return `M${x1},${y1} C${x1},${y1 + 50} ${x1 + side * off},${y1 + 50} ${x1 + side * off},${(y1 + y2) / 2} S${x2},${y2 - 50} ${x2},${y2}`;
}

export function PanelGraph({
  tree,
  panels,
  selectedId,
  onSelect,
  panelTypeLabels,
}: {
  tree: PanelNode[];
  panels: Panel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  panelTypeLabels?: Record<string, string>;
}) {
  const t = useT("botPanels");
  const { pos, width, height } = useMemo(() => layout(tree), [tree]);

  const byId = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);

  const edges = useMemo(() => {
    const out: Edge[] = [];
    const seen = new Set<string>();
    for (const p of panels) {
      if (p.parent_id && pos.has(p.parent_id) && pos.has(p.id)) {
        out.push({ from: p.parent_id, to: p.id, kind: "child" });
        seen.add(`${p.parent_id}>${p.id}`);
      }
    }
    for (const p of panels) {
      for (const b of p.buttons ?? []) {
        if (b.action !== "panel" || !b.value || b.value === p.id) continue;
        const key = `${p.id}>${b.value}`;
        if (seen.has(key) || !pos.has(b.value) || !pos.has(p.id)) continue;
        seen.add(key);
        out.push({ from: p.id, to: b.value, kind: "link" });
      }
    }
    return out;
  }, [panels, pos]);

  // با هاور: خودِ پنل + همه‌ی والدها + همه‌ی زیرمجموعه‌هایش پررنگ می‌شوند.
  const [hovered, setHovered] = useState<string | null>(null);
  const related = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    let cur = byId.get(hovered)?.parent_id ?? null;
    while (cur && !set.has(cur)) {
      set.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
    const down = (id: string) => {
      for (const p of panels) {
        if (p.parent_id === id && !set.has(p.id)) {
          set.add(p.id);
          down(p.id);
        }
      }
    };
    down(hovered);
    return set;
  }, [hovered, byId, panels]);

  // ── pan / zoom ──────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const k = Math.min(1, el.clientWidth / width, el.clientHeight / height);
    setView({ k, x: (el.clientWidth - width * k) / 2, y: Math.max(0, (el.clientHeight - height * k) / 2) });
  }, [width, height]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(2, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        const r = k / v.k;
        return { k, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function zoomBy(f: number) {
    const el = wrapRef.current;
    if (!el) return;
    const mx = el.clientWidth / 2;
    const my = el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(2, Math.max(0.25, v.k * f));
      const r = k / v.k;
      return { k, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
    });
  }

  if (tree.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noPanels}</p>
    );
  }

  const isDim = (id: string) => related !== null && !related.has(id);

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        dir="ltr"
        className="relative h-[70vh] min-h-[360px] touch-none select-none overflow-hidden rounded-lg border bg-muted/20 [background-image:radial-gradient(hsl(var(--muted-foreground)/0.25)_1px,transparent_1px)] [background-size:18px_18px]"
        onPointerDown={(e) => {
          suppressClick.current = false;
          drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (d.moved) setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
        }}
        onPointerUp={(e) => {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          // اگر درگ بوده، کلیکِ بعدی روی کارت نباید پنل را باز کند.
          const moved = drag.current?.moved;
          drag.current = null;
          if (moved) suppressClick.current = true;
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          <svg width={width} height={height} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            {edges.map((e) => {
              const a = pos.get(e.from)!;
              const b = pos.get(e.to)!;
              const active = related ? related.has(e.from) && related.has(e.to) : false;
              const dim = related !== null && !active;
              return (
                <path
                  key={`${e.kind}:${e.from}>${e.to}`}
                  d={e.kind === "child" ? elbow(a, b) : curve(a, b)}
                  fill="none"
                  strokeWidth={active ? 2.5 : 2}
                  strokeDasharray={e.kind === "link" ? "5 5" : undefined}
                  className={
                    e.kind === "child"
                      ? active ? "stroke-primary" : "stroke-primary/40"
                      : active ? "stroke-amber-500" : "stroke-amber-500/40"
                  }
                  opacity={dim ? 0.2 : 1}
                />
              );
            })}
          </svg>

          {panels.map((p) => {
            const at = pos.get(p.id);
            if (!at) return null;
            const selected = selectedId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                dir="auto"
                onClick={() => {
                  if (suppressClick.current) { suppressClick.current = false; return; }
                  onSelect(p.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(p.id)}
                onBlur={() => setHovered(null)}
                className={`absolute flex flex-col justify-between rounded-lg border bg-card p-2.5 text-start shadow-sm transition-[opacity,box-shadow,border-color] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/60"
                } ${isDim(p.id) ? "opacity-30" : ""}`}
                style={{ left: at.x, top: at.y, width: NODE_W, height: NODE_H }}
              >
                <div className="flex w-full items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{p.title || t.untitledPanel}</span>
                  <span className="ms-auto flex shrink-0 items-center gap-1">
                    {p.is_home && <Home className="size-3.5 text-emerald-500" aria-label={t.badgeHome} />}
                    {p.settings?.password && <Lock className="size-3.5 text-amber-500" aria-label={t.badgeLocked} />}
                  </span>
                </div>
                <div className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                  {p.is_active ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  ) : (
                    <Ban className="size-3 shrink-0 text-destructive" aria-label={t.badgeInactive} />
                  )}
                  <span className="truncate">{panelTypeLabel(t, p.type, panelTypeLabels)}</span>
                  <span className="ms-auto shrink-0 tabular-nums">
                    {p.buttons?.length ?? 0} · {p.children?.length ?? 0}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div
          className="absolute bottom-3 start-3 flex flex-col gap-1 rounded-md border bg-background/90 p-1 shadow-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" aria-label={t.graphZoomIn} className="rounded p-1.5 hover:bg-muted" onClick={() => zoomBy(1.2)}>
            <Plus className="size-4" />
          </button>
          <button type="button" aria-label={t.graphZoomOut} className="rounded p-1.5 hover:bg-muted" onClick={() => zoomBy(1 / 1.2)}>
            <Minus className="size-4" />
          </button>
          <button type="button" aria-label={t.graphFit} className="rounded p-1.5 hover:bg-muted" onClick={fit}>
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" strokeWidth="2" className="stroke-primary" /></svg>
          {t.graphLegendChild}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" strokeWidth="2" strokeDasharray="4 3" className="stroke-amber-500" /></svg>
          {t.graphLegendLink}
        </span>
        <span>{t.graphHint}</span>
      </div>
    </div>
  );
}

// کلیکِ بعد از درگ را بی‌اثر می‌کند (module-level ref ساده، برای یک نمونه‌ی همزمان کافی است).
const suppressClick = { current: false };
