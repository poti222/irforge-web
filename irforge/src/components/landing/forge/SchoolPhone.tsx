import { motion, useReducedMotion } from "framer-motion";
import { ClipboardCheck, GraduationCap, Megaphone, Send } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { Bezel } from "./Bezel";

/**
 * The school section's visual: what a parent actually sees on Telegram. The
 * names and numbers are illustrative sample messages (labelled as such).
 */
export function SchoolPhone() {
  const tr = useT("landing");
  const reduce = !!useReducedMotion();
  const msgs = [
    { icon: ClipboardCheck, text: tr.forge.schoolMsg1, tone: "bg-amber-400/15 text-amber-300", time: "08:42" },
    { icon: GraduationCap, text: tr.forge.schoolMsg2, tone: "bg-emerald-400/15 text-emerald-300", time: "11:05" },
    { icon: Megaphone, text: tr.forge.schoolMsg3, tone: "bg-primary/15 text-primary", time: "13:30" },
  ];

  return (
    <div className="forge-dark dark relative mx-auto w-full max-w-sm text-foreground">
      <div className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
      <Bezel innerClassName="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-amber-400 text-primary-foreground">
            <GraduationCap className="size-4" strokeWidth={1.7} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold leading-tight">{tr.forge.schoolPhoneTitle}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">{tr.forge.schoolPhoneExample}</span>
          </span>
          <Send className="size-4 text-muted-foreground" strokeWidth={1.6} />
        </div>

        <ul className="space-y-2.5 p-4">
          {msgs.map((m, i) => (
            <motion.li
              key={m.text}
              className="flex items-start gap-3 rounded-2xl bg-muted/70 p-3"
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1], delay: i * 0.14 }}
            >
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${m.tone}`}>
                <m.icon className="size-4" strokeWidth={1.6} />
              </span>
              <p className="min-w-0 flex-1 text-[13px] leading-relaxed">{m.text}</p>
              <span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground" dir="ltr">{m.time}</span>
            </motion.li>
          ))}
        </ul>
      </Bezel>
    </div>
  );
}
