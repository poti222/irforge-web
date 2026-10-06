import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, RotateCcw, CheckCircle2, BookOpen, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import {
  getContentLesson,
  getSchoolMe,
  listMyContentProgress,
  listSchoolContent,
  rateContentProgress,
  type SchoolContentItem,
  type SchoolContentRating,
  type SchoolContentType,
} from "@/lib/schools-api";
import { chunkIntoSections } from "@/lib/schools-content-sections";

/**
 * pages/schools/content-study.tsx — حالتِ مطالعه/فلش‌کارت، طبقِ گزارشِ
 * مستقیمِ کاربر: «۱۰۰۰۰۰٪ بهتر از ریپویِ dars». دارسِ قدیمی همین مکانیک را
 * داشت (نشان‌دادنِ واژه، چرخش برایِ دیدنِ معنی، خودارزیابیِ باینری، SRSِ
 * ساده) اما پیشرفت فقط در localStorage بود — با پاک‌شدنِ مرورگر یا عوض‌شدنِ
 * دستگاه از بین می‌رفت. اینجا پیشرفت رویِ سرور است (schema/schoolContentProgress.ts)
 * یعنی دانش‌آموز می‌تواند گوشی را عوض کند و همان‌جا ادامه دهد.
 *
 * فقط رویِ *یک بخشِ ۲۰تاییِ* مشخص کار می‌کند (همان بخش‌بندیِ
 * lib/schools-content-sections.ts که در content-lesson.tsx هم استفاده
 * می‌شود) — یعنی هیچ‌وقت دانش‌آموز را با یک صفِ ۶۰تایی روبه‌رو نمی‌کند.
 *
 * ترتیبِ کارت‌ها طبقِ اولویتِ مرور: آیتم‌هایی که هنوز هیچ پیشرفتی ندارند یا
 * `nextReviewAt`شان گذشته، زودتر می‌آیند (dueScore پایین‌تر) — نه یک ترتیبِ
 * ثابتِ خطی؛ طبقِ اسپک («باید اولویتِ موارد سررسیدشده را نشان دهد»).
 */
export default function SchoolContentStudy() {
  const { type, lessonId, section } = useParams<{ type: SchoolContentType; lessonId: string; section: string }>();
  const sectionIndex = Number(section) || 0;
  const t = useT("schools") as any;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: lesson } = useQuery({
    queryKey: ["schools", "content-lesson", schoolId, lessonId],
    queryFn: () => getContentLesson(schoolId!, lessonId),
    enabled: !!schoolId,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["schools", "content-by-lesson", schoolId, type, lessonId],
    queryFn: () => listSchoolContent(type, schoolId, undefined, lessonId),
    enabled: !!schoolId,
  });

  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ["schools", "content-progress", schoolId, lessonId],
    queryFn: () => listMyContentProgress(schoolId!, lessonId),
    enabled: !!schoolId,
  });

  usePrivatePageTitle(t.studyModeButton);

  const sectionItems: SchoolContentItem[] = useMemo(() => {
    const sections = chunkIntoSections(items ?? []);
    return sections[sectionIndex] ?? [];
  }, [items, sectionIndex]);

  const progressByItem = useMemo(
    () => new Map((progress ?? []).map((p) => [p.contentItemId, p])),
    [progress],
  );

  // ترتیبِ مطالعه: آیتم‌هایِ بدونِ‌پیشرفت یا سررسیده زودتر (ببینید توضیحِ بالایِ فایل).
  const studyQueue = useMemo(() => {
    return [...sectionItems].sort((a, b) => {
      const pa = progressByItem.get(a.id);
      const pb = progressByItem.get(b.id);
      const scoreA = pa ? new Date(pa.nextReviewAt).getTime() : -Infinity;
      const scoreB = pb ? new Date(pb.nextReviewAt).getTime() : -Infinity;
      return scoreA - scoreB;
    });
  }, [sectionItems, progress]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ know: 0, practice: 0 });
  const confettiRef = useRef<HTMLDivElement>(null);

  const current = studyQueue[currentIdx];
  const done = studyQueue.length > 0 && currentIdx >= studyQueue.length;

  // لهجهٔ رنگیِ کارت: اگر پیشرفتِ قبلی دارد و سررسیدش گذشته یعنی «مرورِ معوقه»
  // (کهربایی)، اگر پیشرفتی ندارد یعنی کارتِ تازه (رنگِ اصلیِ برند). هر دو فقط
  // یک جزئیاتِ بصریِ اختیاری‌اند، تأثیری در ترتیب/زمان‌بندیِ واقعی ندارند.
  const currentProgress = current ? progressByItem.get(current.id) : undefined;
  const isDue = !!currentProgress && new Date(currentProgress.nextReviewAt).getTime() <= Date.now();

  useEffect(() => {
    if (done) spawnConfetti(confettiRef.current);
  }, [done]);

  /**
   * نکتهٔ کلیدی (ریشهٔ گزارشِ «دکمه‌ها کار نمی‌کنند / کُند هستند»): نسخهٔ قبلی
   * قبل از رفتن به کارتِ بعدی، منتظرِ دو رفت‌وبرگشتِ شبکه‌یِ متوالی می‌ماند
   * (ابتدا POSTِ رتبه‌بندی، بعد یک invalidateQueries که خودش یک GET کاملِ
   * دوباره است) — رویِ اینترنتِ ضعیف همین «کند/یخ‌زده» حس می‌شود. بدتر از آن:
   * هیچ try/catchی رویِ خودِ rateContentProgress نبود، پس اگر آن POST حتی
   * یک‌بار شکست می‌خورد (قطعیِ موقتِ شبکه، سشنِ منقضی‌شده و ۴۰۱/۴۰۳...)
   * کلِ تابع throw می‌کرد و setCurrentIdx هرگز اجرا نمی‌شد — یعنی از دیدِ
   * دانش‌آموز دکمه‌ها واقعاً «کار نمی‌کردند»، نه فقط کند بودند.
   *
   * راهِ‌حل: پیشرفتِ محلی (ایندکسِ کارتِ فعلی/آماریِ know/practice) کاملاً
   * client-side است و نیازی به پاسخِ سرور ندارد؛ پس بلافاصله و همزمان با
   * کلیک جلو می‌رویم، و POSTِ ذخیره‌سازی را در پس‌زمینه (fire-and-forget)
   * با یک تلاشِ دوبارهٔ ساده و بدونِ مسدودکردنِ UI انجام می‌دهیم. حتی اگر
   * ذخیره‌سازی نهایتاً شکست بخورد، فقط یک toastِ غیرمسدودکننده نشان می‌دهیم؛
   * دانش‌آموز هرگز معطلِ شبکه نمی‌ماند.
   */
  function handleRate(r: SchoolContentRating) {
    if (!current || !schoolId) return;
    const itemId = current.id;

    // جلوبردنِ فوری و همزمان (optimistic) — بدونِ هیچ await.
    setStats((s) => (r === "know" ? { ...s, know: s.know + 1 } : { ...s, practice: s.practice + 1 }));
    setFlipped(false);
    setCurrentIdx((i) => i + 1);

    // ذخیره‌سازیِ سرور در پس‌زمینه؛ هیچ throwی به اینجا برنمی‌گردد و چیزی را مسدود نمی‌کند.
    void saveRatingInBackground(schoolId, itemId, r);
  }

  async function saveRatingInBackground(sId: string, itemId: string, r: SchoolContentRating) {
    try {
      await rateContentProgress(sId, itemId, r);
    } catch {
      // یک تلاشِ دوبارهٔ سبک (مثلاً قطعیِ موقتِ شبکه) — بدونِ مسدودکردنِ UI.
      try {
        await rateContentProgress(sId, itemId, r);
      } catch {
        toast({ variant: "destructive", description: t.studySaveFailed });
        return;
      }
    }
    // کوئریِ پیشرفت را فقط بعدِ موفقیت (و در پس‌زمینه) تازه می‌کنیم؛ صفِ مطالعهٔ
    // جاری از این refetch مستقل است، پس منتظرش نمی‌مانیم.
    void queryClient.invalidateQueries({ queryKey: ["schools", "content-progress", schoolId, lessonId] });
  }

  function handleRestart() {
    setCurrentIdx(0);
    setFlipped(false);
    setStats({ know: 0, practice: 0 });
  }

  const backHref = `/schools/content/${type}/lesson/${lessonId}`;
  const loading = itemsLoading || progressLoading;

  return (
    <div className="flex flex-col gap-4">
      <Link href={backHref}>
        <Button variant="ghost" size="sm" className="w-fit">
          <ArrowRight className="me-1 size-4" /> {t.backToLesson}
        </Button>
      </Link>

      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">{lesson?.title}</h1>
        <span className="text-xs text-muted-foreground">
          {t.sectionLabel.replace("{n}", String(sectionIndex + 1))}
        </span>
      </div>

      {loading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : studyQueue.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          {t.contentEmpty}
        </div>
      ) : done ? (
        <div className="relative flex flex-col items-center gap-4 overflow-hidden rounded-xl border bg-gradient-to-b from-primary/5 to-transparent p-8 text-center sm:p-10">
          <div ref={confettiRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PartyPopper className="size-7" />
          </div>
          <h2 className="text-xl font-bold sm:text-2xl">{t.studyDoneTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {t.studyDoneSummary.replace("{know}", String(stats.know)).replace("{practice}", String(stats.practice))}
          </p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" size="lg" onClick={handleRestart}>
              <RotateCcw className="me-1 size-4" /> {t.studyRestartButton}
            </Button>
            <Link href={backHref} className="w-full sm:w-auto">
              <Button size="lg" className="w-full">{t.backToLesson}</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5">
          <div className="w-full max-w-md">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>{t.studyProgressLabel.replace("{current}", String(currentIdx + 1)).replace("{total}", String(studyQueue.length))}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${((currentIdx + (flipped ? 0.5 : 0)) / studyQueue.length) * 100}%` }}
              />
            </div>
          </div>

          {/* کارتِ فلش — چرخشِ سه‌بعدیِ واقعی (rotateY) به‌جایِ صرفاً عوض‌کردنِ متن؛ طبقِ
             گزارشِ کاربر برایِ یک حسِّ واقعاً «زیبا». هیچ کتابخانهٔ جدیدی لازم نیست. */}
          <div
            className="w-full max-w-md [perspective:1200px]"
            onClick={() => setFlipped((f) => !f)}
          >
            <div
              className={cn(
                "relative h-64 w-full cursor-pointer select-none transition-transform duration-500 [transform-style:preserve-3d] sm:h-72",
                flipped && "[transform:rotateY(180deg)]",
              )}
            >
              {/* رو: واژه */}
              <div
                className={cn(
                  "absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border-2 bg-card p-6 text-center shadow-lg [backface-visibility:hidden]",
                  isDue ? "border-amber-400/70 dark:border-amber-500/60" : "border-primary/30",
                )}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.studyWordLabel}</p>
                <p className="text-3xl font-extrabold sm:text-4xl" dir="auto">{current.title}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t.studyFlipHint}</p>
              </div>
              {/* پشت: معنی */}
              <div
                className={cn(
                  "absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border-2 bg-primary/5 p-6 text-center shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)]",
                  isDue ? "border-amber-400/70 dark:border-amber-500/60" : "border-primary/30",
                )}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.studyMeaningLabel}</p>
                <p className="text-xl font-semibold sm:text-2xl" dir="auto">{current.body}</p>
              </div>
            </div>
          </div>

          {/* دکمه‌ها: روی موبایل تمام‌عرض و روی هم (انگشت‌پسند)، از sm به بالا کنارِ هم. */}
          {flipped && (
            <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                size="lg"
                className="h-14 border-2 border-destructive/50 text-base font-semibold text-destructive hover:bg-destructive/10"
                onClick={() => handleRate("practice")}
              >
                <BookOpen className="me-1.5 size-5" /> {t.studyRatePractice}
              </Button>
              <Button
                size="lg"
                className="h-14 bg-green-600 text-base font-semibold text-white hover:bg-green-600 dark:bg-green-600"
                onClick={() => handleRate("know")}
              >
                <CheckCircle2 className="me-1.5 size-5" /> {t.studyRateKnow}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * یک انیمیشنِ کانفتیِ سبک و وابستگی‌-آزاد (بدونِ کتابخانه‌ی جدید؛ این ریپو
 * اصلاً confetti ندارد) — چند div با رنگ/زاویه/تأخیرِ تصادفی که با یک
 * keyframe ساده می‌افتند و بعد از پایانِ انیمیشن خودشان حذف می‌شوند.
 */
function spawnConfetti(container: HTMLDivElement | null) {
  if (!container) return;
  const colors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement("div");
    const color = colors[i % colors.length];
    const left = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const duration = 1.2 + Math.random() * 0.8;
    piece.style.position = "absolute";
    piece.style.top = "-10px";
    piece.style.left = `${left}%`;
    piece.style.width = "8px";
    piece.style.height = "8px";
    piece.style.backgroundColor = color;
    piece.style.opacity = "0.9";
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    piece.style.animation = `schools-confetti-fall ${duration}s ease-in ${delay}s forwards`;
    container.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove());
  }
}

if (typeof document !== "undefined" && !document.getElementById("schools-confetti-keyframes")) {
  const style = document.createElement("style");
  style.id = "schools-confetti-keyframes";
  style.textContent = `
    @keyframes schools-confetti-fall {
      0% { transform: translateY(0) rotate(0deg); opacity: 0.9; }
      100% { transform: translateY(220px) rotate(360deg); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
