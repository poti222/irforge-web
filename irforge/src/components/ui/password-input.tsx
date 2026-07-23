import * as React from "react";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PasswordInputProps extends React.ComponentProps<typeof Input> {
  /** Controlled reveal state (e.g. so a parent mascot can react to it). Omit to manage internally. */
  show?: boolean;
  onShowChange?: (show: boolean) => void;
  /**
   * Fires when focus enters or leaves this field OR its reveal toggle,
   * treated as one unit (W7: so a parent mascot doesn't see "blurred" just
   * because the user clicked the eye icon, which moves DOM focus to that
   * button). Doesn't affect react-hook-form's own onBlur/onChange, which
   * still pass through normally via the spread props.
   */
  onFocusedChange?: (focused: boolean) => void;
}

/**
 * V1: password field with a show/hide eye toggle. Wraps the shared Input so the
 * toggle logic lives in one place instead of being duplicated on login and
 * register. Defaults to hidden; forwards ref + all Input props so it drops into
 * react-hook-form's `{...field}` unchanged.
 *
 * `show`/`onShowChange` are optional — omit them for the original
 * self-contained behavior, or pass them (W7) so a parent (e.g. LoginMascot)
 * can see and react to the reveal state.
 */
const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, show: showProp, onShowChange, onFocusedChange, ...props }, ref) => {
    const [showState, setShowState] = React.useState(false);
    const show = showProp !== undefined ? showProp : showState;

    function setShow(next: boolean) {
      onShowChange?.(next);
      if (showProp === undefined) setShowState(next);
    }

    // Group focus tracking: the input and its toggle button count as one
    // field. Only report "unfocused" once focus actually leaves both.
    function handleGroupFocus() {
      onFocusedChange?.(true);
    }
    function handleGroupBlur(e: React.FocusEvent<HTMLDivElement>) {
      const next = e.relatedTarget;
      if (!(next instanceof Node) || !e.currentTarget.contains(next)) {
        onFocusedChange?.(false);
      }
    }

    return (
      <div
        className="relative"
        onFocus={onFocusedChange ? handleGroupFocus : undefined}
        onBlur={onFocusedChange ? handleGroupBlur : undefined}
      >
        <Input
          ref={ref}
          type={show ? "text" : "password"}
          className={cn("pe-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          tabIndex={-1}
          data-password-toggle
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
