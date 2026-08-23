/**
 * TicketsSection.tsx — تیکت‌های داخل بات (فاز ۲۳).
 *
 * ⚠️ این با تیکت‌های پشتیبانی **سایت** (`/tickets`) یکی نیست: این‌ها تیکت‌هایی
 * است که کاربرِ بات از داخل خودِ بات باز کرده و در شیت تننت ذخیره شده‌اند.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Search, Send, ArrowRight, LifeBuoy, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type Ticket = {
  id: string;
  user_id: string;
  status: string;
  assigned_admin_id?: string;
  subject?: string;
  created_at?: string;
  updated_at?: string;
  messageCount: number;
};

type TicketAttachment = {
  type: "photo" | "document" | "voice" | "video" | "video_note" | "audio";
  file_id: string;
  caption?: string;
};

type TicketMessage = {
  id: string;
  sender_type: string;
  sender_id: string;
  text: string;
  timestamp: string;
  /** IRFORGE_PROMPT_V3 Phase 16 — عکس/فایل/صوتی که کاربر یا ادمین فرستاده. */
  attachments?: TicketAttachment[];
};

/** پیش‌نمایش یک پیوست — عکس مستقیم، بقیه فقط لینک دانلود از همان پروکسیِ رسانه. */
function AttachmentPreview({ botId, attachment }: { botId: string; attachment: TicketAttachment }) {
  const t = useT("botTickets");
  const url = `/api/bots/${botId}/media/${attachment.file_id}`;
  if (attachment.type === "photo") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt={attachment.caption || ""} className="max-h-48 rounded-md border object-contain" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Paperclip className="size-3.5" /> {attachment.type}
    </a>
  );
}

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function TicketThread({ botId, ticketId, onBack }: { botId: string; ticketId: string; onBack: () => void }) {
  const t = useT("botTickets");
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-support-ticket", botId, ticketId] as const;

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      customFetch<{ ticket: Ticket; messages: TicketMessage[] }>(`/api/bots/${botId}/support-tickets/${ticketId}`),
  });

  const [text, setText] = useState("");

  const reply = useMutation({
    mutationFn: () =>
      customFetch<{ delivered: string; deliveryError: string | null }>(
        `/api/bots/${botId}/support-tickets/${ticketId}/reply`,
        { method: "POST", body: JSON.stringify({ text }) }
      ),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["bot-support-tickets", botId] });
      setText("");
      toast(
        result.delivered === "sent"
          ? { title: t.replySent }
          : { variant: "destructive", title: t.replySavedNotDelivered, description: result.deliveryError ?? undefined }
      );
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      customFetch(`/api/bots/${botId}/support-tickets/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["bot-support-tickets", botId] });
      toast({ title: t.statusUpdated });
    },
  });

  if (isLoading || !data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="me-1.5 size-4 rtl-flip" /> {t.backToList}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {data.ticket.subject || t.noSubject}
        </h3>
        <Select value={data.ticket.status} onValueChange={(v) => setStatus.mutate(v)}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["open", "assigned", "closed", "reopened", "escalated"].map((s) => (
              <SelectItem key={s} value={s}>{(t[`status_${s}` as keyof typeof t] as string) ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground" dir="ltr">
        {data.ticket.id} · {data.ticket.user_id}
      </p>

      <div className="space-y-2">
        {data.messages.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.noMessages}</p>
        ) : (
          data.messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-lg border p-3 text-sm ${
                message.sender_type === "admin" ? "ms-auto bg-primary/5" : "bg-card"
              }`}
            >
              <p className="mb-1 text-xs text-muted-foreground">
                {message.sender_type === "admin" ? t.senderAdmin : t.senderUser}
                {" · "}
                <span dir="ltr">{String(message.timestamp ?? "").slice(0, 16).replace("T", " ")}</span>
              </p>
              {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
              {(message.attachments ?? []).length > 0 && (
                <div className={`flex flex-wrap gap-2 ${message.text ? "mt-2" : ""}`}>
                  {message.attachments!.map((a, i) => (
                    <AttachmentPreview key={i} botId={botId} attachment={a} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="space-y-1.5 border-t pt-4">
        <Label htmlFor="ticket-reply">{t.replyLabel}</Label>
        <Textarea id="ticket-reply" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <Button disabled={!text.trim() || reply.isPending} onClick={() => reply.mutate()}>
          {reply.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
          {t.sendReply}
        </Button>
      </div>
    </div>
  );
}

export function TicketsSection({ bot }: { bot: Bot }) {
  const t = useT("botTickets");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ticketsKey = ["bot-support-tickets", bot.id, status, search] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: ticketsKey,
    queryFn: () =>
      customFetch<{ tickets: Ticket[]; counts: Record<string, number>; statuses: string[] }>(
        `/api/bots/${bot.id}/support-tickets?status=${status}&search=${encodeURIComponent(search)}`
      ),
  });

  // IRFORGE_PROMPT_V3 Phase 16 — «در را باز کن، سکشن را پنهان نکن»: به‌جای
  // یک پیام خطای قرمز، همان CTA فعال‌سازی که PluginsManager.tsx استفاده
  // می‌کند، همین‌جا هم — کاربر مجبور نیست برای پیدا کردنش سکشن دیگری برود.
  const activate = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${bot.id}/plugins/ticket`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: ticketsKey });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <LifeBuoy className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activate.isPending ? t.activating : t.activatePlugin}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  if (selectedId) {
    return <TicketThread botId={bot.id} ticketId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-8" placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-auto min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t.filterActive} ({data.counts.active ?? 0})</SelectItem>
            <SelectItem value="all">{t.filterAll} ({data.counts.all ?? 0})</SelectItem>
            {data.statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {(t[`status_${s}` as keyof typeof t] as string) ?? s} ({data.counts[s] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data.tickets.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {data.counts.all === 0 ? t.noTickets : t.noMatches}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => setSelectedId(ticket.id)}
                className="flex w-full flex-wrap items-center gap-2 rounded-md border p-3 text-start text-sm hover:bg-muted/40"
              >
                <LifeBuoy className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{ticket.subject || t.noSubject}</span>
                <Badge variant={ticket.status === "closed" ? "secondary" : "default"}>
                  {(t[`status_${ticket.status}` as keyof typeof t] as string) ?? ticket.status}
                </Badge>
                <Badge variant="outline">{t.messageCount.replace("{n}", String(ticket.messageCount))}</Badge>
                <span dir="ltr" className="text-xs text-muted-foreground">
                  {String(ticket.updated_at ?? "").slice(0, 10)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
