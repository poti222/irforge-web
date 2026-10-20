import * as React from "react"

import { cn } from "@/lib/utils"
import { EmojiField, useMergedRef } from "@/components/emoji/with-emoji"

type InputProps = React.ComponentProps<"input"> & {
  /**
   * دکمه‌یِ ایموجیِ متحرک — **opt-in** (داخلِ `EmojiProvider`). عمداً پیش‌فرض خاموش است: برچسبِ دکمه‌هایِ تلگرام،
   * نامِ کامند، لینک و شناسه ایموجیِ متنی نمی‌گیرند (تلگرام entity را فقط در متنِ پیام/کپشن می‌پذیرد).
   * فیلدهایِ تیترِ پیام را با `emoji` روشن کنید.
   */
  emoji?: boolean
}

const TEXT_LIKE = new Set<string | undefined>(["text", undefined])

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, emoji, ...props }, ref) => {
    const [inner, setRef] = useMergedRef<HTMLInputElement>(ref)
    const on = Boolean(emoji) && TEXT_LIKE.has(type) && !props.disabled && !props.readOnly
    return (
      <EmojiField enabled={on} fieldRef={inner} multiline={false}>
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-lg border border-input bg-background/60 px-3 py-1 text-base shadow-[inset_0_1px_2px_hsl(24_30%_10%/.05)] transition-[color,box-shadow,border-color] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            on && "pe-9",
            className
          )}
          ref={setRef}
          {...props}
        />
      </EmojiField>
    )
  }
)
Input.displayName = "Input"

export { Input }
