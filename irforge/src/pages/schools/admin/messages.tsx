import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Inbox } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useViewedSchoolId } from "@/hooks/use-viewed-school";
import { getSchoolMe, listAdminMessageThreads } from "@/lib/schools-api";
import { AdminChatThread } from "@/components/schools/AdminChatThread";

/**
 * pages/schools/admin/messages.tsx — «پیام‌ها» (فاز ۵، بندِ ۱): صندوقِ ورودیِ
 * مدیر برایِ رشته‌هایِ «ارتباط با مدیر». هر ردیف یک دانش‌آموز است (رشته‌ی
 * مشترک، نه پیام‌به‌پیام) — کلیک روی ردیف همان رشته را با AdminChatThread
 * باز می‌کند (مدیر هم می‌تواند جواب بدهد، چون آن کامپوننت senderUserId را
 * خودِ کاربرِ لاگین‌شده می‌فرستد).
 */
export default function AdminMessagesPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navMessages);

  const { data: me, isLoading } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useViewedSchoolId(me?.schoolId);

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ["schools", "admin-message-threads", schoolId],
    queryFn: () => listAdminMessageThreads(schoolId!),
    enabled: !!schoolId,
    refetchInterval: 10000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navMessages}</h1>
        <p className="text-sm text-muted-foreground">{t.adminMessagesDescription}</p>
      </div>

      {threadsLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : !threads || threads.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.messagesInboxEmpty}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Inbox className="size-4" /> {t.navMessages}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1">
              {threads.map((th) => (
                <button
                  key={th.studentMemberId}
                  onClick={() => setSelected(th.studentMemberId)}
                  className={`flex flex-col gap-1 rounded-md px-3 py-2 text-start text-sm transition ${selected === th.studentMemberId ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{th.studentUserName ?? th.studentUserEmail ?? th.studentMemberId}</span>
                    <Badge variant="outline">{th.messageCount}</Badge>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{th.lastMessage.body}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t.navChat}</CardTitle></CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t.selectStudentHint}</p>
              ) : (
                <AdminChatThread schoolId={schoolId!} studentMemberId={selected} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
