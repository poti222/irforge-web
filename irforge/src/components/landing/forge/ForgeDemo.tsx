import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { CalendarCheck, LifeBuoy, Megaphone, Send, Store, type LucideIcon } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { HeroRobot } from "../HeroRobot";
import { Bezel } from "./Bezel";

/**
 * The hero's centrepiece: a live, clickable mini-version of the product. The
 * left list is the "builder" (switch a block on), the right is the Telegram
 * chat of the bot it produces. It is a real component, not a screenshot — pick
 * a block and the bot answers; left alone it cycles through them.
 */
const KEYS = ["shop", "support", "booking", "broadcast"] as const;
type Key = (typeof KEYS)[number];
const ICONS: Record<Key, LucideIcon> = { shop: Store, support: LifeBuoy, booking: CalendarCheck, broadcast: Megaphone };
const EASE = [0.32, 0.72, 0, 1] as const;
const CYCLE_MS = 5600;

export function ForgeDemo() {
  const tr = useT("landing");
  const reduce = !!useReducedMotion();
  const [active, setActive] = useState<Key>("shop");
  const [auto, setAuto] = useState(true);
  // 0 = user bubble only, 1 = bot "typing", 2 = reply + buttons
  const [phase, setPhase] = useState<0 | 1 | 2>(2);

  useEffect(() => {
    if (!auto || reduce) return;
    const id = window.setInterval(() => {
      setActive((k) => KEYS[(KEYS.indexOf(k) + 1) % KEYS.length]);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [auto, reduce]);

  useEffect(() => {
    if (reduce) {
      setPhase(2);
      return;
    }
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 380);
    const t2 = window.setTimeout(() => setPhase(2), 1250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [active, reduce]);

  const demo = tr.forge.demo[active];

  // Gentle 3D tilt toward the pointer (mouse only, off under reduced motion).
  // Motion values — no React state — so moving the mouse never re-renders.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 18, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 120, damping: 18, mass: 0.6 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-5, 5]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [4, -4]);
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const resetTilt = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <motion.div
      className="relative"
      onPointerMove={onPointerMove}
      onPointerLeave={resetTilt}
      style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 1200 }}
    >
      {/* mascot peeking over the phone's outer corner */}
      <div className="forge-float pointer-events-none absolute -top-[7.6rem] end-8 z-20 w-24 text-primary" aria-hidden="true">
        <HeroRobot className="w-full drop-shadow-[0_8px_24px_hsl(var(--primary)/0.45)]" />
      </div>

      <Bezel beam className="mx-auto max-w-[34rem]" innerClassName="overflow-hidden">
        <div className="grid gap-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          {/* ── builder ─────────────────────────────────────────────── */}
          <div className="border-b border-border/70 p-4 sm:border-b-0 sm:border-e sm:p-5">
            <p className="text-sm font-bold">{tr.forge.builderTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr.forge.builderHint}</p>
            <div role="tablist" aria-label={tr.forge.builderTitle} className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-1">
              {KEYS.map((k) => {
                const Icon = ICONS[k];
                const on = k === active;
                return (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    data-testid={`forge-block-${k}`}
                    onClick={() => {
                      setAuto(false);
                      setActive(k);
                    }}
                    className={`group relative flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-start text-sm font-medium transition-[background-color,border-color,transform] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${
                      on
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/70 bg-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {on && !reduce && <span key={active} className="forge-ring pointer-events-none absolute inset-0 rounded-2xl border border-primary/70" />}
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-500 ${
                        on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-4" strokeWidth={1.6} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{tr.forge.demo[k].block}</span>
                    <span
                      aria-hidden="true"
                      className={`relative hidden h-4 w-7 shrink-0 rounded-full transition-colors duration-500 sm:block ${on ? "bg-primary" : "bg-muted"}`}
                    >
                      <span
                        className={`absolute top-0.5 size-3 rounded-full bg-background transition-[inset-inline-start] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                          on ? "start-[calc(100%-0.875rem)]" : "start-0.5"
                        }`}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── phone ───────────────────────────────────────────────── */}
          <div className="relative bg-gradient-to-b from-muted/40 to-transparent p-4 sm:p-5">
            <div className="mx-auto flex min-h-[21rem] w-full max-w-[17rem] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background shadow-[0_24px_60px_-20px_hsl(var(--primary)/0.35)]">
              <div className="flex items-center gap-2.5 border-b border-border/70 bg-card px-3.5 py-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-amber-400 text-primary-foreground">
                  <Send className="size-3.5 -translate-x-px" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1" dir="ltr">
                  <span className="block truncate text-sm font-bold leading-tight">IrForge Bot</span>
                  <span className="flex items-center gap-1 text-[11px] leading-tight text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    {tr.demoBotStatus}
                  </span>
                </span>
              </div>

              <div className="flex flex-1 flex-col justify-end gap-2 p-3" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={active}
                    className="flex flex-col gap-2"
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.38, ease: EASE }}
                  >
                    <div className="max-w-[85%] self-end rounded-2xl rounded-ee-md bg-primary px-3 py-2 text-[13px] leading-relaxed text-primary-foreground">
                      {demo.user}
                    </div>

                    {phase === 1 && (
                      <div className="flex w-14 items-center justify-center gap-1 self-start rounded-2xl rounded-es-md bg-muted px-3 py-3" aria-hidden="true">
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            className="size-1.5 rounded-full bg-muted-foreground"
                            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.14, ease: "easeInOut" }}
                          />
                        ))}
                      </div>
                    )}

                    {phase === 2 && (
                      <>
                        <motion.div
                          className="max-w-[88%] self-start rounded-2xl rounded-es-md bg-muted px-3 py-2 text-[13px] leading-relaxed"
                          initial={reduce ? false : { opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.4, ease: EASE }}
                        >
                          {demo.bot}
                        </motion.div>
                        <div className="grid grid-cols-2 gap-1.5 self-stretch">
                          {[demo.btnA, demo.btnB].map((label, i) => (
                            <motion.span
                              key={label}
                              className="truncate rounded-xl border border-primary/30 bg-primary/10 px-2 py-1.5 text-center text-xs font-semibold text-primary"
                              initial={reduce ? false : { opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.35, ease: EASE, delay: 0.12 + i * 0.08 }}
                            >
                              {label}
                            </motion.span>
                          ))}
                        </div>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-2 border-t border-border/70 bg-card px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate rounded-full bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">
                  {tr.demoInputPlaceholder}
                </span>
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Send className="size-3.5 rtl-flip" strokeWidth={1.8} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </Bezel>
    </motion.div>
  );
}
