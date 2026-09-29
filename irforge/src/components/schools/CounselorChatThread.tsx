import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/hooks/use-translation";
import { listCounselorMessages, sendCounselorMessage, markThreadRead, counselorThreadKey } from "@/lib/schools-api";

/**
 * components/schools/CounselorChatThread.tsx — بخش "/schools" فاز ۴ (بندِ ۱):
 * بدنه‌ی رشته‌ی چتِ مشاور↔دانش‌آموز، بینِ counselor/chat.tsx (سمتِ مشاور) و
 * student/counselor.tsx (سمتِ دانش‌آموز) به اشتراک گذاشته شده — تا منطقِ
 * پُلینگ/ارسال دوبار نوشته نشود، فقط جهتِ حباب‌ها بر اساسِ senderUserId فرق
 * می‌کند. رفرشِ ۵ثانیه‌ای دقیقاً همان الگویِ pages/tickets.tsx (refetchInterval).
 */
export function CounselorChatThread({ schoolId, counselorUserId, studentMemberId }: {
  schoolId: string;
  counselorUserId: string;
  studentMemberId: string;
}) {
  const t = useT("schools") as any;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const queryKey = ["schools", "counselor-messages", schoolId, counselorUserId, studentMemberId];
  const { data: messages, isLoading } = useQuery({
    queryKey,
    queryFn: () => listCounselorMessages(schoolId, counselorUserId, studentMemberId),
    refetchInterval: 5000,
  });

  // فازِ ۹ (بندِ ۱): بازکردنِ رشته یعنی «خواندمش».
  useEffect(() => {
    markThreadRead(schoolId, counselorThreadKey(schoolId, counselorUserId, studentMemberId))
      .then(() => queryClient.invalidateQueries({ queryKey: ["schools", "counselor-students"] }))
      .catch(() => {});
  }, [schoolId, counselorUserId, studentMemberId]);

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await sendCounselorMessage(schoolId, { counselorUserId, studentMemberId, body: body.trim() });
      setBody("");
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setSending(false);
    }
  }

  if (isLoading) return <Loader2 className="size-5 animate-spin" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border p-3">
        {!messages || messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.chatEmpty}</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderUserId === user?.id;
            return (
              <div key={m.id} className={`flex flex-col gap-0.5 ${mine ? "items-start" : "items-end"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.body}
                </div>
                <span className="text-[10px] text-muted-foreground" dir="ltr">{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>
            );
          })
        )}
      </div>
      <div className="flex gap-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={t.chatMessagePlaceholder} />
        <Button onClick={handleSend} disabled={sending || !body.trim()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
