import * as React from "react"

import { cn } from "@/lib/utils"
import { EmojiField, useMergedRef } from "@/components/emoji/with-emoji"

type TextareaProps = React.ComponentProps<"textarea"> & {
  /** داخلِ `EmojiProvider` پیش‌فرض روشن است (دکمه‌یِ ایموجیِ متحرک)؛ با `emoji={false}` خاموش می‌شود. */
  emoji?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, emoji = true, ...props }, ref) => {
    const [inner, setRef] = useMergedRef<HTMLTextAreaElement>(ref)
    return (
      <EmojiField enabled={emoji && !props.disabled && !props.readOnly} fieldRef={inner} multiline>
        <textarea
          className={cn(
            "flex min-h-[60px] w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-base shadow-[inset_0_1px_2px_hsl(24_30%_10%/.05)] transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className
          )}
          ref={setRef}
          {...props}
        />
      </EmojiField>
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
