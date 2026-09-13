/**
 * TutorialDrawer.tsx — IRFORGE_TUTORIAL_SYSTEM_PROMPT.
 *
 * پنلِ درون‌برنامه‌ایِ چندقدمی: عنوان + تصویرِ واقعیِ همان بخش + ۲-۳ خط
 * توضیح + دکمه‌یِ بعدی/قبلی. با بستن یا رفتن به یک بخشِ دیگر، قدم دوباره از
 * صفر شروع می‌شود — عمداً state را persist نمی‌کند چون هربار که کاربر
 * «آموزش» را باز می‌کند، منطقی‌ست از اول ببیندش.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import type { TutorialStep } from "@/lib/tutorials/content";

export function TutorialDrawer({
  open,
  onOpenChange,
  title,
  steps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  steps: TutorialStep[];
}) {
  const t = useT("tutorial");
  const [index, setIndex] = useState(0);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setIndex(0);
  }

  const step = steps[index];
  const isLast = index === steps.length - 1;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="size-5 shrink-0 text-primary" aria-hidden="true" />
            {title}
          </SheetTitle>
        </SheetHeader>

        {step && (
          <div className="mt-4 space-y-4">
            <p className="text-xs font-medium text-muted-foreground">
              {t.stepLabel
                .replace("{current}", String(index + 1))
                .replace("{total}", String(steps.length))}
            </p>

            <div className="overflow-hidden rounded-lg border">
              <img
                src={step.image}
                alt={step.title}
                className="w-full"
                loading="lazy"
              />
            </div>

            <div className="space-y-1.5">
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronRight className="size-4" />
                {t.prev}
              </Button>

              <div className="flex items-center gap-1.5">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={`size-1.5 rounded-full ${
                      i === index ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              {isLast ? (
                <Button size="sm" onClick={() => close(false)}>
                  {t.finish}
                </Button>
              ) : (
                <Button size="sm" onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}>
                  {t.next}
                  <ChevronLeft className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
