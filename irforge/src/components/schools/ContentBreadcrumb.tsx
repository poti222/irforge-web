import { Fragment } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";

export interface Crumb {
  label: string;
  /** بدونِ href = صفحه‌یِ فعلی (آخرین خرده‌نان). */
  href?: string;
}

/**
 * خرده‌نانِ چهارسطحیِ بخشِ «درس‌ها» (درس‌ها › ادبیات › درس ۳ › لغت‌نامه).
 * جداکننده با `ltr:rotate-180` در راست‌به‌چپ رو به چپ و در چپ‌به‌راست رو به
 * راست است؛ در موبایل افقی اسکرول می‌شود تا شکستنِ خط، سلسله‌مراتب را بهم نریزد.
 */
export function ContentBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <ol className="flex w-max min-w-full items-center gap-1 text-sm text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${i}-${c.label}`}>
              <li className="flex items-center">
                {c.href && !last ? (
                  <Link href={c.href} className="inline-flex min-h-9 items-center rounded-md px-1.5 hover:bg-muted hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={last ? "px-1.5 font-medium text-foreground" : "px-1.5"}>
                    {c.label}
                  </span>
                )}
              </li>
              {!last && <ChevronLeft aria-hidden className="size-4 shrink-0 opacity-60 ltr:rotate-180" />}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** نوارِ باریکِ تسلط (درصدِ «بلدم» رویِ آیتم‌هایِ قابلِ‌مطالعه) — div ساده، بدونِ وابستگیِ اضافه. */
export function MasteryBar({ mastered, total, barClass = "bg-primary", label }: { mastered: number; total: number; barClass?: string; label: string }) {
  if (total <= 0) return null;
  const pct = Math.round((mastered / total) * 100);
  return (
    <div className="flex flex-col gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{pct.toLocaleString("fa-IR")}٪</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
