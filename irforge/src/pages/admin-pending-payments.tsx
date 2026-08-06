import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  ExternalLink,
  User as UserIcon,
  Bot as BotIcon,
  Loader2,
  Inbox,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type PendingItem = {
  payment: { id: string; botId: string | null; receiptUrl: string | null; description: string | null; status: string; createdAt: string };
  bot: { id: string; name: string; username: string; status: string } | null;
  user: { id: string; name: string; email: string; telegramId: string | null } | null;
};

export default function AdminPendingPayments() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "pending-payments"],
    queryFn: () => customFetch<PendingItem[]>("/api/bots/pending-payments"),
  });

  async function act(botId: string, action: "approve" | "reject") {
    setBusy(botId + action);
    try {
      const res = await customFetch<{ success: boolean; adminCode?: string }>(
        `/api/bots/${botId}/${action}-payment`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (action === "approve") {
        toast({
          title: fa ? "پرداخت تأیید شد ✅" : "Payment approved ✅",
          description: res.adminCode
            ? `${fa ? "کد ادمین" : "Admin code"}: ${res.adminCode}`
            : undefined,
        });
      } else {
        toast({ title: fa ? "پرداخت رد شد" : "Payment rejected" });
      }
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            {fa ? "پرداخت‌های معلق" : "Pending Payments"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {fa ? "فیش‌های منتظر بررسی — تأیید کن تا شیت و کد ادمین ساخته بشه." : "Receipts awaiting review — approve to assign a sheet and issue an admin code."}
          </p>
        </div>
        {data && data.length > 0 && (
          <Badge variant="secondary" className="ms-auto">
            {data.length.toLocaleString(fa ? "fa-IR" : "en-US")}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse"><CardContent className="h-28" /></Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {fa ? "دریافت فهرست ممکن نشد. دسترسی سوپرادمین لازمه." : "Couldn't load the list. Super-admin access is required."}
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Inbox className="mx-auto mb-3 size-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{fa ? "چیزی برای بررسی نیست" : "Nothing to review"}</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {fa ? "همه‌ی پرداخت‌ها بررسی شدن. فیشِ جدید که بیاد اینجا ظاهر می‌شه." : "All payments are reviewed. New receipts will show up here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((item, i) => {
            const botId = item.payment.botId ?? item.bot?.id ?? null;
            return (
              <motion.div
                key={item.payment.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
              >
                <Card>
                  <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <BotIcon className="size-4 text-primary" />
                          {item.bot ? item.bot.name : (fa ? "بدون بات" : "No bot")}
                          {item.bot && <span className="text-xs text-muted-foreground">@{item.bot.username}</span>}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <UserIcon className="size-3.5" />
                          {item.user ? `${item.user.name} · ${item.user.email}` : "—"}
                        </span>
                      </div>
                      {item.payment.description && (
                        <p className="text-sm text-muted-foreground">{item.payment.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{new Date(item.payment.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</span>
                        {item.payment.receiptUrl && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                              >
                                <ExternalLink className="size-3.5" />
                                {fa ? "مشاهده فیش" : "View receipt"}
                              </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-3xl">
                              <img
                                src={item.payment.receiptUrl}
                                alt="receipt"
                                className="max-h-[80vh] w-full rounded-md object-contain"
                              />
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => botId && act(botId, "approve")}
                        disabled={!botId || busy === botId + "approve"}
                        data-testid={`approve-${item.payment.id}`}
                      >
                        {busy === botId + "approve" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        <span className="ms-1.5">{fa ? "تأیید" : "Approve"}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => botId && act(botId, "reject")}
                        disabled={!botId || busy === botId + "reject"}
                        data-testid={`reject-${item.payment.id}`}
                        className="text-destructive hover:text-destructive"
                      >
                        {busy === botId + "reject" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                        <span className="ms-1.5">{fa ? "رد" : "Reject"}</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
