import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useNotifications } from "@/hooks/use-notifications";
import { severityIcon } from "@/lib/notification-severity";
import { isRtlLang } from "@/lib/i18n";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

export default function Notifications() {
  usePrivatePageTitle(useT("pageTitles").notifications);
  const { lang } = useLanguage();
  const t = useT("notifications");
  const { notifications, unreadCount, isLoading, markAllRead } = useNotifications();
  // شِوران باید به سمت «جلو» اشاره کند، که در RTL یعنی چپ.
  const Chevron = isRtlLang(lang) ? ChevronLeft : ChevronRight;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bell className="size-5" /> {t.title}
        </h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => markAllRead()}>
            <CheckCheck className="size-4" /> {t.markAllRead}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : notifications.length === 0 ? (
        <p className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
          {t.empty}
        </p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Link key={n.id} href={`/notifications/${n.id}`}>
              <Card className={`cursor-pointer transition-colors hover:border-primary/50 ${n.read ? "opacity-70" : ""}`}>
                <CardContent className="flex items-start gap-3 p-4">
                  {severityIcon(n.severity, "size-5 shrink-0 mt-0.5")}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{n.title}</p>
                      {!n.read && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t.unread}
                        </span>
                      )}
                    </div>
                    {/* در لیست، متن عمداً به دو خط محدود می‌شود — متن کامل در
                        صفحه‌ی جزئیات همان اعلان است. */}
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.message}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground/70">
                      {new Date(n.createdAt).toLocaleString(lang)}
                    </p>
                  </div>
                  <Chevron className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
