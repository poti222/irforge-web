import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bot, SendHorizontal } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useIsMobileViewport } from "./use-is-mobile-viewport";

/**
 * Hero product shot: a Telegram-style conversation window that plays a short,
 * scripted exchange once on mount.
 *
 * Deliberately NOT a loop — it runs a single pass on both mobile and desktop
 * and then holds. Under `prefers-reduced-motion` the whole transcript is
 * rendered immediately with no typing indicator. The message list has a fixed
 * height and stacks from the bottom, so revealing lines never reflows the page
 * (no layout shift, and nothing but transform/opacity is animated).
 */

type Author = "user" | "bot";
type Line = { from: Author; text: string; mono?: boolean };

// how long the "typing…" bubble shows before a bot line, and the gap after
// each revealed line
const TYPING_MS = 850;
const GAP_MS = 650;

export function BotChatMockup({ className }: { className?: string }) {
  const tr = useT("landing");
  const { lang } = useLanguage();
  const reduce = useReducedMotion();
  const isMobile = useIsMobileViewport();
  // the "typing…" dots are the only looping element in here — mobile gets the
  // transcript without them, per the no-loops-on-mobile rule
  const showTyping = !reduce && !isMobile;

  const lines: Line[] = [
    { from: "user", text: "/start", mono: true },
    { from: "bot", text: tr.demoBotReply1 },
    { from: "user", text: "/report", mono: true },
    { from: "bot", text: tr.demoBotReply2 },
  ];
  const total = lines.length;

  const [shown, setShown] = useState(reduce ? total : 0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduce) {
      setShown(total);
      setTyping(false);
      return;
    }
    // replay from the top whenever the language flips (the text changes)
    setShown(0);
    setTyping(false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 500;
    for (let i = 0; i < total; i++) {
      if (lines[i].from === "bot" && showTyping) {
        timers.push(setTimeout(() => setTyping(true), at));
        at += TYPING_MS;
      }
      const next = i + 1;
      timers.push(
        setTimeout(() => {
          setTyping(false);
          setShown(next);
        }, at)
      );
      at += GAP_MS;
    }
    return () => timers.forEach(clearTimeout);
    // `lines` is rebuilt every render; `lang` is what actually changes its content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, lang, total, showTyping]);

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${className ?? ""}`}
    >
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold text-foreground">IrForge Bot</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {tr.demoBotStatus}
          </div>
        </div>
        {/* the header's end side is deliberately left empty — the hero mascot
            overlaps this corner */}
      </div>

      {/* transcript — fixed height, bottom-aligned: no reflow as lines land */}
      <div className="flex h-[236px] flex-col justify-end gap-2 px-4 py-4 sm:h-[252px]">
        {lines.slice(0, shown).map((line, i) => (
          <ChatBubble key={i} line={line} reduce={!!reduce} />
        ))}
        {typing && <TypingBubble />}
      </div>

      {/* fake composer — decorative only, not a real input */}
      <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-3">
        <div className="flex-1 truncate rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          {tr.demoInputPlaceholder}
        </div>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <SendHorizontal className="size-3.5 rtl-flip" />
        </span>
      </div>
    </div>
  );
}

function ChatBubble({ line, reduce }: { line: Line; reduce: boolean }) {
  const isBot = line.from === "bot";
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduce ? 0.2 : 0.28, ease: "easeOut" }}
      className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm sm:text-sm ${
        isBot
          ? "me-auto rounded-es-md border border-border bg-muted text-foreground"
          : "ms-auto rounded-ee-md bg-primary text-primary-foreground"
      }`}
      dir={line.mono ? "ltr" : undefined}
    >
      <span className={line.mono ? "font-mono" : undefined}>{line.text}</span>
    </motion.div>
  );
}

function TypingBubble() {
  return (
    <div className="me-auto flex items-center gap-1 rounded-2xl rounded-es-md border border-border bg-muted px-3 py-2.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground/70"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}
