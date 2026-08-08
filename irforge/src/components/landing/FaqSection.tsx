import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { useT } from "@/hooks/use-translation";
import { RevealItem, VIEWPORT_ONCE, revealContainer, revealItem } from "./motion";

/**
 * Landing FAQ.
 *
 * Built on native <details>/<summary> rather than the Radix accordion on
 * purpose: Radix unmounts collapsed content, so the answers would be absent
 * from the prerendered HTML. Google requires an FAQPage answer to be present
 * in the markup it receives, and these same strings are mirrored into the
 * FAQPage schema — so the text has to be in the DOM whether or not anything
 * is expanded.
 */
export function FaqSection({ reduce, stagger }: { reduce: boolean; stagger: number }) {
  const faq = useT("faq");

  const items = [
    { q: faq.q1, a: faq.a1 },
    { q: faq.q2, a: faq.a2 },
    { q: faq.q3, a: faq.a3 },
    { q: faq.q4, a: faq.a4 },
    { q: faq.q5, a: faq.a5 },
  ].filter((item) => item.q && item.a);

  if (!items.length) return null;

  const item = revealItem(reduce);

  return (
    <section className="border-t py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div
          variants={revealContainer(stagger)}
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT_ONCE}
        >
          <RevealItem variants={item}>
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{faq.title}</h2>
              <p className="mt-3 text-muted-foreground">{faq.subtitle}</p>
            </div>
          </RevealItem>

          <div className="mx-auto max-w-3xl space-y-3">
            {items.map((entry) => (
              <RevealItem key={entry.q} variants={item}>
                <details className="group rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-start font-semibold [&::-webkit-details-marker]:hidden">
                    <h3 className="text-base">{entry.q}</h3>
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{entry.a}</p>
                </details>
              </RevealItem>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
