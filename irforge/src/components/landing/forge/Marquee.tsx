import { useT } from "@/hooks/use-translation";

/** Slow-scrolling strip of what the platform really does (copy: landing.forge.capabilities). */
export function CapabilityMarquee() {
  const tr = useT("landing");
  const items = tr.forge.capabilities;
  const row = (suffix: string, hidden: boolean) =>
    items.map((label, i) => (
      <li
        key={`${suffix}${i}`}
        aria-hidden={hidden || undefined}
        className="flex shrink-0 items-center gap-3 whitespace-nowrap text-sm font-medium text-muted-foreground"
      >
        <span className="size-1.5 rounded-full bg-primary/70" />
        {label}
      </li>
    ));
  return (
    <div
      className="forge-marquee relative overflow-hidden py-7 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
      role="region"
      aria-label={tr.forge.capabilitiesLabel}
    >
      <ul className="forge-marquee-track flex w-max gap-10 pe-10">
        {row("a", false)}
        {row("b", true)}
      </ul>
    </div>
  );
}
