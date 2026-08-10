import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";
import {
  ctaForType,
  severityIcon,
  SEVERITY_STRIP_CLASS,
} from "@/lib/notification-severity";
import { isRtlLang } from "@/lib/i18n";

export default function NotificationDetail() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useLanguage();
  const t = useT("notifications");
  const { markRead } = useNotifications();
  // فلش «برگشت» باید به عقب اشاره کند، که در RTL یعنی راست.
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  const { data, isLoading, error } = useQuery({
    queryKey: ["notification", id],
    queryFn: () => customFetch<AppNotification>(`/api/notifications/${id}`),
    enabled: Boolean(id),
    retry: false,
  });

  // خواندهشدن را صفحه صراحتاً اعلام می‌کند — خودِ GET این کار را نمی‌کند، تا
  // یک prefetch یا رفرش نتواند بی‌صدا بج را پاک کند.
  useEffect(() => {
    if (data && !data.read) void markRead(data.id);
    // markRead هر رندر یک تابع تازه است؛ فقط به id/read وابسته‌ایم.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.read]);

  const cta = data ? ctaForType(data.type, data.refId) : null;
  const ctaLabel = cta
    ? ({ tickets: t.ctaTickets, invoices: t.ctaInvoices, buyBot: t.ctaBuyBot, wallet: t.ctaWallet, bots: t.ctaBots, update: t.ctaUpdate }[cta.key])
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" className="gap-1.5 px-2" asChild>
        <Link href="/notifications">
          <BackArrow className="size-4" /> {t.back}
        </Link>
      </Button>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-md bg-muted" />
          <div className="h-40 animate-pulse rounded-md bg-muted" />
        </div>
      ) : error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {(error as any)?.status === 404 ? t.notFound : t.loadError}
        </p>
      ) : data ? (
        <article className="space-y-5">
          <header className={`flex items-start gap-3 rounded-md border p-4 ${SEVERITY_STRIP_CLASS[data.severity]}`}>
            {severityIcon(data.severity, "size-6 shrink-0 mt-0.5")}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">{data.title}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(data.createdAt).toLocaleString(lang, { dateStyle: "long", timeStyle: "short" })}
              </p>
            </div>
          </header>

          {/* whitespace-pre-wrap: پیام‌ها خط جدید دارند (دلیل رد شدن، یادداشت
              بررسی‌کننده و…) و بدون این، همه در یک پاراگراف به هم می‌چسبند. */}
          <p className="whitespace-pre-wrap text-base leading-relaxed">{data.message}</p>

          {cta && (
            <Button asChild>
              <Link href={cta.href}>{ctaLabel}</Link>
            </Button>
          )}
        </article>
      ) : null}
    </div>
  );
}
