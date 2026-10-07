import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One header for every signed-in page: small eyebrow, big title with an ember
 * tick, optional description, actions on the opposite edge. Replaces the
 * ad-hoc `<h1 className="text-2xl font-bold">` + button rows.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 items-center gap-4">
        {icon && (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20 [&_svg]:size-6">
            {icon}
          </span>
        )}
        <div className="min-w-0 space-y-1.5">
          {eyebrow && (
            <p className="flex items-center gap-2 text-xs font-medium text-primary">
              <span className="h-px w-5 bg-primary/60" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </header>
  );
}
