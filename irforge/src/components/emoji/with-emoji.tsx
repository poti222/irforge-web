import * as React from "react";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { useEmojiContext } from "./emoji-context";
import { insertAtCursor } from "@/lib/custom-emoji";
import { setNativeValue } from "@/lib/native-input";

/** ref داخلی + ref ارسالی از بیرون را هم‌زمان نگه می‌دارد. */
export function useMergedRef<T>(external: React.ForwardedRef<T>) {
  const inner = React.useRef<T | null>(null);
  const set = React.useCallback(
    (node: T | null) => {
      inner.current = node;
      if (typeof external === "function") external(node);
      else if (external) (external as React.MutableRefObject<T | null>).current = node;
    },
    [external],
  );
  return [inner, set] as const;
}

/**
 * دورِ یک `<textarea>`/`<input>` دکمه‌یِ ایموجی می‌گذارد. بیرونِ `EmojiProvider` (یا با `emoji={false}`)
 * هیچ چیزی عوض نمی‌شود و فیلد دقیقاً مثلِ قبل رندر می‌شود.
 */
export function EmojiField({
  enabled,
  fieldRef,
  multiline,
  children,
}: {
  enabled: boolean;
  fieldRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  multiline: boolean;
  children: React.ReactNode;
}) {
  const ctx = useEmojiContext();
  if (!enabled || !ctx) return <>{children}</>;

  const onPick = (token: string) => {
    const el = fieldRef.current;
    if (!el || el.disabled || el.readOnly) return;
    const { next, caret } = insertAtCursor(el.value, token, el.selectionStart, el.selectionEnd);
    setNativeValue(el, next);
    el.focus();
    requestAnimationFrame(() => el.setSelectionRange(caret, caret));
  };

  return (
    <div className="relative w-full">
      {children}
      <EmojiPickerButton onPick={onPick} className={multiline ? "absolute bottom-1.5 end-1.5" : "absolute end-1.5 top-1/2 -translate-y-1/2"} />
    </div>
  );
}
