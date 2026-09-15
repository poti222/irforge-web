/**
 * TutorialButton.tsx — IRFORGE_TUTORIAL_SYSTEM_PROMPT.
 *
 * دکمه‌یِ مشترکِ «📖 آموزش» که هر بخشِ ادمین (پنل‌ها، کاتالوگ، پرداخت، ...)
 * با یک خط reuse می‌کند. کلیک، TutorialDrawer را با محتوایِ همان بخش باز
 * می‌کند — بدونِ خروج از صفحه. اگر برایِ این بخش هنوز آموزشی نوشته نشده،
 * چیزی رندر نمی‌کند (نه یک دکمه‌ی خالی) — همین باعث می‌شود بشود آن را در
 * `BotWorkspaceDocument.tsx` بدونِ چک کردن هر بار، برایِ هر سکشن صدا زد.
 *
 * عنوانِ درایور از برچسبِ خودِ سکشن در namespace «botWorkspace» ساخته
 * می‌شود (`sectionPanels`, `sectionCatalog`, ...) — نه یک کلیدِ جداگانه
 * به‌ازایِ هر بخش، چون آن برچسب‌ها از قبل در هر پنج زبان موجودند.
 */
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { TutorialDrawer } from "./TutorialDrawer";
import { TUTORIALS, type TutorialSectionId } from "@/lib/tutorials/content";

function sectionLabelKey(section: TutorialSectionId) {
  return `section${section[0].toUpperCase()}${section.slice(1)}` as keyof ReturnType<
    typeof useT<"botWorkspace">
  >;
}

export function TutorialButton({ section }: { section: TutorialSectionId }) {
  const t = useT("tutorial");
  const tWorkspace = useT("botWorkspace");
  const [open, setOpen] = useState(false);
  const steps = TUTORIALS[section];

  if (!steps || steps.length === 0) return null;

  const sectionLabel = String(tWorkspace[sectionLabelKey(section)] ?? "");
  const title = t.titleFormat.replace("{section}", sectionLabel);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BookOpen className="me-1.5 size-4" />
        {t.button}
      </Button>
      <TutorialDrawer open={open} onOpenChange={setOpen} title={title} steps={steps} />
    </>
  );
}
