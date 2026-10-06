import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bot,
  ChevronRight,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  ShoppingBag,
  Users,
  CalendarCheck,
  BookOpen,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/hooks/use-translation";
import { setPostAuthTarget } from "@/lib/post-auth";
import { useIsMobileViewport } from "./use-is-mobile-viewport";
import { VIEWPORT_ONCE } from "./motion";

/**
 * Top-of-landing entry block: brand + tagline, the two big entry buttons
 * (bot builder / school system) and one animated preview of each dashboard.
 * The previews are drawn in CSS/SVG (no screenshots to go stale); bars grow
 * and the line draws once when scrolled into view. Only transform/opacity and
 * SVG stroke animate; the soft pulse loop is off on mobile / reduced motion.
 */

type Entry = { key: "bot" | "school"; href: string; icon: LucideIcon; title: string; desc: string };

function MockWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-xl" dir="ltr">
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2">
        <span className="size-2.5 rounded-full bg-red-400/80" />
        <span className="size-2.5 rounded-full bg-amber-400/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ms-3 truncate text-[11px] text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Sidebar({ icons, active }: { icons: LucideIcon[]; active: number }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-e bg-muted/30 py-3">
      {icons.map((Icon, i) => (
        <span
          key={i}
          className={`flex size-7 items-center justify-center rounded-md ${
            i === active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <Icon className="size-4" />
        </span>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, label, value, delay, reduce }: { icon: LucideIcon; label: string; value: string; delay: number; reduce: boolean }) {
  return (
    <motion.div
      className="rounded-lg border bg-card p-2.5"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT_ONCE}
      transition={{ delay, duration: 0.4 }}
    >
      <Icon className="size-3.5 text-primary" />
      <div className="mt-1.5 text-sm font-bold leading-none">{value}</div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">{label}</div>
    </motion.div>
  );
}

function Bars({ values, reduce, pulse }: { values: number[]; reduce: boolean; pulse: boolean }) {
  return (
    <div className="flex h-20 items-end gap-1.5">
      {values.map((v, i) => (
        <motion.div
          key={i}
          className="flex-1 origin-bottom rounded-t bg-gradient-to-t from-primary/70 to-primary"
          style={{ height: `${v}%` }}
          initial={reduce ? false : { scaleY: 0 }}
          whileInView={pulse ? { scaleY: [1, 0.82, 1] } : { scaleY: 1 }}
          viewport={VIEWPORT_ONCE}
          transition={
            pulse
              ? { delay: 0.2 + i * 0.07, duration: 3.2, repeat: Infinity, ease: "easeInOut" }
              : { delay: 0.2 + i * 0.07, duration: 0.5, ease: "easeOut" }
          }
        />
      ))}
    </div>
  );
}

function BotPanelMock({ reduce, pulse, tr }: { reduce: boolean; pulse: boolean; tr: Record<string, string> }) {
  return (
    <MockWindow title="irforge.com / bots">
      <div className="flex">
        <Sidebar icons={[LayoutDashboard, MessageSquare, ShoppingBag, Users, Wallet]} active={0} />
        <div className="min-w-0 flex-1 space-y-3 p-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat reduce={reduce} delay={0.1} icon={ShoppingBag} label={tr.mkOrders} value="248" />
            <Stat reduce={reduce} delay={0.2} icon={Users} label={tr.mkUsers} value="1,820" />
            <Stat reduce={reduce} delay={0.3} icon={Wallet} label={tr.mkRevenue} value="۳۲M" />
          </div>
          <div className="rounded-lg border bg-card p-3">
            <Bars reduce={reduce} pulse={pulse} values={[35, 50, 42, 68, 55, 80, 72, 92]} />
          </div>
          <div className="space-y-1.5">
            {[0.6, 0.45].map((w, i) => (
              <motion.div
                key={i}
                className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                initial={reduce ? false : { opacity: 0, x: -14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={VIEWPORT_ONCE}
                transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
              >
                <Bot className="size-3.5 text-primary" />
                <span className="h-1.5 rounded bg-muted" style={{ width: `${w * 100}%` }} />
                <span className="ms-auto size-1.5 rounded-full bg-emerald-500" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </MockWindow>
  );
}

function SchoolPanelMock({ reduce, pulse, tr }: { reduce: boolean; pulse: boolean; tr: Record<string, string> }) {
  const chips = ["۱۸.۵", "۲۰", "۱۶", "۱۹"];
  return (
    <MockWindow title="irforge.com / schools">
      <div className="flex">
        <Sidebar icons={[LayoutDashboard, Users, BookOpen, CalendarCheck, GraduationCap]} active={1} />
        <div className="min-w-0 flex-1 space-y-3 p-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat reduce={reduce} delay={0.1} icon={BookOpen} label={tr.mkClasses} value="24" />
            <Stat reduce={reduce} delay={0.2} icon={Users} label={tr.mkUsers} value="640" />
            <Stat reduce={reduce} delay={0.3} icon={CalendarCheck} label={tr.mkAttendance} value="96%" />
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-[10px] text-muted-foreground">{tr.mkAttendance}</div>
            <svg viewBox="0 0 200 60" className="h-20 w-full" preserveAspectRatio="none" aria-hidden="true">
              <motion.path
                d="M0 45 L25 38 L50 42 L75 26 L100 30 L125 18 L150 22 L175 10 L200 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary"
                initial={reduce ? false : { pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={VIEWPORT_ONCE}
                transition={{ duration: 1.4, ease: "easeInOut" }}
              />
            </svg>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">{tr.mkGrades}</span>
            {chips.map((c, i) => (
              <motion.span
                key={c}
                className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"
                initial={reduce ? false : { opacity: 0, scale: 0.7 }}
                whileInView={pulse ? { opacity: 1, scale: [1, 1.08, 1] } : { opacity: 1, scale: 1 }}
                viewport={VIEWPORT_ONCE}
                transition={
                  pulse
                    ? { delay: 0.6 + i * 0.12, duration: 2.6, repeat: Infinity, repeatDelay: 1.5 }
                    : { delay: 0.6 + i * 0.12, duration: 0.3 }
                }
              >
                {c}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </MockWindow>
  );
}

export function EntryShowcase() {
  const tr = useT("landing") as unknown as Record<string, string>;
  const { user } = useAuth();
  const reduce = !!useReducedMotion();
  const isMobile = useIsMobileViewport();
  const pulse = !reduce && !isMobile;

  const entries: Entry[] = [
    { key: "bot", href: "/dashboard", icon: Bot, title: tr.ctaBotTitle, desc: tr.ctaBotDesc },
    { key: "school", href: "/schools", icon: GraduationCap, title: tr.ctaSchoolTitle, desc: tr.ctaSchoolDesc },
  ];

  return (
    <section className="relative overflow-hidden border-b bg-gradient-to-b from-primary/5 to-transparent" data-testid="entry-showcase">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <motion.div
          className="text-center"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="bg-gradient-to-r from-primary via-orange-400 to-amber-400 bg-clip-text text-5xl font-black tracking-tight text-transparent md:text-7xl">
            IrForge
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">{tr.entryTagline}</p>
        </motion.div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2" data-testid="hero-entry-cards">
          {entries.map(({ key, href, icon: Icon, title, desc }) => (
            <Link
              key={key}
              href={user ? href : "/login"}
              onClick={() => setPostAuthTarget(href)}
              data-testid={`hero-cta-${key}`}
              className="group flex items-center gap-4 rounded-2xl border-2 border-primary/30 bg-card/70 p-6 text-start shadow-lg backdrop-blur transition hover:border-primary hover:bg-primary/10 md:p-8"
            >
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary md:size-16">
                <Icon className="size-8" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl font-extrabold md:text-2xl">{title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{desc}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-primary rtl-flip" />
            </Link>
          ))}
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {[
            { key: "bot", title: tr.botShowTitle, desc: tr.botShowDesc, mock: <BotPanelMock reduce={reduce} pulse={pulse} tr={tr} /> },
            { key: "school", title: tr.schoolShowTitle, desc: tr.schoolShowDesc, mock: <SchoolPanelMock reduce={reduce} pulse={pulse} tr={tr} /> },
          ].map((s) => (
            <motion.div
              key={s.key}
              initial={reduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={VIEWPORT_ONCE}
              transition={{ duration: 0.5 }}
              data-testid={`showcase-${s.key}`}
            >
              {s.mock}
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
