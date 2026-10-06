import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Double-bezel card: an outer hairline "tray" with a concentric inner "core".
 * `spotlight` adds a pointer-following glow — driven through CSS variables
 * written straight to the node, so hovering never re-renders React.
 */
export function Bezel({
  children,
  className,
  innerClassName,
  spotlight = false,
  beam = false,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  spotlight?: boolean;
  /** a slow light travelling around the card's hairline border (hero demo) */
  beam?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = spotlight
    ? (e: React.PointerEvent<HTMLDivElement>) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
    : undefined;

  const tray = (
    <div
      ref={ref}
      onPointerMove={onMove}
      className={cn(
        "relative rounded-[2rem] p-1.5",
        beam ? "bg-background" : "bg-foreground/[0.035] ring-1 ring-foreground/10",
        spotlight && "forge-spot",
        !beam && className
      )}
    >
      <div
        className={cn(
          "relative h-full rounded-[calc(2rem-0.375rem)] bg-card shadow-[inset_0_1px_0_hsl(var(--foreground)/0.07)]",
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  );
  if (!beam) return tray;
  return (
    <div className={cn("relative overflow-hidden rounded-[2rem] bg-foreground/10 p-px", className)}>
      <span className="forge-beam-spin pointer-events-none" aria-hidden="true" />
      {tray}
    </div>
  );
}
