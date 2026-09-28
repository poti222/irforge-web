import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpenText, NotebookPen, Library, Sigma, MessageCircleQuestion, ShieldCheck, GraduationCap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe } from "@/lib/schools-api";

const TILES = [
  { key: "dictionary", href: "/schools/content/dictionary", icon: BookOpenText },
  { key: "notes", href: "/schools/content/note", icon: NotebookPen },
  { key: "books", href: "/schools/content/book", icon: Library },
  { key: "formulas", href: "/schools/content/formula", icon: Sigma },
  { key: "contact-counselor", href: "/schools/stub/contact-counselor", icon: MessageCircleQuestion },
  { key: "contact-admin", href: "/schools/stub/contact-admin", icon: ShieldCheck },
  { key: "contact-teacher", href: "/schools/stub/contact-teacher", icon: GraduationCap },
];

const TILE_LABEL_KEY: Record<string, string> = {
  dictionary: "navDictionary",
  notes: "navNotes",
  books: "navBooks",
  formulas: "navFormulas",
  "contact-counselor": "navContactCounselor",
  "contact-admin": "navContactAdmin",
  "contact-teacher": "navContactTeacher",
};

export default function SchoolsStudentHome() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.studentHomeTitle);
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{me?.school?.name ?? t.studentHomeTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.studentHomeDescription}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <Link key={tile.key} href={tile.href}>
            <Card className="cursor-pointer transition hover:border-primary/50">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <tile.icon className="size-5 text-primary" />
                <CardTitle className="text-base">{t[TILE_LABEL_KEY[tile.key]]}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{t.studentTileHint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
