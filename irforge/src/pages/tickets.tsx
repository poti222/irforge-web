import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { LifeBuoy, Plus, Send, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

type TicketListItem = {
  id: string; subject: string; status: string; createdAt: string; updatedAt: string;
  owner?: { name: string; email: string } | null;
  source?: string; telegramId?: string | null; tenant?: string | null; issueType?: string | null;
};
type TicketMessage = { id: string; senderId: string; senderRole: string; body: string; createdAt: string };
type TicketDetail = TicketListItem & { messages: TicketMessage[] };

const STATUS: Record<string, { variant: "default" | "secondary" | "outline"; fa: string; en: string }> = {
  open: { variant: "outline", fa: "باز", en: "open" },
  answered: { variant: "default", fa: "پاسخ داده‌شده", en: "answered" },
  closed: { variant: "secondary", fa: "بسته", en: "closed" },
};

export default function Tickets() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => customFetch<TicketListItem[]>("/api/tickets"),
  });

  const { data: detail } = useQuery({
    queryKey: ["ticket", selected],
    queryFn: () => customFetch<TicketDetail>(`/api/tickets/${selected}`),
    enabled: !!selected,
    refetchInterval: selected ? 8000 : false, // v1: poll the open thread
  });

  async function createTicket() {
    if (!subject.trim() || !firstMessage.trim()) {
      toast({ variant: "destructive", title: fa ? "موضوع و متن الزامی است" : "Subject and message are required" });
      return;
    }
    setBusy(true);
    try {
      const t = await customFetch<TicketListItem>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({ subject: subject.trim(), body: firstMessage.trim() }),
      });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      setCreateOpen(false); setSubject(""); setFirstMessage("");
      setSelected(t.id);
      toast({ title: fa ? "تیکت ثبت شد" : "Ticket created" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally { setBusy(false); }
  }

  async function sendReply() {
    if (!reply.trim() || !selected) return;
    setBusy(true);
    try {
      await customFetch(`/api/tickets/${selected}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["ticket", selected] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally { setBusy(false); }
  }

  async function closeTicket() {
    if (!selected) return;
    try {
      await customFetch(`/api/tickets/${selected}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
      queryClient.invalidateQueries({ queryKey: ["ticket", selected] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      toast({ title: fa ? "تیکت بسته شد" : "Ticket closed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{fa ? "تیکت‌ها" : "Tickets"}</h1>
          <p className="text-muted-foreground">{fa ? "پشتیبانی و پیگیری درخواست‌ها." : "Support and request tracking."}</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}><Plus className="me-2 h-4 w-4" /> {fa ? "تیکت جدید" : "New ticket"}</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* List */}
        <div className="space-y-2 lg:col-span-1">
          {isLoading ? (
            [1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />)
          ) : tickets && tickets.length > 0 ? (
            tickets.map((t) => {
              const s = STATUS[t.status] ?? STATUS.open;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={`w-full rounded-md border p-3 text-start transition-colors hover:bg-muted/50 ${selected === t.id ? "border-primary bg-muted/40" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {t.source === "bot" && (
                        <Badge variant="outline" className="shrink-0 gap-1 border-primary/40 text-primary">
                          <Send className="size-3" />{fa ? "تلگرام" : "Telegram"}
                        </Badge>
                      )}
                      <span className="font-medium truncate">{t.subject}</span>
                    </span>
                    <Badge variant={s.variant}>{fa ? s.fa : s.en}</Badge>
                  </div>
                  {t.source === "bot" && (t.telegramId || t.tenant) && (
                    <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                      {t.telegramId ? `tg:${t.telegramId}` : ""}{t.tenant ? `  ·  ${t.tenant}` : ""}
                    </p>
                  )}
                  {t.owner && <p className="mt-1 text-xs text-muted-foreground">{t.owner.name} · {t.owner.email}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(t.updatedAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                  </p>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
              <LifeBuoy className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{fa ? "تیکتی ندارید." : "No tickets."}</p>
            </div>
          )}
        </div>

        {/* Thread */}
        <div className="lg:col-span-2">
          {detail ? (
            <Card className="flex h-[70vh] flex-col">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSelected(null)}>
                    <ArrowLeft className="h-4 w-4 rtl-flip" />
                  </Button>
                  <CardTitle className="text-base">{detail.subject}</CardTitle>
                  <Badge variant={(STATUS[detail.status] ?? STATUS.open).variant}>
                    {fa ? (STATUS[detail.status] ?? STATUS.open).fa : (STATUS[detail.status] ?? STATUS.open).en}
                  </Badge>
                </div>
                {detail.status !== "closed" && (
                  <Button variant="outline" size="sm" onClick={closeTicket}>
                    <CheckCircle2 className="me-1 h-3.5 w-3.5" /> {fa ? "بستن" : "Close"}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex-1 space-y-3 overflow-auto py-4">
                {detail.messages.map((m) => {
                  const staff = m.senderRole === "admin";
                  return (
                    <div key={m.id} className={`flex ${staff ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${staff ? "bg-muted" : "bg-primary text-primary-foreground"}`}>
                        <p className="mb-0.5 text-[10px] opacity-70">
                          {staff ? (fa ? "پشتیبانی" : "Support") : (fa ? "شما" : "You")} ·{" "}
                          {new Date(m.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}
                        </p>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
              {detail.status !== "closed" && (
                <div className="flex items-center gap-2 border-t p-3">
                  <Input
                    placeholder={fa ? "پاسخ خود را بنویسید..." : "Type your reply..."}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  />
                  <Button onClick={sendReply} disabled={busy || !reply.trim()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <div className="flex h-[70vh] items-center justify-center rounded-md border border-dashed text-center">
              <p className="text-sm text-muted-foreground">{fa ? "یک تیکت را انتخاب کنید." : "Select a ticket to view the conversation."}</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{fa ? "تیکت جدید" : "New ticket"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="tk-subject">{fa ? "موضوع" : "Subject"}</Label>
              <Input id="tk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tk-body">{fa ? "پیام" : "Message"}</Label>
              <Textarea id="tk-body" rows={4} value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>{fa ? "انصراف" : "Cancel"}</Button>
            <Button onClick={createTicket} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ثبت تیکت" : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
