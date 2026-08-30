import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, ChevronRight, AlertTriangle, Flag, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getRowHaloClass } from "@/lib/user-halo";

interface QueueUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  telegramUsername?: string | null;
  role: string;
  status: string;
  gender?: "male" | "female" | null;
  botCount: number;
  flagReason?: string | null;
  flaggedAt?: string | null;
}

/** «۳ روز در انتظار» — از flaggedAt، تا فلگ‌های کهنه زیرِ تازه‌ترها گم نشوند. */
function pendingDays(flaggedAt: string | null | undefined, fa: boolean): string | null {
  if (!flaggedAt) return null;
  const days = Math.floor((Date.now() - new Date(flaggedAt).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return fa ? "امروز" : "today";
  return fa ? `${days} روز در انتظار` : `pending ${days}d`;
}

/** فهرست کاربران برای super_admin — جست‌وجو، فیلتر، صفِ بازبینی و صفحه‌بندی. */
export default function AdminUsers() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [queueOnly, setQueueOnly] = useState(false);
  const [clearingFlag, setClearingFlag] = useState<QueueUser | null>(null);
  const [clearReason, setClearReason] = useState("");
  const [deleting, setDeleting] = useState<QueueUser | null>(null);

  const queryKey = ["admin-users", search, role, status, page, queueOnly];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), perPage: "25" });
      if (queueOnly) {
        params.set("flagged", "true");
      } else {
        if (search) params.set("search", search);
        if (role !== "all") params.set("role", role);
        if (status !== "all") params.set("status", status);
      }
      return customFetch<{ items: QueueUser[]; total: number; perPage: number }>(
        `/api/superadmin/users?${params}`,
      );
    },
  });

  const clearFlag = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      customFetch(`/api/superadmin/users/${input.id}/clear-flag`, {
        method: "POST",
        body: JSON.stringify({ reason: input.reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setClearingFlag(null);
      setClearReason("");
      toast({ title: fa ? "فلگ پاک شد" : "Flag cleared" });
    },
    onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message }),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => customFetch(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setDeleting(null);
      toast({ title: fa ? "کاربر حذف شد" : "User deleted" });
    },
    onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا در حذف" : "Delete failed", description: err?.message }),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{fa ? "کاربران" : "Users"}</h1>
        <Button
          variant={queueOnly ? "default" : "outline"}
          size="sm"
          onClick={() => { setQueueOnly((v) => !v); setPage(1); }}
          className="gap-1.5"
        >
          <Flag className="size-4" aria-hidden="true" />
          {fa ? "صفِ بازبینی" : "Review Queue"}
        </Button>
      </div>

      {!queueOnly && (
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="ps-9"
              placeholder={fa ? "نام، ایمیل، شماره یا یوزرنیم" : "Name, email, phone or username"}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label={fa ? "جست‌وجوی کاربران" : "Search users"}
            />
          </div>
          <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{fa ? "همه‌ی نقش‌ها" : "All roles"}</SelectItem>
              <SelectItem value="user">user</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
              <SelectItem value="super_admin">super_admin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{fa ? "همه‌ی وضعیت‌ها" : "All statuses"}</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="suspended">suspended</SelectItem>
              <SelectItem value="banned">banned</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : isError ? (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-500">
            <AlertTriangle className="size-4" />
            {fa ? "خطا در بارگذاری کاربران" : "Failed to load users"}
          </CardContent>
        </Card>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-2">
            {data.items.map((u) => (
              <Card key={u.id} className={cn("transition-colors hover:border-primary/50", getRowHaloClass(u))}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <Link href={`/admin/users/${u.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {[u.email, u.phone, u.telegramUsername && `@${u.telegramUsername}`]
                          .filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {!queueOnly && (
                      <>
                        <Badge variant="outline">{u.role}</Badge>
                        <Badge variant={u.status === "active" ? "secondary" : "destructive"}>{u.status}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {fa ? "ربات" : "bots"}: {u.botCount}
                        </span>
                      </>
                    )}
                    {queueOnly && (
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline">{u.flagReason ?? "manual_report"}</Badge>
                        <span className="text-xs text-muted-foreground">{pendingDays(u.flaggedAt, fa)}</span>
                      </div>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl-flip" aria-hidden="true" />
                  </Link>
                  {queueOnly && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setClearingFlag(u)}
                      >
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        {fa ? "پاک کردن فلگ" : "Clear flag"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-red-500 hover:text-red-500"
                        onClick={() => setDeleting(u)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        {fa ? "حذف" : "Delete"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {fa ? "قبلی" : "Previous"}
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              {fa ? "بعدی" : "Next"}
            </Button>
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          {queueOnly
            ? (fa ? "چیزی برای بازبینی نیست." : "Nothing to review.")
            : (fa ? "کاربری پیدا نشد." : "No users found.")}
        </p>
      )}

      <AlertDialog open={!!clearingFlag} onOpenChange={(o) => { if (!o) { setClearingFlag(null); setClearReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "پاک کردن فلگ؟" : "Clear the flag?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `حساب «${clearingFlag?.name}» از صفِ بازبینی خارج می‌شود.`
                : `“${clearingFlag?.name}” will be removed from the review queue.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={fa ? "دلیل (اختیاری نیست، حداقل ۵ کاراکتر)" : "Reason (required, min 5 characters)"}
            value={clearReason}
            onChange={(e) => setClearReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearFlag.isPending}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (clearingFlag) clearFlag.mutate({ id: clearingFlag.id, reason: clearReason });
              }}
              disabled={clearFlag.isPending || clearReason.trim().length < 5}
            >
              {clearFlag.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "پاک کردن" : "Clear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف کاربر؟" : "Delete user?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `کاربر «${deleting?.name}» (${deleting?.email}) برای همیشه حذف می‌شود.`
                : `“${deleting?.name}” (${deleting?.email}) will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUser.isPending}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleting) deleteUser.mutate(deleting.id); }}
              disabled={deleteUser.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteUser.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
