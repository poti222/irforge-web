import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe } from "@/lib/schools-api";
import { AdminChatThread } from "@/components/schools/AdminChatThread";

/**
 * pages/schools/student/admin-chat.tsx — «ارتباط با مدیر» (فاز ۵، بندِ ۱):
 * قبلاً استابِ `/schools/stub/contact-admin` بود. برخلافِ ارتباط با مشاور،
 * این‌جا نیازی به انتخابِ یک مدیرِ خاص نیست — رشته‌یِ خودکار به‌ازایِ
 * schoolId+خودِ دانش‌آموز، همه‌یِ مدیرهایِ مدرسه می‌بینند.
 */
export default function StudentAdminChatPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navContactAdmin);

  const { data: me, isLoading } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navContactAdmin}</h1>
        <p className="text-sm text-muted-foreground">{t.studentAdminChatDescription}</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> {t.navChat}</CardTitle></CardHeader>
        <CardContent>
          {schoolId && me?.id ? (
            <AdminChatThread schoolId={schoolId} studentMemberId={me.id} />
          ) : (
            <Loader2 className="size-5 animate-spin" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
