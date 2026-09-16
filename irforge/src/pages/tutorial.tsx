/**
 * pages/tutorial.tsx — آموزشِ تصویریِ تمام‌صفحه، فقط برایِ «پنل‌ها» و «فرم‌ها».
 *
 * برخلافِ بقیه‌ی سکشن‌ها (که هنوز از `TutorialDrawer` روی همان صفحه استفاده
 * می‌کنند)، این دو تصمیمِ صریح گرفته‌اند که به یک صفحه‌ی مستقلِ قابلِ اسکرول
 * بروند — چون محتوایشان به‌قدری زیاد است که در یک درایورِ کناری جا نمی‌شود.
 * محتوا از `FULL_PAGE_TUTORIALS` (`lib/tutorials/fullPageContent.ts`) می‌آید؛
 * اگر بخشی آنجا نباشد (یعنی `:section` چیزِ دیگری‌ست)، همین‌جا با یک پیامِ
 * ساده «صفحه پیدا نشد» جواب می‌دهیم — نه با throw کردن.
 */
import { useParams } from "wouter";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { isRtlLang } from "@/lib/i18n";
import { FULL_PAGE_TUTORIALS } from "@/lib/tutorials/fullPageContent";

export default function TutorialPage() {
  const { section } = useParams<{ section: string }>();
  const { lang } = useLanguage();
  const t = useT("tutorial");
  const tWorkspace = useT("botWorkspace");
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  const sections = FULL_PAGE_TUTORIALS[section as "panels" | "forms"];

  if (!sections) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4 md:p-6">
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" onClick={() => window.history.back()}>
          <BackArrow className="size-4" /> {t.close}
        </Button>
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t.notFound}
        </p>
      </div>
    );
  }

  const sectionLabelKey =
    `section${section[0].toUpperCase()}${section.slice(1)}` as keyof ReturnType<typeof useT<"botWorkspace">>;
  const sectionLabel = String(tWorkspace[sectionLabelKey] ?? "");
  const pageTitle = t.titleFormat.replace("{section}", sectionLabel);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-4 pb-16 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" onClick={() => window.history.back()}>
          <BackArrow className="size-4" /> {t.close}
        </Button>
      </div>

      <header className="space-y-2 border-b pb-6">
        <h1 className="text-2xl font-bold md:text-3xl">{pageTitle}</h1>
      </header>

      {/* فهرستِ بخش‌ها — روی دسکتاپ می‌چسبد بالای صفحه، روی موبایل معمولی اسکرول می‌شود. */}
      <nav className="flex flex-wrap gap-2 md:sticky md:top-2 md:z-10 md:bg-background/95 md:py-2 md:backdrop-blur">
        {sections.map((sec, i) => (
          <a
            key={i}
            href={`#tutorial-sec-${i}`}
            className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {sec.heading}
          </a>
        ))}
      </nav>

      <div className="space-y-14">
        {sections.map((sec, i) => (
          <section key={i} id={`tutorial-sec-${i}`} className="scroll-mt-20 space-y-6">
            <h2 className="text-xl font-semibold">{sec.heading}</h2>
            <div className="space-y-10">
              {sec.steps.map((step, j) => (
                <article
                  key={j}
                  className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[1.1fr_0.9fr] md:items-start md:gap-6 md:p-6"
                >
                  <a href={step.image} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border">
                    <img src={step.image} alt={step.title} loading="lazy" className="w-full" />
                  </a>
                  <div className="space-y-2">
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
