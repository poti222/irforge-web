import { useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEmojiContext } from "./emoji-context";
import { emojiToken, type CustomEmoji } from "@/lib/custom-emoji";
import { cn } from "@/lib/utils";

/**
 * دکمه‌یِ انتخابِ ایموجیِ متحرک. `onPick` توکنِ `:name:` را می‌گیرد؛ والد آن را در محلِ مکان‌نما می‌گذارد.
 * فقط ایموجی‌هایِ **فعال** نشان داده می‌شوند (ادمین از «مدیریتِ ایموجی» انتخاب می‌کند).
 */
export function EmojiPickerButton({ onPick, className }: { onPick: (token: string) => void; className?: string }) {
  const ctx = useEmojiContext();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const enabled = useMemo(() => (ctx?.emojis ?? []).filter((e) => e.enabled), [ctx?.emojis]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? enabled.filter((e) => e.name.includes(s) || e.fallback.includes(s) || e.pack.toLowerCase().includes(s)) : enabled;
  }, [enabled, q]);

  if (!ctx) return null;

  const pick = (e: CustomEmoji) => {
    onPick(emojiToken(e.name));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="ایموجی متحرک"
          title="ایموجی متحرک"
          data-testid="emoji-picker-trigger"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary",
            className,
          )}
        >
          <Smile className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2" dir="rtl">
        {enabled.length === 0 ? (
          <p className="p-3 text-center text-xs leading-6 text-muted-foreground">
            هنوز ایموجی‌ای فعال نشده. از بخش «ایموجی‌ها» در پنل بات، پک اضافه و ایموجی‌ها را فعال کنید.
          </p>
        ) : (
          <>
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="جستجو…"
              className="mb-2 h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-primary/60"
            />
            <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto" role="listbox">
              {shown.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  role="option"
                  title={emojiToken(e.name)}
                  onClick={() => pick(e)}
                  className="flex size-10 items-center justify-center rounded-md text-xl hover:bg-primary/10"
                >
                  {e.fallback}
                </button>
              ))}
              {shown.length === 0 && <p className="col-span-6 p-3 text-center text-xs text-muted-foreground">موردی پیدا نشد.</p>}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
