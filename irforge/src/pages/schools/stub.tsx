import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";

/**
 * pages/schools/stub.tsx — صفحه‌ی عمومیِ «به‌زودی» برایِ آیتم‌های ناوبریِ
 * فازِ ۲ (مدیریتِ اعضا/کلاس‌ها/برنامه‌ها/پیام همگانی/… و همه‌ی صفحاتِ
 * معلم/مشاور/معاون/والد). عمداً CRUD واقعی ندارد — فاز ۱ فقط اسکلتِ ناوبری
 * است.
 */
export default function SchoolsStub() {
  const { key } = useParams<{ key: string }>();
  const t = useT("schools") as any;
  usePrivatePageTitle(t.comingSoon);

  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Card className="max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Construction className="size-10 text-muted-foreground" />
          <p className="font-medium">{t.comingSoon}</p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {key}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
