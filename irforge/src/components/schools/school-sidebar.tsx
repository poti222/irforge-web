import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Fragment } from "react";
import { Link, useLocation } from "wouter";
import { SidebarBrandHeader } from "@/components/layout/brand-home";
import {
  UserCircle,
  Users,
  School as SchoolIcon,
  LayoutGrid,
  CalendarClock,
  Megaphone,
  BellRing,
  BookOpenText,
  NotebookPen,
  Library,
  Sigma,
  MessageCircleQuestion,
  ShieldCheck,
  GraduationCap,
  ClipboardList,
  FileQuestion,
  Presentation,
  CalendarDays,
  BarChart3,
  MessagesSquare,
  Eye,
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { isRtlLang } from "@/lib/i18n";
import type { SchoolMemberRole } from "@/lib/schools-api";

type NavItem = { key: string; href: string; icon: any; label: string };

/**
 * ناوبریِ هر نقش — فاز ۱ فقط اسکلت است: هر آیتم به یک مسیرِ واقعی (اگر ساخته
 * شده) یا یک صفحه‌ی «به‌زودی» (`/schools/stub/:key`) می‌رود. لیست نقش‌های
 * معلم/مشاور/معاون/معاون‌انضباطی/والد مستقیماً از آیتم‌های school-app گرفته
 * شده (طبقِ خواستِ کاربر)، فقط برچسب‌ها فارسی و مسیرها استاب‌اند.
 */
function useNavByRole(role: SchoolMemberRole | null | undefined, t: any): NavItem[] {
  switch (role) {
    case "admin":
      return [
        { key: "my-schools", href: "/schools/admin", icon: SchoolIcon, label: t.navMySchools },
        { key: "members", href: "/schools/admin/members", icon: Users, label: t.navMemberManagement },
        { key: "classes", href: "/schools/admin/classes", icon: LayoutGrid, label: t.navClassManagement },
        { key: "programs", href: "/schools/admin/programs", icon: CalendarClock, label: t.navProgramManagement },
        { key: "broadcast", href: "/schools/announcements", icon: Megaphone, label: t.navBroadcast },
        { key: "closure", href: "/schools/announcements", icon: BellRing, label: t.navClosureAnnouncement },
      ];
    case "student":
      return [
        { key: "dictionary", href: "/schools/content/dictionary", icon: BookOpenText, label: t.navDictionary },
        { key: "notes", href: "/schools/content/note", icon: NotebookPen, label: t.navNotes },
        { key: "books", href: "/schools/content/book", icon: Library, label: t.navBooks },
        { key: "formulas", href: "/schools/content/formula", icon: Sigma, label: t.navFormulas },
        { key: "announcements", href: "/schools/announcements", icon: Megaphone, label: t.navAnnouncements },
        { key: "contact-counselor", href: "/schools/stub/contact-counselor", icon: MessageCircleQuestion, label: t.navContactCounselor },
        { key: "contact-admin", href: "/schools/stub/contact-admin", icon: ShieldCheck, label: t.navContactAdmin },
        { key: "contact-teacher", href: "/schools/stub/contact-teacher", icon: GraduationCap, label: t.navContactTeacher },
      ];
    case "teacher":
      // فاز ۳ (بندِ ۳): «امروز» و «تکالیف» دیگر استاب نیستند؛ آزمون/بانکِ
      // سؤال طبقِ چک‌لیست عمداً استاب ماندند (فازِ بعد).
      return [
        { key: "classrooms", href: "/schools/teacher/classes", icon: Presentation, label: t.navClassrooms },
        { key: "assignments", href: "/schools/teacher/assignments", icon: ClipboardList, label: t.navAssignments },
        { key: "exams", href: "/schools/stub/exams", icon: FileQuestion, label: t.navExams },
        { key: "question-bank", href: "/schools/stub/question-bank", icon: Library, label: t.navQuestionBank },
        { key: "today", href: "/schools/teacher/today", icon: CalendarDays, label: t.navToday },
      ];
    case "counselor":
      return [
        { key: "student-list", href: "/schools/counselor/students", icon: Users, label: t.navStudentList },
        { key: "reports", href: "/schools/stub/reports", icon: BarChart3, label: t.navReports },
        { key: "chat", href: "/schools/stub/chat", icon: MessagesSquare, label: t.navChat },
        { key: "schedule", href: "/schools/stub/schedule", icon: CalendarClock, label: t.navSchedule },
      ];
    case "deputy":
    case "deputy_discipline":
      // فاز ۳ (بندِ ۵): «مدیریتِ برنامه‌ها» دیگر استاب نیست — همان صفحه/API
      // که مدیر استفاده می‌کند، فقط بک‌اند (schoolPrograms.ts) حالا نوشتن را
      // هم برایِ این دو نقش می‌پذیرد.
      return [
        { key: "members", href: "/schools/admin/members", icon: Users, label: t.navMemberManagement },
        { key: "programs", href: "/schools/admin/programs", icon: CalendarClock, label: t.navProgramManagement },
        { key: "broadcast", href: "/schools/announcements", icon: Megaphone, label: t.navBroadcast },
        { key: "closure", href: "/schools/announcements", icon: BellRing, label: t.navClosureAnnouncement },
      ];
    case "parent":
      return [
        { key: "children", href: "/schools/parent/children", icon: Eye, label: t.navChildrenOverview },
        { key: "reports", href: "/schools/stub/reports", icon: BarChart3, label: t.navReports },
        { key: "chat", href: "/schools/stub/chat", icon: MessagesSquare, label: t.navChat },
      ];
    default:
      return [];
  }
}

export function SchoolSidebar({ role, schoolName }: { role: SchoolMemberRole | null | undefined; schoolName?: string | null }) {
  const [location] = useLocation();
  const { lang } = useLanguage();
  const t = useT("schools");
  const items = useNavByRole(role, t);

  return (
    <Sidebar side={isRtlLang(lang) ? "right" : "left"} variant="inset" collapsible="icon">
      <SidebarHeader className="p-0">
        <SidebarBrandHeader
          href="/schools"
          data-testid="nav-schools-brand"
          className="group-data-[collapsible=icon]:px-0"
          logoClassName="group-data-[collapsible=icon]:[&>span]:hidden"
        />
      </SidebarHeader>

      <SidebarContent>
        {role === "student" && schoolName && (
          <div className="px-3 pt-3 text-xs font-medium text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            {schoolName}
          </div>
        )}
        <SidebarGroup>
          <SidebarGroupContent className="pt-2">
            <SidebarMenu>
              {items.map((item) => (
                <Fragment key={item.key}>
                  {/* دیوایدرها طبقِ اسپکِ کاربر: بعد از «مدرسه‌های من» (مدیر) و بعد از «لغت‌نامه‌ها» (دانش‌آموز) */}
                  {role === "admin" && item.key === "members" && <SidebarSeparator />}
                  {role === "admin" && item.key === "broadcast" && <SidebarSeparator />}
                  {role === "student" && item.key === "contact-counselor" && <SidebarSeparator />}
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith(item.href)} tooltip={item.label}>
                      <Link href={item.href} data-testid={`nav-school-${item.key}`}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Fragment>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {/* «پروفایل» باید توی همه‌ی نقش‌ها باشه — همون صفحه‌ی سراسریِ /profile، دوباره ساخته نمی‌شود. */}
            <SidebarMenuButton asChild isActive={location === "/profile"} tooltip={t.navProfile}>
              <Link href="/profile" data-testid="nav-school-profile">
                <UserCircle />
                <span>{t.navProfile}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
