/**
 * TelegramHtmlEditor.tsx — IRFORGE_POSTBOX_PROMPT Phase B3
 * ─────────────────────────────────────────────────────────────────────────────
 * "Whitelist-only rich editor, no free HTML" for a translation's `body_html`.
 * Unlike `CatalogSection.tsx`'s own body_html field (a bare `<Textarea>` with
 * a hint that says "you may use basic HTML tags" — the admin free-types raw
 * markup, relying entirely on server-side `sanitizeTelegramHtml()` to clean
 * it up after the fact), this editor never asks the admin to type a tag by
 * hand: a fixed toolbar wraps the current selection in exactly one of the
 * seven whitelisted inline tags. The underlying value is still a plain HTML
 * string (same `body_html` field, same server-side sanitizer as a second,
 * authoritative line of defense — this component is a UX guardrail, not the
 * security boundary), so nothing about the storage format or the save path
 * changes; only how the admin gets there does.
 *
 * A live rendered preview was deliberately left out: rendering
 * `dangerouslySetInnerHTML` of not-yet-saved, not-yet-sanitized input on the
 * client would be exactly the injection risk this whole feature exists to
 * avoid. The 3-tier character counter below the textarea (green/amber/red
 * against the 1024/4096 caption/message boundaries `plugins/catalog/
 * delivery.py::split_caption_and_overflow()` and `plugins/autoposter/
 * delivery.py` both already use) is the honest substitute: it tells the
 * admin how their text will actually be delivered, without pretending to
 * render Telegram's own formatting client-side.
 */
import { useRef } from "react";
import { Bold, Italic, Underline, Strikethrough, Code, EyeOff, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/use-translation";

const CAPTION_LIMIT = 1024;
const MESSAGE_LIMIT = 4096;

type ToolbarTag = { tag: string; icon: typeof Bold; labelKey: string; attr?: (text: string) => string };

const TOOLBAR_TAGS: ToolbarTag[] = [
  { tag: "b", icon: Bold, labelKey: "fmtBold" },
  { tag: "i", icon: Italic, labelKey: "fmtItalic" },
  { tag: "u", icon: Underline, labelKey: "fmtUnderline" },
  { tag: "s", icon: Strikethrough, labelKey: "fmtStrike" },
  { tag: "code", icon: Code, labelKey: "fmtCode" },
  { tag: "tg-spoiler", icon: EyeOff, labelKey: "fmtSpoiler" },
];

export function TelegramHtmlEditor({
  value, onChange, rows = 6,
}: { value: string; onChange: (next: string) => void; rows?: number }) {
  const t = useT("botPostbox");
  const ref = useRef<HTMLTextAreaElement>(null);

  function wrap(open: string, close: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + open + selected + close + value.slice(end);
    onChange(next);
    // نشانگر را بعدِ متنِ درج‌شده برمی‌گرداند -- بدونِ این، فوکوس گم می‌شود.
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + open.length + selected.length + close.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function applyTag(tag: string) {
    wrap(`<${tag}>`, `</${tag}>`);
  }

  function applyLink() {
    const url = window.prompt(t.linkPrompt) ?? "";
    if (!url.trim()) return;
    wrap(`<a href="${url.trim()}">`, "</a>");
  }

  const len = value.length;
  const tier = len === 0 ? "empty" : len <= CAPTION_LIMIT ? "caption" : len <= MESSAGE_LIMIT ? "message" : "over";
  const tierClass = {
    empty: "text-muted-foreground",
    caption: "text-emerald-600 dark:text-emerald-400",
    message: "text-amber-600 dark:text-amber-400",
    over: "text-destructive",
  }[tier];
  const tierLabel = {
    empty: t.lengthTierEmpty,
    caption: t.lengthTierCaption,
    message: t.lengthTierMessage,
    over: t.lengthTierOver,
  }[tier];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1">
        {TOOLBAR_TAGS.map(({ tag, icon: Icon, labelKey }) => (
          <Button
            key={tag} type="button" variant="ghost" size="icon" className="size-7"
            title={(t as unknown as Record<string, string>)[labelKey]}
            onClick={() => applyTag(tag)}
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
        <Button type="button" variant="ghost" size="icon" className="size-7" title={t.fmtLink} onClick={applyLink}>
          <LinkIcon className="size-3.5" />
        </Button>
      </div>
      <Textarea ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} dir="auto" />
      <p className={`text-xs ${tierClass}`}>
        {len.toLocaleString()} — {tierLabel}
      </p>
    </div>
  );
}
