import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Embers } from "@/components/landing/forge/Embers";

/**
 * A steel-dark panel with an ember glow and rising sparks — the app-side
 * sibling of the landing hero frame. It re-skins its subtree dark regardless
 * of the page theme (`.forge-dark dark`), so anything placed inside (text,
 * badges, buttons, outline buttons) reads correctly in light mode too.
 */
export function ForgePanel({
  children,
  className,
  embers = 10,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  /** number of rising sparks; 0 disables */
  embers?: number;
  as?: "section" | "div" | "header";
}) {
  return (
    <Tag
      className={cn(
        "forge-dark dark relative isolate overflow-hidden rounded-3xl border border-white/10 bg-[hsl(222_16%_6%)] text-foreground",
        "shadow-[0_1px_0_hsl(0_0%_100%/.06)_inset,0_30px_60px_-30px_rgb(0_0_0/.7)]",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(520px 260px at 100% -10%, hsl(var(--primary) / .30), transparent 70%), radial-gradient(420px 240px at 0% 120%, hsl(var(--primary) / .14), transparent 70%)",
        }}
      />
      {embers > 0 && <Embers count={embers} className="-z-10" />}
      {children}
    </Tag>
  );
}
