/**
 * TutorialButton.tsx — IRFORGE_TUTORIAL_SYSTEM_PROMPT.
 *
 * دکمه‌یِ مشترکِ «📖 آموزش» که هر بخشِ ادمین (پنل‌ها، کاتالوگ، پرداخت، ...)
 * با یک خط reuse می‌کند. کلیک، TutorialDrawer را با محتوایِ همان بخش باز
 * می‌کند — بدونِ خروج از صفحه.
 */
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { TutorialDrawer } from "./TutorialDrawer";
import { TUTORIALS, type TutorialSectionId } from "@/lib/tutorials/content";

const TITLE_KEY: Record<TutorialSectionId, "titlePanels" | "titleCatalog" | "titlePayments"> = {
  panels: "titlePanels",
  catalog: "titleCatalog",
  payments: "titlePayments",
};

export function TutorialButton({ section }: { section: TutorialSectionId }) {
  const t = useT("tutorial");
  const [open, setOpen] = useState(false);
  const steps = TUTORIALS[section];

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BookOpen className="me-1.5 size-4" />
        {t.button}
      </Button>
      <TutorialDrawer
        open={open}
        onOpenChange={setOpen}
        title={t[TITLE_KEY[section]]}
        steps={steps}
      />
    </>
  );
}
