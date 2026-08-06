import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// Drives the orange auto-dismiss progress bar. Counts down `duration` ms of
// real elapsed time, freezing (and later resuming from the same point,
// rather than restarting) whenever `paused` is true. Remount this component
// (via a changing `key` on the parent) to restart the countdown from full.
function ToastAutoCloseBar({
  duration,
  paused,
  onExpire,
}: {
  duration: number
  paused: boolean
  onExpire: () => void
}) {
  const [remainingRatio, setRemainingRatio] = React.useState(1)
  const remainingMsRef = React.useRef(duration)
  const lastTickRef = React.useRef(
    typeof performance !== "undefined" ? performance.now() : Date.now()
  )
  const rafRef = React.useRef<number | undefined>(undefined)
  const expiredRef = React.useRef(false)
  const onExpireRef = React.useRef(onExpire)
  onExpireRef.current = onExpire

  React.useEffect(() => {
    lastTickRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now()

    const tick = () => {
      if (expiredRef.current) return

      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now()

      if (paused) {
        // Freeze the clock while hovered; resume counting from "now" once
        // the pointer leaves, instead of restarting from the beginning.
        lastTickRef.current = now
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const elapsed = now - lastTickRef.current
      lastTickRef.current = now
      remainingMsRef.current -= elapsed

      if (remainingMsRef.current <= 0) {
        expiredRef.current = true
        setRemainingRatio(0)
        onExpireRef.current()
        return
      }

      setRemainingRatio(remainingMsRef.current / duration)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // Only `paused` should re-arm the loop; `duration` changes are handled
    // by remounting this component via a changing `key` on the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-foreground/10"
      aria-hidden="true"
    >
      <div
        className="h-full bg-orange-500"
        style={{ width: `${remainingRatio * 100}%` }}
      />
    </div>
  )
}

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants> & {
      /**
       * Whether to show the orange auto-dismiss progress bar and call
       * onOpenChange(false) once it runs out. Defaults to true.
       */
      autoClose?: boolean
      /** Auto-dismiss duration in ms. Defaults to 5000. */
      duration?: number
      /**
       * Change this value to restart the auto-dismiss countdown from full,
       * even though the toast's id stayed the same (e.g. once a 20s
       * status-propagation countdown finishes and the final message is
       * shown, the 5s auto-close should start fresh from that point).
       */
      autoCloseKey?: string | number
    }
>(
  (
    {
      className,
      variant,
      autoClose = true,
      duration = 5000,
      autoCloseKey,
      onOpenChange,
      onMouseEnter,
      onMouseLeave,
      children,
      ...props
    },
    ref
  ) => {
    const [paused, setPaused] = React.useState(false)

    return (
      <ToastPrimitives.Root
        ref={ref}
        className={cn(toastVariants({ variant }), className)}
        onOpenChange={onOpenChange}
        onMouseEnter={(event) => {
          setPaused(true)
          onMouseEnter?.(event)
        }}
        onMouseLeave={(event) => {
          setPaused(false)
          onMouseLeave?.(event)
        }}
        {...props}
      >
        {children}
        {autoClose && (
          <ToastAutoCloseBar
            key={String(autoCloseKey ?? "default")}
            duration={duration}
            paused={paused}
            onExpire={() => onOpenChange?.(false)}
          />
        )}
      </ToastPrimitives.Root>
    )
  }
)
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
