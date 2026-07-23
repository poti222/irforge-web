import { useState } from "react";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, AlertTriangle, Info, CheckCheck } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";

function severityIcon(severity: AppNotification["severity"]) {
  if (severity === "critical") return <AlertTriangle className="size-4 shrink-0 text-red-500" />;
  if (severity === "warning") return <AlertTriangle className="size-4 shrink-0 text-amber-500" />;
  return <Info className="size-4 shrink-0 text-primary" />;
}

export function NotificationBell() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          aria-label={fa ? "اعلان‌ها" : "Notifications"}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-semibold">{fa ? "اعلان‌ها" : "Notifications"}</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => markAllRead()}>
              <CheckCheck className="size-3.5" /> {fa ? "خواندن همه" : "Mark all read"}
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {notifications.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {fa ? "اعلانی نداری." : "No notifications."}
            </p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={`flex w-full items-start gap-2.5 border-b p-3 text-start last:border-0 hover:bg-muted/50 ${n.read ? "opacity-60" : "bg-muted/20"}`}
              >
                {severityIcon(n.severity)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                </div>
                {!n.read && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
              </button>
            ))
          )}
        </div>
        {notifications.some((n) => n.type.startsWith("trial_")) && (
          <div className="border-t p-2">
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href="/buy-bot" onClick={() => setOpen(false)}>
                {fa ? "مشاهده پکیج‌ها" : "View packages"}
              </Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
