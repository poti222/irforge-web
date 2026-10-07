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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Fragment, useState } from "react";
import { Link, useLocation } from "wouter";
import { SidebarBrandHeader } from "@/components/layout/brand-home";
import { InviteCodeWidget } from "@/components/schools/InviteCodeWidget";
import {
  UserCircle,
  Users,
  School as SchoolIcon,
  LayoutGrid,
  CalendarClock,
  Megaphone,
  BellRing,
  BookOpen,
  Library,
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
  Inbox,
  ClipboardCheck,
  Table2,
  ShieldAlert,
  History,
  Search,
  Link2,
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { isRtlLang } from "@/lib/i18n";
import type { SchoolMemberRole } from "@/lib/schools-api";

type NavItem = {
  key: string; href: string; icon: any; label: string;
  /** برایِ آیتمی که چند مسیرِ زیرمجموعه دارد (مثلاً «درس‌ها»)؛ پیش‌فرض: location.startsWith(href). */
  isActive?: (location: string) => boolean;
};

/**
 * «درس‌ها» برایِ همه‌یِ نقش‌ها یک آیتمِ واحد است (جایگزینِ لغت‌نامه/اشعار/فرمول/جزوه/
 * کتاب). دانش‌آموز: به خانه‌اش `/schools/student` (که خودِ فهرستِ موضوعات است)
 * می‌رود؛ چون سایرِ صفحاتِ دانش‌آموز هم زیرِ `/schools/student/...` هستند، فعال‌بودنش
 * فقط وقتی است که دقیقاً روی خانه باشد یا هر جایی زیرِ درختِ `/schools/content`
 * (موضوع/درس/نوع/مطالعه). location در اینجا بدونِ پیشوندِ زبان است (base در WouterRouter).
 */
const lessonsActive = (loc: string) => loc === "/schools/student" || loc.startsWith("/schools/content");

/**
 * ناوبریِ هر نقش — فاز ۱ فقط اسکلت است: هر آیتم به یک مسیرِ واقعی (اگر ساخته
 * شده) یا یک صفحه‌ی «به‌زودی» (`/schools/stub/:key`) می‌رود. لیست نقش‌های
 * معلم/مشاور/معاون/معاون‌انضباطی/والد مستقیماً از آیتم‌های school-app گرفته
 * شده (طبقِ خواستِ کاربر)، فقط برچسب‌ها فارسی و مسیرها استاب‌اند.
 */
function useNavByRole(role: SchoolMemberRole | null | undefined, t: any): NavItem[] {
  switch (role) {
    case "admin":
      // فاز ۵ (بندِ ۱): «پیام‌ها» (صندوقِ ارتباط با مدیر) اضافه شد — جدا از
      // «اعلامیه/بستنِ مدرسه» (که یک‌طرفه و همگانی‌اند، نه گفتگو).
      return [
        { key: "my-schools", href: "/schools/admin", icon: SchoolIcon, label: t.navMySchools },
        { key: "members", href: "/schools/admin/members", icon: Users, label: t.navMemberManagement },
        { key: "classes", href: "/schools/admin/classes", icon: LayoutGrid, label: t.navClassManagement },
        { key: "programs", href: "/schools/admin/programs", icon: CalendarClock, label: t.navProgramManagement },
        // «درس‌ها»: مدیر موضوعات را می‌سازد/تغییرِ نام/حذف می‌کند (قبلاً مدیر آیتمِ محتوا نداشت).
        { key: "lessons", href: "/schools/content", icon: BookOpen, label: t.navLessons },
        { key: "alerts", href: "/schools/admin/alerts", icon: ShieldAlert, label: t.navAlerts },
        { key: "messages", href: "/schools/admin/messages", icon: Inbox, label: t.navMessages },
        { key: "broadcast", href: "/schools/announcements", icon: Megaphone, label: t.navBroadcast },
        { key: "closure", href: "/schools/announcements", icon: BellRing, label: t.navClosureAnnouncement },
        // فازِ ۹ (بندِ ۳): «تاریخچه» — لاگِ فقط‌خواندنیِ رخدادهایِ مدیریتی.
        { key: "audit-log", href: "/schools/admin/audit-log", icon: History, label: t.navAuditLog },
      ];
    case "student":
      // فاز ۶ (بندِ ۱/۲): «حضور و غیاب» و «نمره‌های من» اضافه شدند.
      return [
        { key: "lessons", href: "/schools/student", icon: BookOpen, label: t.navLessons, isActive: lessonsActive },
        { key: "timetable", href: "/schools/timetable", icon: CalendarClock, label: t.navTimetable },
        { key: "announcements", href: "/schools/announcements", icon: Megaphone, label: t.navAnnouncements },
        // باگِ همان‌خانواده‌ی موردِ معلم (بالا): «تکالیف» فقط به‌صورتِ تایل در
        // صفحه‌ی خانه‌ی دانش‌آموز بود، نه آیتمِ سایدبار — یعنی از هر زیرصفحه‌ی
        // دیگر (مثلاً «آزمون‌ها») راهی به تکالیف جز برگشتن به خانه نبود.
        { key: "assignments", href: "/schools/student/assignments", icon: ClipboardList, label: t.navAssignments },
        { key: "attendance", href: "/schools/student/attendance", icon: ClipboardCheck, label: t.navAttendance },
        { key: "grades", href: "/schools/student/grades", icon: GraduationCap, label: t.navGrades },
        { key: "exams", href: "/schools/student/exams", icon: FileQuestion, label: t.navExams },
        { key: "contact-counselor", href: "/schools/student/counselor", icon: MessageCircleQuestion, label: t.navContactCounselor },
        { key: "contact-admin", href: "/schools/student/admin-chat", icon: ShieldCheck, label: t.navContactAdmin },
        { key: "contact-teacher", href: "/schools/student/teacher-chat", icon: GraduationCap, label: t.navContactTeacher },
      ];
    case "teacher":
      // فاز ۶ (بندِ ۱/۲): «حضور و غیاب» و «نمره‌نامه» اضافه شدند.
      // «درس‌ها» — یک آیتمِ واحد به‌جایِ پنج آیتمِ جدایِ محتوا (قبلاً معلم اصلاً لینکی به
      // کتابخانه نداشت؛ حالا هاب موضوعات، و داخلش درس‌هایِ تخصیص‌داده‌شده).
      return [
        { key: "lessons", href: "/schools/content", icon: BookOpen, label: t.navLessons },
        { key: "classrooms", href: "/schools/teacher/classes", icon: Presentation, label: t.navClassrooms },
        { key: "timetable", href: "/schools/timetable", icon: CalendarClock, label: t.navTimetable },
        { key: "attendance", href: "/schools/teacher/attendance", icon: ClipboardCheck, label: t.navAttendance },
        { key: "assignments", href: "/schools/teacher/assignments", icon: ClipboardList, label: t.navAssignments },
        { key: "gradebook", href: "/schools/teacher/gradebook", icon: Table2, label: t.navGradebook },
        { key: "exams", href: "/schools/teacher/exams", icon: FileQuestion, label: t.navExams },
        { key: "question-bank", href: "/schools/teacher/questions", icon: Library, label: t.navQuestionBank },
        { key: "messages", href: "/schools/teacher/messages", icon: Inbox, label: t.navMessages },
        { key: "today", href: "/schools/teacher/today", icon: CalendarDays, label: t.navToday },
      ];
    case "counselor":
      // فاز ۴ (بندِ ۱): گزارش/چت/برنامه دیگر استاب نیستند.
      return [
        { key: "student-list", href: "/schools/counselor/students", icon: Users, label: t.navStudentList },
        { key: "reports", href: "/schools/counselor/reports", icon: BarChart3, label: t.navReports },
        { key: "chat", href: "/schools/counselor/chat", icon: MessagesSquare, label: t.navChat },
        { key: "schedule", href: "/schools/counselor/schedule", icon: CalendarClock, label: t.navSchedule },
      ];
    case "deputy":
      // فاز ۳ (بندِ ۵): «مدیریتِ برنامه‌ها» دیگر استاب نیست — همان صفحه/API
      // که مدیر استفاده می‌کند، فقط بک‌اند (schoolPrograms.ts) حالا نوشتن را
      // هم برایِ این دو نقش می‌پذیرد.
      return [
        { key: "members", href: "/schools/admin/members", icon: Users, label: t.navMemberManagement },
        { key: "programs", href: "/schools/admin/programs", icon: CalendarClock, label: t.navProgramManagement },
        { key: "broadcast", href: "/schools/announcements", icon: Megaphone, label: t.navBroadcast },
        { key: "closure", href: "/schools/announcements", icon: BellRing, label: t.navClosureAnnouncement },
      ];
    case "deputy_discipline":
      // فاز ۶ (بندِ ۴): اولین آیتمِ ناوبریِ واقعاً مجزایِ این نقش — «اخطارها»
      // (schools/admin/alerts.tsx) — تا این‌جا لیستِ این نقش عیناً همان
      // deputy بود؛ بقیه‌ی آیتم‌ها را هم نگه می‌داریم چون معاونِ انضباطی هنوز
      // به مدیریتِ اعضا/برنامه/اطلاعیه هم دسترسیِ نوشتن دارد.
      return [
        { key: "alerts", href: "/schools/admin/alerts", icon: ShieldAlert, label: t.navAlerts },
        { key: "members", href: "/schools/admin/members", icon: Users, label: t.navMemberManagement },
        { key: "programs", href: "/schools/admin/programs", icon: CalendarClock, label: t.navProgramManagement },
        { key: "broadcast", href: "/schools/announcements", icon: Megaphone, label: t.navBroadcast },
        { key: "closure", href: "/schools/announcements", icon: BellRing, label: t.navClosureAnnouncement },
      ];
    case "parent":
      // فاز ۶ (بندِ ۴): «گزارش‌ها»/«چت»/«اخطارها»/«نمره‌ها»/«حضور و غیاب» همه در
      // یک داشبوردِ تب‌دارِ واحد ادغام شدند (parent/reports.tsx) — به‌جایِ
      // اضافه‌کردنِ سه آیتمِ ناوبریِ جدا-از-هم که تجربه‌ی «پرونده‌ی فرزند» را
      // تکه‌تکه می‌کرد؛ یک لینکِ ناوبریِ واحد («داشبوردِ فرزند»).
      return [
        { key: "children", href: "/schools/parent/children", icon: Eye, label: t.navChildrenOverview },
        { key: "link-student", href: "/schools/parent/link", icon: Link2, label: t.navLinkStudent },
        { key: "dashboard", href: "/schools/parent/reports", icon: BarChart3, label: t.navParentDashboard },
        { key: "timetable", href: "/schools/timetable", icon: CalendarClock, label: t.navTimetable },
      ];
    default:
      return [];
  }
}

export function SchoolSidebar({ role, schoolName }: { role: SchoolMemberRole | null | undefined; schoolName?: string | null }) {
  const [location] = useLocation();
  const { lang } = useLanguage();
  const t = useT("schools") as any;
  const items = useNavByRole(role, t);
  // طبقِ خواستِ کاربر: کسی که از قبل عضوِ مدرسه‌ای است، ویجتِ همیشه‌نمایانِ
  // «پیدا کردن مدرسه» را کنارِ سایدبار نمی‌بیند (SchoolShell.tsx) — به‌جایش
  // همین آیتمِ ناوبری که آن ویجت را در یک دیالوگِ روی‌تقاضا باز می‌کند، برایِ
  // وقتی مثلاً مدیر/معلمی می‌خواهد با یک کدِ دیگر به مدرسه‌یِ دیگری هم بپیوندد.
  const [findSchoolOpen, setFindSchoolOpen] = useState(false);

  return (
    <Sidebar side={isRtlLang(lang) ? "right" : "left"} variant="inset" collapsible="icon">
      <SidebarHeader className="p-0">
        <SidebarBrandHeader
          href="/"
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
                    <SidebarMenuButton asChild isActive={item.isActive ? item.isActive(location) : location.startsWith(item.href)} tooltip={item.label}>
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
            <SidebarMenuButton onClick={() => setFindSchoolOpen(true)} tooltip={t.findSchoolNavLabel} data-testid="nav-school-find-other">
              <Search />
              <span>{t.findSchoolNavLabel}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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

      <Dialog open={findSchoolOpen} onOpenChange={setFindSchoolOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.findSchoolNavLabel}</DialogTitle>
          </DialogHeader>
          <InviteCodeWidget compact />
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
