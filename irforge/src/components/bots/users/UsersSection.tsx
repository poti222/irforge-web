/**
 * UsersSection.tsx — کاربران بات (فاز ۱۴).
 *
 * لیست کاملاً سمت سرور صفحه‌بندی می‌شود؛ کلاینت هرگز کل تب `users` را نمی‌گیرد.
 * جزئیات هر کاربر در یک کشو باز می‌شود و فقط چهار فیلد قابل ویرایش‌اند —
 * بقیه (`profile_data`, `form_data`, `flood_timestamps`, `joined_at`) حالت
 * runtime بات‌اند و فقط‌خواندنی نمایش داده می‌شوند.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Search, Ban, ShieldCheck, ChevronRight, ChevronLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type UserSummary = {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  language: string;
  is_admin: boolean;
  is_banned: boolean;
  ban_reason: string;
  joined_at: string;
  last_seen: string;
  orderCount: number;
};

type UserDetail = UserSummary & {
  profile_data: Record<string, unknown>;
  form_data: Record<string, unknown>;
  orders: Array<Record<string, unknown>>;
  current_panel: string | null;
  current_form: string | null;
  flood_timestamps: string[];
  notes: string;
};

type UsersPage = {
  users: UserSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totalAll: number;
  bannedCount: number;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function UserDetailDialog({
  botId,
  userId,
  onClose,
}: {
  botId: string;
  userId: string | null;
  onClose: () => void;
}) {
  const t = useT("botUsers");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["bot-user", botId, userId],
    queryFn: () => customFetch<{ user: UserDetail }>(`/api/bots/${botId}/bot-users/${userId}`),
    enabled: Boolean(userId),
  });

  const [banned, setBanned] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const user = data?.user;
  const effBanned = banned ?? user?.is_banned ?? false;
  const effReason = reason ?? user?.ban_reason ?? "";
  const effNotes = notes ?? user?.notes ?? "";
  const dirty =
    user !== undefined &&
    (effBanned !== user.is_banned || effReason !== (user.ban_reason ?? "") || effNotes !== (user.notes ?? ""));

  const save = useMutation({
    mutationFn: (patch: Partial<UserDetail>) =>
      customFetch(`/api/bots/${botId}/bot-users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-users", botId] });
      qc.invalidateQueries({ queryKey: ["bot-user", botId, userId] });
      toast({ title: t.userSaved });
      setBanned(null); setReason(null); setNotes(null);
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog
      open={userId !== null}
      onOpenChange={(open) => {
        if (!open) { setBanned(null); setReason(null); setNotes(null); onClose(); }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.detailTitle}</DialogTitle>
          <DialogDescription dir="ltr">{userId}</DialogDescription>
        </DialogHeader>

        {isLoading || !user ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">{t.colName}</dt>
              <dd>{[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}</dd>
              <dt className="text-muted-foreground">{t.colUsername}</dt>
              <dd dir="ltr">{user.username ? `@${user.username}` : "—"}</dd>
              <dt className="text-muted-foreground">{t.colJoined}</dt>
              <dd dir="ltr">{user.joined_at?.slice(0, 16).replace("T", " ") || "—"}</dd>
              <dt className="text-muted-foreground">{t.colLastSeen}</dt>
              <dd dir="ltr">{user.last_seen?.slice(0, 16).replace("T", " ") || "—"}</dd>
              <dt className="text-muted-foreground">{t.currentPanel}</dt>
              <dd dir="ltr" className="truncate">{user.current_panel || "—"}</dd>
              <dt className="text-muted-foreground">{t.colOrders}</dt>
              <dd>{user.orders?.length ?? 0}</dd>
            </dl>

            {user.profile_data && Object.keys(user.profile_data).length > 0 && (
              <div className="space-y-1.5">
                <Label>{t.profileData}</Label>
                {/* فقط‌خواندنی: این را بات پر می‌کند و ویرایشش از سایت یعنی
                    خراب‌کردن چیزی که همان لحظه در حال استفاده است. */}
                <pre dir="ltr" className="max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-xs">
                  {JSON.stringify(user.profile_data, null, 2)}
                </pre>
              </div>
            )}

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="user-ban">{t.banned}</Label>
                  <p className="text-xs text-muted-foreground">{t.bannedHint}</p>
                </div>
                <Switch id="user-ban" checked={effBanned} onCheckedChange={setBanned} />
              </div>
              {effBanned && (
                <div className="space-y-1.5">
                  <Label htmlFor="user-reason">{t.banReason}</Label>
                  <Input id="user-reason" value={effReason} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-notes">{t.adminNotes}</Label>
              <Textarea id="user-notes" rows={3} value={effNotes} onChange={(e) => setNotes(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t.adminNotesHint}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ is_banned: effBanned, ban_reason: effReason, notes: effNotes })}
          >
            {save.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersSection({ bot }: { bot: Bot }) {
  const t = useT("botUsers");
  const { lang } = useLanguage();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["bot-users", bot.id, search, status, page],
    queryFn: () =>
      customFetch<UsersPage>(
        `/api/bots/${bot.id}/bot-users?search=${encodeURIComponent(search)}&status=${status}&page=${page}&limit=50`
      ),
    // بدون این، هر تایپ در جستجو کل جدول را به اسکلت لودینگ تبدیل می‌کند.
    placeholderData: keepPreviousData,
  });

  const nf = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  if (isLoading && !data) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-8"
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filterAll}</SelectItem>
            <SelectItem value="active">{t.filterActive}</SelectItem>
            <SelectItem value="banned">{t.filterBanned}</SelectItem>
            <SelectItem value="admin">{t.filterAdmin}</SelectItem>
          </SelectContent>
        </Select>
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span>{t.statTotal.replace("{n}", nf(data.totalAll))}</span>
        <span>{t.statBanned.replace("{n}", nf(data.bannedCount))}</span>
        <span>{t.statMatching.replace("{n}", nf(data.total))}</span>
      </div>

      {data.users.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {data.totalAll === 0 ? t.noUsers : t.noMatches}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-start font-medium">{t.colName}</th>
                <th className="p-2 text-start font-medium">{t.colUsername}</th>
                <th className="p-2 text-start font-medium">{t.colJoined}</th>
                <th className="p-2 text-start font-medium">{t.colLastSeen}</th>
                <th className="p-2 text-start font-medium">{t.colLanguage}</th>
                <th className="p-2 text-start font-medium">{t.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.user_id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSelected(user.user_id)}>
                  <td className="p-2">
                    <div className="min-w-0">
                      <div className="truncate">{[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}</div>
                      <div dir="ltr" className="truncate font-mono text-xs text-muted-foreground">{user.user_id}</div>
                    </div>
                  </td>
                  <td className="p-2" dir="ltr">{user.username ? `@${user.username}` : "—"}</td>
                  <td className="p-2" dir="ltr">{user.joined_at?.slice(0, 10) || "—"}</td>
                  <td className="p-2" dir="ltr">{user.last_seen?.slice(0, 10) || "—"}</td>
                  <td className="p-2">{user.language || "—"}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      {user.is_banned ? (
                        <Badge variant="destructive"><Ban className="me-1 size-3" />{t.banned}</Badge>
                      ) : (
                        <Badge variant="secondary">{t.statusNormal}</Badge>
                      )}
                      {user.is_admin && <ShieldCheck className="size-3.5 text-emerald-500" aria-label={t.filterAdmin} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="icon" aria-label={t.prevPage} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronRight className="size-4 rtl-flip" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {t.pageOf.replace("{page}", nf(data.page)).replace("{total}", nf(data.totalPages))}
          </span>
          <Button
            variant="outline" size="icon" aria-label={t.nextPage}
            disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}
          >
            <ChevronLeft className="size-4 rtl-flip" />
          </Button>
        </div>
      )}

      <UserDetailDialog botId={bot.id} userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
