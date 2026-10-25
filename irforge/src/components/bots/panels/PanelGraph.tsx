/**
 * PanelGraph.tsx — نمای گرافی (canvas) پنل‌ها: هر پنل یک کارت است و کارت‌ها با
 * خط به والدشان وصل‌اند. با کلیک روی کارت پنل باز می‌شود، با هاور روی کارت،
 * مسیر والدها و زیرمجموعه‌هایش پررنگ و بقیه کم‌رنگ می‌شوند.
 *
 * خطِ ممتد = رابطه‌ی والد ← فرزند (`parent_id`).
 * خطِ نقطه‌چین (با فلش) = دکمه‌ای در یک پنل که به پنلِ دیگری می‌رود (action = panel).
 * این خطوط پیش‌فرض مخفی‌اند و فقط برای پنلِ هاور/انتخاب‌شده (یا با دکمه‌ی «نمایش همه») دیده می‌شوند.
 *
 * چیدمان: درخت چپ→راست (هر عمق یک ستون). کارت‌ها را می‌شود با کشیدن جابجا کرد؛
 * جای دستی‌شان برای هر ربات در localStorage ذخیره می‌شود و دفعه‌ی بعد همان‌جا می‌ماند.
 *
 * بدون وابستگی جدید: چیدمان درختی ساده + SVG برای خطوط + pan/zoom دستی.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, Ban, Lock, Minus, Plus, Maximize2, RotateCcw, Link2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { panelTypeLabel } from "./labels";
import type { Panel, PanelNode } from "./api";

const NODE_W = 184;
const NODE_H = 76;
const COL_GAP = 96; // فاصله‌ی افقی بین ستون‌ها (عمق‌ها)
const ROW_GAP = 18; // فاصله‌ی عمودی بین کارت‌های هم‌سطح
const PAD = 48;
const SNAP = 8; // موقع کشیدن، جای کارت روی این شبکه می‌نشیند تا مرتب بماند
const MIN_K = 0.05; // خیلی کوچک شدن مشکلی نیست؛ کاربر خودش بزرگ می‌کند
const MAX_K = 2;

type Pos = { x: number; y: number };
type Edge = { from: string; to: string; kind: "child" | "link" };
type Side = "r" | "l" | "t" | "b";

function subtreeHeight(n: PanelNode, memo: Map<string, number>): number {
  const cached = memo.get(n.id);
  if (cached !== undefined) return cached;
  const h = n.childNodes.length
    ? Math.max(
        NODE_H,
        n.childNodes.reduce((s, c) => s + subtreeHeight(c, memo), 0) + ROW_GAP * (n.childNodes.length - 1),
      )
    : NODE_H;
  memo.set(n.id, h);
  return h;
}

/** چیدمان خودکار چپ→راست: هر عمق یک ستون، فرزندها زیر هم و وسطِ والد. */
function layout(tree: PanelNode[]): Map<string, Pos> {
  const memo = new Map<string, number>();
  const pos = new Map<string, Pos>();
  let cursor = PAD;

  const place = (n: PanelNode, top: number, depth: number) => {
    const h = subtreeHeight(n, memo);
    pos.set(n.id, { x: PAD + depth * (NODE_W + COL_GAP), y: top + (h - NODE_H) / 2 });
    let t = top;
    for (const c of n.childNodes) {
      place(c, t, depth + 1);
      t += subtreeHeight(c, memo) + ROW_GAP;
    }
  };

  for (const root of tree) {
    place(root, cursor, 0);
    cursor += subtreeHeight(root, memo) + ROW_GAP * 3;
  }
  return pos;
}

// ── ذخیره‌ی جای دستیِ کارت‌ها (per-bot، در مرورگر) ────────────────
function loadPositions(key: string): Record<string, Pos> {
  try {
    const raw = localStorage.getItem(key);
    const obj = raw ? (JSON.parse(raw) as unknown) : null;
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, Pos> = {};
    for (const [id, p] of Object.entries(obj as Record<string, Pos>)) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[id] = { x: p.x, y: p.y };
    }
    return out;
  } catch {
    return {};
  }
}

function savePositions(key: string, value: Record<string, Pos>) {
  try {
    if (Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* localStorage ممکن است در دسترس نباشد */
  }
}

const SIDE_DIR: Record<Side, [number, number]> = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1] };

function anchor(p: Pos, s: Side): Pos {
  switch (s) {
    case "r": return { x: p.x + NODE_W, y: p.y + NODE_H / 2 };
    case "l": return { x: p.x, y: p.y + NODE_H / 2 };
    case "t": return { x: p.x + NODE_W / 2, y: p.y };
    default: return { x: p.x + NODE_W / 2, y: p.y + NODE_H };
  }
}

/** از کدام ضلعِ مبدأ به کدام ضلعِ مقصد وصل شویم (بر اساس جای فعلیِ کارت‌ها). */
function sidesFor(a: Pos, b: Pos): [Side, Side] {
  if (b.x >= a.x + NODE_W + 8) return ["r", "l"];
  if (b.x + NODE_W <= a.x - 8) return ["l", "r"];
  return b.y >= a.y ? ["b", "t"] : ["t", "b"];
}

/** خطِ منحنی با فلش برای لینک‌های دکمه‌ای (ممکن است به هر جایی از درخت بروند). */
function curve(a: Pos, b: Pos): string {
  const [sa, sb] = sidesFor(a, b);
  const p = anchor(a, sa);
  const q = anchor(b, sb);
  const dist = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) / 2.5);
  const [dx1, dy1] = SIDE_DIR[sa];
  const [dx2, dy2] = SIDE_DIR[sb];
  return `M${p.x},${p.y} C${p.x + dx1 * dist},${p.y + dy1 * dist} ${q.x + dx2 * dist},${q.y + dy2 * dist} ${q.x},${q.y}`;
}

/** خطِ شکسته (افقی-عمودی-افقی) برای والد ← فرزند؛ فرزندهای هم‌والد یک تنه‌ی مشترک دارند. */
function elbow(a: Pos, b: Pos): string {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  // اگر کارتِ فرزند را به سمت چپ/روی والد کشیده باشند، منحنیِ عمومی بهتر است.
  if (x2 - x1 < 24) return curve(a, b);
  if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} L${x2},${y2}`;
  const mx = x1 + (x2 - x1) / 2;
  const r = Math.min(10, Math.abs(y2 - y1) / 2, (x2 - x1) / 2);
  const dir = y2 > y1 ? 1 : -1;
  return `M${x1},${y1} L${mx - r},${y1} Q${mx},${y1} ${mx},${y1 + dir * r} L${mx},${y2 - dir * r} Q${mx},${y2} ${mx + r},${y2} L${x2},${y2}`;
}

export function PanelGraph({
  botId,
  tree,
  panels,
  selectedId,
  onSelect,
  panelTypeLabels,
}: {
  botId: string;
  tree: PanelNode[];
  panels: Panel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  panelTypeLabels?: Record<string, string>;
}) {
  const t = useT("botPanels");
  const autoPos = useMemo(() => layout(tree), [tree]);

  // جای دستیِ کارت‌ها (بعد از درگ) — روی چیدمان خودکار اولویت دارد و ذخیره می‌شود.
  const storageKey = `irforge:panel-graph:${botId}`;
  const [custom, setCustom] = useState<Record<string, Pos>>(() => loadPositions(storageKey));
  const customRef = useRef(custom);
  customRef.current = custom;
  useEffect(() => {
    setCustom(loadPositions(storageKey));
  }, [storageKey]);

  const pos = useMemo(() => {
    const m = new Map(autoPos);
    for (const [id, p] of Object.entries(custom)) if (m.has(id)) m.set(id, p);
    return m;
  }, [autoPos, custom]);
  const hasCustom = useMemo(() => Object.keys(custom).some((id) => autoPos.has(id)), [custom, autoPos]);

  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pos.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: NODE_W, maxY: NODE_H };
  }, [pos]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const [showLinks, setShowLinks] = useState(false);
  const [fitTick, setFitTick] = useState(0);

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
    const b = boundsRef.current;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const k = Math.min(1, Math.max(MIN_K, Math.min((el.clientWidth - PAD) / bw, (el.clientHeight - PAD) / bh)));
    setView({
      k,
      x: (el.clientWidth - bw * k) / 2 - b.minX * k,
      y: (el.clientHeight - bh * k) / 2 - b.minY * k,
    });
  }, []);

  // فقط وقتی ساختار پنل‌ها عوض شد (یا «چیدمان خودکار» زده شد) دوباره fit کن؛ نه موقع درگ.
  useEffect(() => {
    fit();
  }, [fit, autoPos, fitTick]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
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
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
      const r = k / v.k;
      return { k, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
    });
  }

  // ── جابجاییِ کارت‌ها ───────────────────────────────────────────
  const nodeDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; last: Pos } | null>(null);

  function resetLayout() {
    setCustom({});
    savePositions(storageKey, {});
    setFitTick((n) => n + 1);
  }

  if (tree.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noPanels}</p>
    );
  }

  const isDim = (id: string) => related !== null && !related.has(id);
  const focus = hovered ?? selectedId;

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
          style={{ width: 1, height: 1, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          <svg width={1} height={1} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            <defs>
              <marker id="pg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-amber-500" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = pos.get(e.from)!;
              const b = pos.get(e.to)!;
              const isLink = e.kind === "link";
              // لینک‌های دکمه‌ای فقط برای کارتِ هاور/انتخاب‌شده (یا وقتی «نمایش همه» روشن است) رسم می‌شوند.
              const touchesFocus = focus !== null && (e.from === focus || e.to === focus);
              if (isLink && !showLinks && !touchesFocus) return null;
              const active = isLink
                ? touchesFocus
                : related ? related.has(e.from) && related.has(e.to) : false;
              const dim = isLink
                ? focus !== null && !touchesFocus
                : related !== null && !active;
              return (
                <path
                  key={`${e.kind}:${e.from}>${e.to}`}
                  d={isLink ? curve(a, b) : elbow(a, b)}
                  fill="none"
                  strokeWidth={active ? 2.5 : isLink ? 1.5 : 2}
                  strokeDasharray={isLink ? "5 5" : undefined}
                  markerEnd={isLink ? "url(#pg-arrow)" : undefined}
                  className={
                    isLink
                      ? "stroke-amber-500"
                      : active ? "stroke-primary" : "stroke-primary/40"
                  }
                  opacity={dim ? 0.15 : isLink && !active ? 0.6 : 1}
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
                title={p.title || undefined}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.button !== 0) return;
                  suppressClick.current = false;
                  nodeDrag.current = { id: p.id, sx: e.clientX, sy: e.clientY, ox: at.x, oy: at.y, moved: false, last: at };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = nodeDrag.current;
                  if (!d || d.id !== p.id) return;
                  const dx = e.clientX - d.sx;
                  const dy = e.clientY - d.sy;
                  if (!d.moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
                  d.moved = true;
                  const next = {
                    x: Math.round((d.ox + dx / view.k) / SNAP) * SNAP,
                    y: Math.round((d.oy + dy / view.k) / SNAP) * SNAP,
                  };
                  d.last = next;
                  setCustom((c) => ({ ...c, [p.id]: next }));
                }}
                onPointerUp={(e) => {
                  const d = nodeDrag.current;
                  nodeDrag.current = null;
                  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
                  if (d?.moved) {
                    suppressClick.current = true; // کلیکِ بعد از درگ نباید پنل را باز کند
                    const next = { ...customRef.current, [d.id]: d.last };
                    setCustom(next);
                    savePositions(storageKey, next);
                  }
                }}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(p.id)}
                onBlur={() => setHovered(null)}
                className={`absolute flex cursor-grab flex-col justify-between rounded-lg border bg-card p-2.5 text-start shadow-sm transition-[opacity,box-shadow,border-color] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing ${
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
          <button
            type="button"
            aria-label={showLinks ? t.graphHideLinks : t.graphShowLinks}
            title={showLinks ? t.graphHideLinks : t.graphShowLinks}
            aria-pressed={showLinks}
            className={`rounded p-1.5 hover:bg-muted ${showLinks ? "bg-muted text-amber-500" : ""}`}
            onClick={() => setShowLinks((v) => !v)}
          >
            <Link2 className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t.graphResetLayout}
            title={t.graphResetLayout}
            disabled={!hasCustom}
            className="rounded p-1.5 hover:bg-muted disabled:opacity-40"
            onClick={resetLayout}
          >
            <RotateCcw className="size-4" />
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
