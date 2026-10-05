import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, RotateCcw } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
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

  // ترتیبِ مطالعه: آیتم‌هایِ بدونِ‌پیشرفت یا سررسیده زودتر (ببینید توضیحِ بالایِ فایل).
  const studyQueue = useMemo(() => {
    const progressByItem = new Map((progress ?? []).map((p) => [p.contentItemId, p]));
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
  const [rating, setRating] = useState(false);
  const confettiRef = useRef<HTMLDivElement>(null);

  const current = studyQueue[currentIdx];
  const done = studyQueue.length > 0 && currentIdx >= studyQueue.length;

  useEffect(() => {
    if (done) spawnConfetti(confettiRef.current);
  }, [done]);

  async function handleRate(r: SchoolContentRating) {
    if (!current || !schoolId || rating) return;
    setRating(true);
    try {
      await rateContentProgress(schoolId, current.id, r);
      setStats((s) => (r === "know" ? { ...s, know: s.know + 1 } : { ...s, practice: s.practice + 1 }));
      await queryClient.invalidateQueries({ queryKey: ["schools", "content-progress", schoolId, lessonId] });
      setFlipped(false);
      setCurrentIdx((i) => i + 1);
    } finally {
      setRating(false);
    }
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
        <div className="relative flex flex-col items-center gap-4 rounded-md border border-dashed p-8 text-center">
          <div ref={confettiRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
          <h2 className="text-lg font-bold">{t.studyDoneTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {t.studyDoneSummary.replace("{know}", String(stats.know)).replace("{practice}", String(stats.practice))}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRestart}>
              <RotateCcw className="me-1 size-4" /> {t.studyRestartButton}
            </Button>
            <Link href={backHref}>
              <Button>{t.backToLesson}</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p className="text-xs text-muted-foreground">
            {t.studyProgressLabel.replace("{current}", String(currentIdx + 1)).replace("{total}", String(studyQueue.length))}
          </p>
          <Card
            className="flex h-56 w-full max-w-md cursor-pointer select-none items-center justify-center p-6 text-center transition"
            onClick={() => setFlipped((f) => !f)}
          >
            <CardContent className="flex flex-col items-center gap-2 p-0">
              <p className="text-xs text-muted-foreground">{flipped ? t.studyMeaningLabel : t.studyWordLabel}</p>
              <p className="text-2xl font-bold" dir="auto">{flipped ? current.body : current.title}</p>
              {!flipped && <p className="mt-2 text-xs text-muted-foreground">{t.studyFlipHint}</p>}
            </CardContent>
          </Card>

          {flipped && (
            <div className="flex gap-2">
              <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={rating} onClick={() => handleRate("practice")}>
                {t.studyRatePractice}
              </Button>
              <Button disabled={rating} onClick={() => handleRate("know")}>
                {t.studyRateKnow}
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
