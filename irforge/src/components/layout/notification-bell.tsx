import { useState } from "react";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useNotifications } from "@/hooks/use-notifications";
import { SEVERITY_DOT_CLASS, severityIcon } from "@/lib/notification-severity";
import { useReducedMotion } from "framer-motion";

/** پاپ‌اور فقط تازه‌ترین‌ها را نشان می‌دهد؛ بقیه در صفحه‌ی «اعلان‌ها». */
const POPOVER_LIMIT = 6;

export function NotificationBell() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("notifications");
  const { notifications, unreadCount, topSeverity, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          aria-label={fa ? "اعلان‌ها" : "Notifications"}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && topSeverity && (
            <span
              className={`absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${SEVERITY_DOT_CLASS[topSeverity]} ${
                topSeverity === "critical" && !reducedMotion ? "animate-pulse" : ""
              }`}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-semibold">{t.title}</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => markAllRead()}>
              <CheckCheck className="size-3.5" /> {t.markAllRead}
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {notifications.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t.empty}
            </p>
          ) : (
            notifications.slice(0, POPOVER_LIMIT).map((n) => (
              <Link
                key={n.id}
                href={`/notifications/${n.id}`}
                onClick={() => setOpen(false)}
                className={`flex w-full items-start gap-2.5 border-b p-3 text-start last:border-0 hover:bg-muted/50 ${n.read ? "opacity-60" : "bg-muted/20"}`}
              >
                {severityIcon(n.severity)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  {/* پیش‌نمایش کوتاه — متن کامل در صفحه‌ی جزئیات همین اعلان */}
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                </div>
                {!n.read && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
              </Link>
            ))
          )}
        </div>
        <div className="space-y-1.5 border-t p-2">
          {notifications.some((n) => n.type.startsWith("trial_")) && (
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href="/buy-bot" onClick={() => setOpen(false)}>
                {t.ctaBuyBot}
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/notifications" onClick={() => setOpen(false)}>
              {t.viewAll}
              {notifications.length > POPOVER_LIMIT ? ` (${notifications.length})` : ""}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
