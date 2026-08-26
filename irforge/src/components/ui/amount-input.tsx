import * as React from "react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import { ANY_DIGIT_RE, digitsOnly, groupAmount } from "@/lib/digits";

export interface AmountInputProps extends Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> {
  /** Clean ASCII digit string — same shape a `type="number"` input's `value` would hold. */
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function countDigitsBefore(str: string, index: number): number {
  let count = 0;
  for (let i = 0; i < index && i < str.length; i++) {
    if (ANY_DIGIT_RE.test(str[i])) count++;
  }
  return count;
}

function positionAfterDigits(str: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (ANY_DIGIT_RE.test(str[i])) {
      count++;
      if (count === digitCount) return i + 1;
    }
  }
  return str.length;
}

/**
 * AmountInput — IRFORGE_PROMPT_V3 Phase 40.
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacement for `<Input type="number">` on Toman-amount fields.
 * See lib/digits.ts for why: a native number input can't be typed into at
 * all with a Persian/Arabic keyboard's digit keys, and gives no readable
 * grouping for a large Toman amount either.
 *
 * Same value/onChange contract as a native input — `value` is the plain
 * ASCII digit string, and `onChange`'s `event.target.value` is too — so an
 * existing `<Input type="number" value={amount} onChange={(e) =>
 * setAmount(e.target.value)} />` call site swaps in with no other changes.
 * Internally it folds whatever the visitor types/pastes (Persian digits,
 * Arabic-Indic digits, stray commas) down to that clean string, and shows a
 * separately-tracked, thousands-grouped `display` value instead of the raw
 * one — restoring the caret by digit-position (not character-position) after
 * every reformat, since grouping separators shift as digits are added.
 */
export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onChange, ...props }, forwardedRef) => {
    const { lang } = useLanguage();
    const innerRef = React.useRef<HTMLInputElement>(null);
    const caretDigits = React.useRef<number | null>(null);
    const [display, setDisplay] = React.useState(() => groupAmount(value, lang));

    // External resets (clearing the field after a successful submit, or a
    // parent re-seeding `value`) still need to show up even though this
    // component tracks its own `display` string day to day.
    React.useEffect(() => {
      setDisplay(groupAmount(value, lang));
    }, [value, lang]);

    React.useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el || caretDigits.current === null) return;
      const pos = positionAfterDigits(display, caretDigits.current);
      caretDigits.current = null;
      el.setSelectionRange(pos, pos);
    }, [display]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const el = e.target;
      const caret = el.selectionStart ?? el.value.length;
      caretDigits.current = countDigitsBefore(el.value, caret);
      const clean = digitsOnly(el.value);
      el.value = clean;
      onChange(e);
      setDisplay(groupAmount(clean, lang));
    }

    return (
      <Input
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={display}
        onChange={handleChange}
        {...props}
      />
    );
  }
);
AmountInput.displayName = "AmountInput";
