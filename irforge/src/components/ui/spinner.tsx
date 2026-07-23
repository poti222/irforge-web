import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

const SPINNER_SIZES = {
  sm: "size-4",
  default: "size-6",
  lg: "size-8",
} as const

function Spinner({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"svg"> & { size?: keyof typeof SPINNER_SIZES }) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn(SPINNER_SIZES[size], "animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
