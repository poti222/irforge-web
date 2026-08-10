import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

export const PENDING_REGISTRATIONS_KEY = ["admin-pending-registrations"] as const;

/**
 * ثبت‌نام‌های نیمه‌کاره.
 *
 * ⚠️ این داده‌ی شخصی است — نام، شماره و ایمیل واقعیِ کسانی که ثبت‌نامشان را
 * تمام نکرده‌اند و با هیچ چیزی موافقت نکرده‌اند. این نما عمداً **فقط گزارشی**
 * است: نه خروجی، نه ایمیل گروهی، نه پیام گروهی. اگر روزی لازم شد، به یک
 * چک‌باکس رضایت در گام ۲ نیاز دارد، نه یک دکمه‌ی اضافه در این صفحه.
 *
 * ارزش واقعی این جدول ستون «گام» است: انبوهی ردیف گیرکرده روی
 * `telegram_pending` یعنی مرحله‌ی اتصال خراب یا گیج‌کننده است — و این چیزی است
 * که باید ظرف یک روز فهمید، نه یک فصل.
 */
const STEPS = ["identity", "telegram_pending", "code_sent", "code_verified"] as const;

const STEP_LABEL: Record<string, { fa: string; en: string }> = {
  identity: { fa: "هویت وارد شد", en: "Identity entered" },
  telegram_pending: { fa: "منتظر تلگرام", en: "Waiting for Telegram" },
  code_sent: { fa: "کد ارسال شد", en: "Code sent" },
  code_verified: { fa: "کد تأیید شد", en: "Code verified" },
};

type Row = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  telegramUsername: string | null;
  step: string;
  createdAt: string;
  lastActivityAt: string;
};

export function PendingRegistrations() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<string>("all");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [...PENDING_REGISTRATIONS_KEY, step],
    queryFn: () =>
      customFetch<{ items: Row[]; total: number }>(
        `/api/admin/pending-registrations?perPage=50${step !== "all" ? `&step=${step}` : ""}`,
      ),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: PENDING_REGISTRATIONS_KEY });

  const remove = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/admin/pending-registrations/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: fa ? "حذف شد" : "Deleted" }); },
  });

  const purge = useMutation({
    mutationFn: () =>
      customFetch("/api/admin/pending-registrations/purge", {
        method: "POST",
        body: JSON.stringify({ olderThanDays: 30 }),
      }),
    onSuccess: (res: any) => {
      invalidate();
      toast({ title: fa ? `${res.deleted} ردیف حذف شد` : `${res.deleted} rows deleted` });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={step} onValueChange={setStep}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{fa ? "همه‌ی گام‌ها" : "All steps"}</SelectItem>
            {STEPS.map((s) => (
              <SelectItem key={s} value={s}>{fa ? STEP_LABEL[s].fa : STEP_LABEL[s].en}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && <Badge variant="secondary">{data.total}</Badge>}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="ms-auto" disabled={purge.isPending}>
              {fa ? "حذف قدیمی‌تر از ۳۰ روز" : "Delete older than 30 days"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{fa ? "حذف گروهی؟" : "Bulk delete?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {fa
                  ? "همه‌ی ثبت‌نام‌های نیمه‌کاره‌ی قدیمی‌تر از ۳۰ روز برای همیشه حذف می‌شوند."
                  : "Every incomplete registration older than 30 days is permanently deleted."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
              <AlertDialogAction onClick={() => purge.mutate()}>
                {fa ? "حذف" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : isError ? (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-red-500">
              <AlertTriangle className="size-4" />
              {fa ? "خطا در بارگذاری" : "Failed to load"}
            </p>
            <p className="text-xs text-muted-foreground">{(error as any)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className="me-2 size-4" /> {fa ? "تلاش دوباره" : "Try again"}
            </Button>
          </CardContent>
        </Card>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.firstName} {r.lastName}</p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">
                    {[r.email, r.phone, r.telegramUsername && `@${r.telegramUsername}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge variant="outline">
                  {fa ? STEP_LABEL[r.step]?.fa ?? r.step : STEP_LABEL[r.step]?.en ?? r.step}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.lastActivityAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={remove.isPending}>
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{fa ? "حذف این ردیف؟" : "Delete this row?"}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {fa ? "این کار قابل بازگشت نیست." : "This cannot be undone."}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove.mutate(r.id)}>
                        {fa ? "حذف" : "Delete"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          {fa ? "ثبت‌نام نیمه‌کاره‌ای وجود ندارد." : "No incomplete registrations."}
        </p>
      )}

      {/* هشدار دائمی، نه یک یادداشت در کد. */}
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        {fa
          ? "این افراد ثبت‌نامشان را تمام نکرده‌اند و با هیچ ارتباطی موافقت نکرده‌اند. این نما فقط برای گزارش است — برایشان پیام یا ایمیل تبلیغاتی نفرستید."
          : "These people did not finish signing up and agreed to nothing. This view is reporting only — do not message or email them."}
      </p>
    </div>
  );
}
