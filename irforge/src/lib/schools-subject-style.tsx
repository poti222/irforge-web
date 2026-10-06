import {
  Atom,
  BookOpen,
  BookOpenText,
  Brain,
  Calculator,
  Cpu,
  Dumbbell,
  Feather,
  FlaskConical,
  Globe,
  Landmark,
  Languages,
  Leaf,
  Library,
  Microscope,
  Music,
  NotebookPen,
  Palette,
  ScrollText,
  Sigma,
  type LucideIcon,
} from "lucide-react";
import type { SchoolContentType } from "@/lib/schools-api";

/**
 * ظاهرِ «درس»ها و «انواعِ محتوا» — یک جای واحد تا هر چهار سطحِ صفحه
 * (درس‌ها ← درس ← جلسه ← نوع) یکدست دیده شوند.
 *
 * رنگ‌ها عمداً کلاسِ Tailwindِ *لفظی* هستند (نه ساخته‌شده با رشته‌چسبانی)،
 * وگرنه JITِ Tailwind آن‌ها را در build نمی‌بیند و رنگ‌ها ناپدید می‌شوند.
 * هر رنگ هم در تمِ روشن و هم تیره خوانا است (آلفایِ کم برایِ پس‌زمینه).
 */
export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  calculator: Calculator,
  atom: Atom,
  flask: FlaskConical,
  leaf: Leaf,
  languages: Languages,
  landmark: Landmark,
  globe: Globe,
  dumbbell: Dumbbell,
  feather: Feather,
  scroll: ScrollText,
  music: Music,
  palette: Palette,
  cpu: Cpu,
  brain: Brain,
  microscope: Microscope,
};

export interface SubjectColor {
  /** چیپِ آیکن */
  chip: string;
  /** بردرِ کارت در حالتِ hover */
  hoverBorder: string;
  /** نوارِ پیشرفت */
  bar: string;
  /** گرادیانِ ملایمِ بالایِ کارت */
  glow: string;
  /** نمونه‌یِ رنگ در پیکرِ انتخاب */
  swatch: string;
  text: string;
}

export const SUBJECT_COLORS: Record<string, SubjectColor> = {
  blue: { chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400", hoverBorder: "hover:border-blue-500/50", bar: "bg-blue-500", glow: "from-blue-500/10", swatch: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  emerald: { chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hoverBorder: "hover:border-emerald-500/50", bar: "bg-emerald-500", glow: "from-emerald-500/10", swatch: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  amber: { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", hoverBorder: "hover:border-amber-500/50", bar: "bg-amber-500", glow: "from-amber-500/10", swatch: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  rose: { chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400", hoverBorder: "hover:border-rose-500/50", bar: "bg-rose-500", glow: "from-rose-500/10", swatch: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  violet: { chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400", hoverBorder: "hover:border-violet-500/50", bar: "bg-violet-500", glow: "from-violet-500/10", swatch: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  cyan: { chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", hoverBorder: "hover:border-cyan-500/50", bar: "bg-cyan-500", glow: "from-cyan-500/10", swatch: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400" },
  orange: { chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400", hoverBorder: "hover:border-orange-500/50", bar: "bg-orange-500", glow: "from-orange-500/10", swatch: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  slate: { chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300", hoverBorder: "hover:border-slate-500/50", bar: "bg-slate-500", glow: "from-slate-500/10", swatch: "bg-slate-500", text: "text-slate-600 dark:text-slate-300" },
};

export const SUBJECT_COLOR_KEYS = Object.keys(SUBJECT_COLORS);
export const SUBJECT_ICON_KEYS = Object.keys(SUBJECT_ICONS);

/** درسِ بدونِ آیکن/رنگ (مثلاً ساخته‌شده با backfill) ظاهرِ خنثی می‌گیرد، نه خطا. */
export function subjectStyle(subject: { icon: string | null; color: string | null } | null | undefined) {
  return {
    Icon: (subject?.icon && SUBJECT_ICONS[subject.icon]) || BookOpen,
    color: (subject?.color && SUBJECT_COLORS[subject.color]) || SUBJECT_COLORS.slate,
  };
}

/** ترتیبِ استانداردِ انواع (همان ترتیبِ ثابتِ سرور). */
export const CONTENT_TYPE_ORDER: SchoolContentType[] = ["dictionary", "poem", "formula", "note", "book"];

export const TYPE_LABEL_KEY: Record<SchoolContentType, string> = {
  dictionary: "navDictionary",
  poem: "navPoems",
  formula: "navFormulas",
  note: "navNotes",
  book: "navBooks",
};

export const TYPE_META: Record<SchoolContentType, { Icon: LucideIcon; color: SubjectColor }> = {
  dictionary: { Icon: BookOpenText, color: SUBJECT_COLORS.cyan },
  poem: { Icon: Feather, color: SUBJECT_COLORS.rose },
  formula: { Icon: Sigma, color: SUBJECT_COLORS.violet },
  note: { Icon: NotebookPen, color: SUBJECT_COLORS.amber },
  book: { Icon: Library, color: SUBJECT_COLORS.emerald },
};

/**
 * «خانه‌یِ درس‌ها»: برایِ دانش‌آموز خودِ صفحه‌یِ خانه‌اش (`/schools/student`) فهرستِ
 * موضوعات است؛ معلم/مدیر هابِ مدیریتیِ `/schools/content` را دارند. مسیرها
 * عمداً بدونِ پیشوندِ زبان‌اند: WouterRouter با `base` پیشوندِ /en /fa را خودش
 * اضافه می‌کند (App.tsx)، پس Link/navigate/Redirect با همین مسیرها در همه‌یِ
 * زبان‌ها درست کار می‌کنند.
 */
export function contentHubHref(role: string | null | undefined) {
  return role === "student" ? "/schools/student" : "/schools/content";
}
