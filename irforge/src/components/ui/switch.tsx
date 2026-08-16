import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    {/*
      جابه‌جایی دستگیره باید **جهت‌آگاه** باشد.

      `translate-x-4` یک ترنسفورم فیزیکی است و همیشه به راست می‌برد، مهم نیست
      `dir` چه باشد. در حالت راست‌به‌چپ، شروعِ ریل سمت راست است و رادیکس
      دستگیره را همان‌جا می‌گذارد؛ بعد این ترنسفورم بازهم به راست هلش می‌داد و
      دستگیره **از ریل بیرون می‌زد** — همان دایره‌ی تیره‌ای که کنار سوئیچ نارنجی
      دیده می‌شد و کل سوئیچ را خراب نشان می‌داد.

      دو واریانت جدا (نه یکی روی دیگری) تا هیچ‌وقت به ترتیب قوانین CSS تکیه
      نکنیم؛ `dir` همیشه صریح ست می‌شود (`use-language.ts`)، پس هر دو حالت
      پوشش داده شده‌اند.
    */}
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
        "data-[state=unchecked]:translate-x-0",
        "ltr:data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
