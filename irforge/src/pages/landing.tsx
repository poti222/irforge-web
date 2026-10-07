import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Terminal,
  Blocks,
  Zap,
  ChevronRight,
  Github,
  Shield,
  BarChart3,
  Bot,
  Rocket,
  Check,
  Smartphone,
  ClipboardCheck,
  MessageSquare,
  ShoppingBag,
  LifeBuoy,
  LayoutGrid,
  Megaphone,
  CalendarCheck,
  Database,
  GraduationCap,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BrandLogo } from "@/components/layout/brand-home";
import { ForgeDemo } from "@/components/landing/forge/ForgeDemo";
import { Bezel } from "@/components/landing/forge/Bezel";
import { Embers } from "@/components/landing/forge/Embers";
import { CapabilityMarquee } from "@/components/landing/forge/Marquee";
import { SchoolPhone } from "@/components/landing/forge/SchoolPhone";
import { setPostAuthTarget } from "@/lib/post-auth";
import { MiniAnalyticsChart } from "@/components/landing/MiniAnalyticsChart";
import { PluginRail } from "@/components/landing/PluginRail";
import { FaqSection } from "@/components/landing/FaqSection";
import { PublicFooter } from "@/components/layout/public-footer";
import { useLanguage } from "@/hooks/use-language";
import { articleFor, type ArticleSlug } from "@/lib/learn-content";

/**
 * The guides worth surfacing on the homepage, highest intent first: the two
 * "what is it / how do I start" pages, then the buying-comparison pages. The
 * rest of the cluster is one hop away through the hub and the footer.
 */
const FEATURED_GUIDES: ArticleSlug[] = [
  "what-is-a-telegram-bot",
  "how-to-make-a-telegram-bot",
  "telegram-bot-without-coding",
  "choose-a-telegram-bot-builder",
  "telegram-shop-bot",
  "telegram-bot-cost",
];

/**
 * Use-case cards: each one is a real capability of the product with its own
 * guide, which is what makes the homepage a hub for those pages instead of a
 * single page trying to rank for all of them. Copy lives in `landing.useCases.<key>`;
 * the slug stays here because it must be identical in every language.
 */
const USE_CASES: { key: "shop" | "support" | "menu" | "broadcast" | "services" | "data"; icon: LucideIcon; slug: ArticleSlug }[] = [
  { key: "shop", icon: ShoppingBag, slug: "telegram-shop-bot" },
  { key: "support", icon: LifeBuoy, slug: "telegram-support-bot" },
  { key: "menu", icon: LayoutGrid, slug: "telegram-bot-menu-buttons" },
  { key: "broadcast", icon: Megaphone, slug: "telegram-bot-broadcast" },
  { key: "services", icon: CalendarCheck, slug: "what-is-a-telegram-bot" },
  { key: "data", icon: Database, slug: "telegram-bot-google-sheets" },
];
import { useIsMobileViewport } from "@/components/landing/use-is-mobile-viewport";
import { RevealItem, VIEWPORT_ONCE, revealContainer, revealItem } from "@/components/landing/motion";
import { PaletteButton } from "@/components/layout/palette-button";
import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

/**
 * CTA proof row. Intentionally empty: the numbers aren't wired to the API yet
 * and the banner must never ship invented figures. When real aggregates exist,
 * push `{ value, label }` entries in here (label from `useT("landing")`) and
 * the row renders itself.
 */
type LandingStat = { value: string; label: string };

const EASE_OUT = "ease-[cubic-bezier(0.32,0.72,0,1)]";

/** Pill CTA with the arrow nested in its own circle ("button-in-button"). */
function PillCTA({
  href,
  children,
  testId,
  onClick,
  size = "md",
}: {
  href: string;
  children: React.ReactNode;
  testId?: string;
  onClick?: () => void;
  size?: "md" | "lg";
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      data-testid={testId}
      className={`group inline-flex items-center gap-3 rounded-full bg-primary ps-6 pe-2 font-bold text-primary-foreground shadow-[0_12px_40px_-12px_hsl(var(--primary)/0.8)] transition-[transform,box-shadow] duration-500 ${EASE_OUT} hover:shadow-[0_16px_50px_-10px_hsl(var(--primary)/0.95)] active:scale-[0.98] ${
        size === "lg" ? "py-2.5 text-lg" : "py-2 text-base"
      }`}
    >
      {children}
      <span
        className={`flex items-center justify-center rounded-full bg-black/15 transition-transform duration-500 ${EASE_OUT} group-hover:translate-x-0.5 group-hover:scale-105 rtl:group-hover:-translate-x-0.5 ${
          size === "lg" ? "size-11" : "size-9"
        }`}
      >
        <ChevronRight className="size-4 rtl-flip" strokeWidth={2} />
      </span>
    </Link>
  );
}

function GhostCTA({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-foreground/[0.04] px-6 py-3.5 text-base font-semibold transition-[transform,background-color,border-color] duration-500 ${EASE_OUT} hover:border-primary/50 hover:bg-primary/10 active:scale-[0.98]`}
    >
      {children}
    </Link>
  );
}

export default function Landing() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const tr = useT("landing");
  const seo = useT("seo");
  const footerT = useT("footer");
  const { lang } = useLanguage();

  // Keeps the client-side title/description in step with the prerendered head
  // when the visitor switches language without a reload.
  useSEO({ title: seo.homeTitle, description: seo.homeDescription, route: "/" });

  const reduce = useReducedMotion();
  const isMobile = useIsMobileViewport();

  const heroContainer = revealContainer(reduce ? 0 : 0.09);
  const heroItem = revealItem(!!reduce);
  const sectionItem = revealItem(!!reduce);
  const staggerContainer = revealContainer(reduce || isMobile ? 0 : 0.08);

  const nf = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : lang === "ar" ? "ar-EG" : "en-US", { minimumIntegerDigits: 2 });

  const steps: { icon: LucideIcon; title: string; description: string }[] = [
    { icon: Bot, title: tr.step1Title, description: tr.step1Desc },
    { icon: Blocks, title: tr.step2Title, description: tr.step2Desc },
    { icon: Rocket, title: tr.step3Title, description: tr.step3Desc },
  ];

  // Bento: spans add up to 6 per row, so nothing can leave a hole in the grid.
  const features: {
    icon: LucideIcon;
    title: string;
    description: string;
    span: string;
    visual?: "plugins" | "analytics";
  }[] = [
    { icon: Blocks, title: tr.pluginMarketplace, description: tr.pluginMarketplaceDesc, span: "md:col-span-4", visual: "plugins" },
    { icon: Terminal, title: tr.advancedCommands, description: tr.advancedCommandsDesc, span: "md:col-span-2" },
    { icon: Zap, title: tr.instantDeploy, description: tr.instantDeployDesc, span: "md:col-span-2" },
    { icon: BarChart3, title: tr.analyticsDashboard, description: tr.analyticsDashboardDesc, span: "md:col-span-4", visual: "analytics" },
    { icon: Shield, title: tr.enterpriseSecurity, description: tr.enterpriseSecurityDesc, span: "md:col-span-3" },
    { icon: Bot, title: tr.multiBotManagement, description: tr.multiBotManagementDesc, span: "md:col-span-3" },
  ];

  const ctaPoints = [tr.ctaPointFree, tr.ctaPointNoCard, tr.ctaPointSupport];
  const stats: LandingStat[] = [];

  // IRFORGE_MY_PRODUCTS_SEO_PLANS_PROMPT Section C — the Telegram-vs-dedicated-app
  // angle gets its own section, not folded into the FAQ.
  const schoolPoints: { icon: LucideIcon; title: string; description: string }[] = [
    { icon: Smartphone, title: tr.schoolPoint1Title, description: tr.schoolPoint1Desc },
    { icon: ClipboardCheck, title: tr.schoolPoint2Title, description: tr.schoolPoint2Desc },
    { icon: MessageSquare, title: tr.schoolPoint3Title, description: tr.schoolPoint3Desc },
  ];

  const doors: { key: "bot" | "school"; href: string; icon: LucideIcon; title: string; desc: string }[] = [
    { key: "bot", href: "/dashboard", icon: Bot, title: tr.ctaBotTitle, desc: tr.ctaBotDesc },
    { key: "school", href: "/schools", icon: GraduationCap, title: tr.ctaSchoolTitle, desc: tr.ctaSchoolDesc },
  ];

  // A use-case cell: the first card is the big one, the rest are compact.
  const useCaseSpan = ["lg:col-span-4", "lg:col-span-2", "lg:col-span-2", "lg:col-span-4", "lg:col-span-3", "lg:col-span-3"];

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-background text-foreground">
      {/* ── Floating island nav ─────────────────────────────────────────── */}
      <header className="sticky top-3 z-50 px-3">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 rounded-full border border-border/70 bg-background/75 px-3 shadow-[0_10px_34px_-14px_hsl(var(--foreground)/0.3)] backdrop-blur-xl sm:px-4">
          <BrandLogo href={null} className="min-w-0 sm:gap-3" />
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* Public nav entry into the content hub. Root-relative: the router
                base already supplies the language prefix. */}
            <Button asChild variant="ghost" size="sm" className="hidden rounded-full sm:inline-flex">
              <Link href="/learn">{footerT.learnNav}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden rounded-full md:inline-flex">
              <Link href="/pricing">{seo.navPricing}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden rounded-full lg:inline-flex">
              <Link href="/school-management">{seo.navSchool}</Link>
            </Button>
            <PaletteButton className="rounded-full" />
            <ThemeToggleButton className="rounded-full" />

            <LanguageSwitcher />

            {isAuthLoading ? (
              <div className="h-8 w-[72px] animate-pulse rounded-full bg-muted" aria-hidden="true" />
            ) : user ? (
              <Button asChild size="sm" className="rounded-full">
                <Link href="/dashboard">{tr.dashboard}</Link>
              </Button>
            ) : (
              <Button asChild size="sm" className="rounded-full">
                <Link href="/login">{tr.signIn}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero: the forge ─────────────────────────────────────────────
            A steel-dark frame (dark in both themes), embers rising, and the
            product itself — a live builder + Telegram chat — as the visual.
            Hero text is capped at four elements: badge, headline, one
            sentence, CTAs. The two entry doors sit under it, in the frame. */}
        <section className="px-3 pt-3 sm:px-4" data-testid="entry-showcase">
          <div className="forge-dark dark relative isolate overflow-hidden rounded-[2rem] bg-background text-foreground ring-1 ring-white/10 md:rounded-[2.75rem]">
            <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
              <div className="absolute -top-40 start-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/25 blur-[120px] rtl:translate-x-1/2" />
              <div className="absolute -bottom-52 -end-24 size-[34rem] rounded-full bg-primary/15 blur-[110px]" />
              <div
                className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(hsl(var(--foreground)/0.045)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground)/0.045)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_50%_30%,black,transparent_72%)]"
              />
            </div>
            <Embers count={isMobile ? 12 : 30} className="-z-10" />

            <div className="container relative mx-auto grid items-center gap-16 px-5 pb-14 pt-16 sm:px-8 lg:grid-cols-[1.02fr_1fr] lg:gap-10 lg:pb-20 lg:pt-32">
              <motion.div variants={heroContainer} initial="hidden" animate="show" className="text-center lg:text-start">
                <RevealItem variants={heroItem}>
                  <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
                    <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                    {tr.heroBadge}
                  </span>
                </RevealItem>

                <RevealItem variants={heroItem}>
                  <h1 className="mt-7 text-[2.35rem] font-black leading-[1.25] sm:text-5xl lg:text-[3.4rem] lg:leading-[1.2]">
                    {tr.heroTitleLine1}{" "}
                    <span className="forge-sheen bg-gradient-to-r from-primary via-amber-300 to-primary bg-clip-text text-transparent">
                      {tr.heroTitleGradient}
                    </span>
                  </h1>
                </RevealItem>

                <RevealItem variants={heroItem}>
                  <p className="mx-auto mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg lg:mx-0">
                    {tr.taglineSub}
                  </p>
                </RevealItem>

                <RevealItem variants={heroItem}>
                  <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
                    <PillCTA href={user ? "/dashboard" : "/register"} size="lg">
                      {tr.startBuilding}
                    </PillCTA>
                    <GhostCTA href="/docs" testId="link-view-documentation">
                      <Terminal className="size-4" strokeWidth={1.8} />
                      {tr.viewDocs}
                    </GhostCTA>
                  </div>
                </RevealItem>
              </motion.div>

              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: reduce ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="pt-24 lg:pt-0"
              >
                <ForgeDemo />
              </motion.div>
            </div>

            {/* the two entry doors (bot builder / school system) */}
            <div className="relative border-t border-white/10 bg-black/20">
              <div className="container mx-auto px-5 py-8 sm:px-8">
                <p className="mb-4 text-sm font-medium text-muted-foreground">{tr.forge.doorsTitle}</p>
                <div className="grid gap-3 sm:grid-cols-2" data-testid="hero-entry-cards">
                  {doors.map(({ key, href, icon: Icon, title, desc }) => (
                    <Bezel key={key} spotlight className="rounded-[1.75rem]" innerClassName="rounded-[calc(1.75rem-0.375rem)]">
                      <Link
                        href={user ? href : "/login"}
                        onClick={() => setPostAuthTarget(href)}
                        data-testid={`hero-cta-${key}`}
                        className="group relative z-10 flex items-center gap-4 p-4 text-start sm:p-5"
                      >
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary transition-colors duration-500 group-hover:bg-primary group-hover:text-primary-foreground">
                          <Icon className="size-6" strokeWidth={1.6} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-lg font-extrabold leading-tight">{title}</span>
                          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{desc}</span>
                        </span>
                        <ArrowUpRight
                          className={`size-5 shrink-0 text-primary transition-transform duration-500 ${EASE_OUT} group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5`}
                          strokeWidth={1.8}
                        />
                      </Link>
                    </Bezel>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <CapabilityMarquee />

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <motion.div variants={staggerContainer} initial="hidden" whileInView="show" viewport={VIEWPORT_ONCE}>
              <RevealItem variants={sectionItem}>
                <div className="mb-14 max-w-2xl">
                  <h2 className="text-3xl font-black leading-snug md:text-5xl md:leading-snug">{tr.howItWorks}</h2>
                  <p className="mt-4 text-lg leading-8 text-muted-foreground">{tr.howItWorksSub}</p>
                </div>
              </RevealItem>

              {/* a descending staircase: each step sits lower than the last — progress, not three equal cards */}
              <div className="grid gap-5 md:grid-cols-3">
                {steps.map((step, i) => (
                  <RevealItem
                    key={step.title}
                    variants={sectionItem}
                    className={i === 1 ? "md:mt-12" : i === 2 ? "md:mt-24" : ""}
                  >
                    <Bezel spotlight innerClassName="overflow-hidden p-7">
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-3 end-4 select-none text-[7rem] font-black leading-none text-foreground/[0.05]"
                      >
                        {nf(i + 1)}
                      </span>
                      <span className="relative flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.8)]">
                        <step.icon className="size-6" strokeWidth={1.6} />
                      </span>
                      <h3 className="relative mt-6 text-xl font-bold">{step.title}</h3>
                      <p className="relative mt-2.5 text-[15px] leading-7 text-muted-foreground">{step.description}</p>
                    </Bezel>
                  </RevealItem>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── Use cases ───────────────────────────────────────────────────
            What people actually search for ("telegram shop bot", "support
            bot", "inline buttons", "broadcast"…) each get a card that links to
            the guide for it. Every card describes something the product does
            today — no capability is listed here that the admin panel lacks. */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <motion.div variants={staggerContainer} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.1 }}>
              <RevealItem variants={sectionItem}>
                <div className="mb-12 max-w-2xl">
                  <h2 className="text-3xl font-black leading-snug md:text-5xl md:leading-snug">{tr.useCasesTitle}</h2>
                  <p className="mt-4 text-lg leading-8 text-muted-foreground">{tr.useCasesSub}</p>
                </div>
              </RevealItem>

              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                {USE_CASES.map(({ key, icon: Icon, slug }, i) => (
                  <li key={key} className={`${useCaseSpan[i]} ${i === 0 ? "sm:col-span-2" : ""}`}>
                    {/* the <li> stays the direct child of the <ul>; RevealItem renders a div */}
                    <RevealItem variants={sectionItem} className="h-full">
                      <Link href={`/learn/${slug}`} className="group block h-full">
                        <Bezel
                          spotlight
                          className="h-full"
                          innerClassName={`flex h-full min-h-[11rem] flex-col overflow-hidden p-6 ${
                            i === 0 ? "forge-dark dark bg-gradient-to-br from-primary/30 via-card to-card text-foreground md:p-8" : ""
                          }`}
                        >
                          <span className="flex items-start justify-between">
                            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/12 text-primary transition-colors duration-500 group-hover:bg-primary group-hover:text-primary-foreground">
                              <Icon className="size-5" strokeWidth={1.6} />
                            </span>
                            <ArrowUpRight
                              className="size-5 text-muted-foreground transition-[transform,color] duration-500 group-hover:-translate-y-0.5 group-hover:text-primary rtl:-scale-x-100"
                              strokeWidth={1.6}
                            />
                          </span>
                          <h3 className={`mt-auto pt-8 font-bold ${i === 0 ? "text-2xl md:text-3xl" : "text-lg"}`}>{tr.useCases[key].title}</h3>
                          <p className="mt-2 text-sm leading-7 text-muted-foreground">{tr.useCases[key].desc}</p>
                        </Bezel>
                      </Link>
                    </RevealItem>
                  </li>
                ))}
              </ul>

              <RevealItem variants={sectionItem}>
                <p className="mt-8">
                  <Link href="/learn/what-is-a-telegram-bot" className="text-primary underline-offset-4 hover:underline">
                    {tr.useCasesMore}
                  </Link>
                </p>
              </RevealItem>
            </motion.div>
          </div>
        </section>

        {/* ── Features (bento) — a second steel panel mid-page, for rhythm ── */}
        <section className="px-3 py-6 sm:px-4 md:py-10">
          <div className="forge-dark dark relative isolate overflow-hidden rounded-[2rem] bg-background text-foreground ring-1 ring-white/10 md:rounded-[2.75rem]">
            <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
              <div className="absolute -top-48 -start-24 size-[34rem] rounded-full bg-primary/20 blur-[120px]" />
              <div className="absolute -bottom-48 -end-24 size-[30rem] rounded-full bg-primary/12 blur-[110px]" />
            </div>
            <Embers count={isMobile ? 6 : 14} className="-z-10" />
            <div className="container mx-auto px-5 py-20 sm:px-8 md:py-28">
              <motion.div variants={staggerContainer} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.1 }}>
                <RevealItem variants={sectionItem}>
                  <div className="mb-12 max-w-2xl">
                    <h2 className="text-3xl font-black leading-snug md:text-5xl md:leading-snug">{tr.engineeredForScale}</h2>
                    <p className="mt-4 text-lg leading-8 text-muted-foreground">{tr.engineeredSub}</p>
                  </div>
                </RevealItem>

                {/* rows size to their own content while cards still stretch to fill their row */}
                <div className="grid gap-4 md:grid-cols-6">
                  {features.map((feature) => (
                    <RevealItem key={feature.title} variants={sectionItem} className={`${feature.span} h-full`}>
                      <Bezel spotlight className="h-full" innerClassName="flex h-full flex-col p-6 md:p-7">
                        <div className="flex items-center gap-3">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                            <feature.icon className="size-5" strokeWidth={1.6} />
                          </span>
                          <h3 className="text-lg font-bold">{feature.title}</h3>
                        </div>
                        <p className="mt-3 text-sm leading-7 text-muted-foreground">{feature.description}</p>
                        {feature.visual === "plugins" && (
                          <div className="mt-5">
                            <PluginRail />
                          </div>
                        )}
                        {feature.visual === "analytics" && (
                          <div className="mt-5">
                            <MiniAnalyticsChart />
                          </div>
                        )}
                      </Bezel>
                    </RevealItem>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── School management ───────────────────────────────────────────
            IRFORGE_MY_PRODUCTS_SEO_PLANS_PROMPT Section C. Every competitor
            surveyed for this section sells "the most complete school
            software" — none mentions Telegram. Parents already carry
            Telegram, so a school bot is zero install friction; that's the
            whole section. The phone shows what a parent really receives. */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={VIEWPORT_ONCE}
              className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20"
            >
              <div>
                <RevealItem variants={sectionItem}>
                  <h2 className="max-w-xl text-3xl font-black leading-snug md:text-5xl md:leading-snug">{tr.schoolSectionTitle}</h2>
                  <p className="mt-4 max-w-xl text-lg leading-8 text-muted-foreground">{tr.schoolSectionSubtitle}</p>
                </RevealItem>

                <ul className="mt-10 divide-y divide-border/70">
                  {schoolPoints.map((point) => (
                    <li key={point.title}>
                      <RevealItem variants={sectionItem}>
                        <div className="flex gap-4 py-6">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                            <point.icon className="size-5" strokeWidth={1.6} />
                          </span>
                          <div className="min-w-0">
                            <h3 className="text-lg font-bold">{point.title}</h3>
                            <p className="mt-1.5 text-[15px] leading-7 text-muted-foreground">{point.description}</p>
                          </div>
                        </div>
                      </RevealItem>
                    </li>
                  ))}
                </ul>

                <RevealItem variants={sectionItem}>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <PillCTA href={user ? "/dashboard" : "/register"}>{tr.schoolCta}</PillCTA>
                    <Link href="/school-management" className="text-sm font-semibold text-primary hover:underline">
                      {seo.navSchool}
                    </Link>
                  </div>
                </RevealItem>
              </div>

              <RevealItem variants={sectionItem}>
                <SchoolPhone />
              </RevealItem>
            </motion.div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────
            Also the source of the FAQPage schema on this page. */}
        <FaqSection reduce={!!reduce} stagger={reduce || isMobile ? 0 : 0.08} />

        {/* ── CTA: back to the forge ──────────────────────────────────────── */}
        <section className="px-3 py-6 sm:px-4 md:py-10">
          <div className="forge-dark dark relative isolate overflow-hidden rounded-[2rem] bg-background text-foreground ring-1 ring-white/10 md:rounded-[2.75rem]">
            <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
              <div className="absolute -bottom-40 start-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-primary/30 blur-[120px] rtl:translate-x-1/2" />
            </div>
            <Embers count={isMobile ? 10 : 22} className="-z-10" />

            <div className="container relative mx-auto px-5 py-20 text-center sm:px-8 md:py-28">
              <h2 className="mx-auto max-w-3xl text-4xl font-black leading-snug md:text-6xl md:leading-snug">{tr.readyToForge}</h2>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-muted-foreground">{tr.readyToForgeSub}</p>

              {/* real aggregates only — renders nothing while `stats` is empty */}
              {stats.length > 0 && (
                <dl className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-6 sm:grid-cols-3">
                  {stats.map((stat) => (
                    <div key={stat.label}>
                      <dt className="text-3xl font-extrabold text-primary">{stat.value}</dt>
                      <dd className="mt-1 text-sm text-muted-foreground">{stat.label}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
                {ctaPoints.map((point) => (
                  <li key={point} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-primary" strokeWidth={2} />
                    {point}
                  </li>
                ))}
              </ul>

              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <PillCTA href={user ? "/dashboard" : "/register"} size="lg">
                  {tr.createFreeAccount}
                </PillCTA>
                <GhostCTA href="/docs">{tr.viewDocs}</GhostCTA>
              </div>
            </div>
          </div>
        </section>

        {/* ── Latest guides ────────────────────────────────────────────────
            A real entry point into /learn from the highest-authority page,
            using the articles' own titles rather than generic link text. */}
        <section className="py-16 md:py-20">
          <div className="container mx-auto px-4">
            <div className="mb-8 max-w-2xl">
              <h2 className="text-3xl font-black leading-snug md:text-4xl md:leading-snug">{tr.guidesTitle}</h2>
              <p className="mt-3 text-lg text-muted-foreground">{tr.guidesSub}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {FEATURED_GUIDES.map((slug) => {
                const content = articleFor(lang, slug);
                if (!content) return null;
                return (
                  <li key={slug}>
                    <Link href={`/learn/${slug}`} className="block h-full">
                      <Bezel spotlight className="h-full rounded-[1.5rem]" innerClassName="rounded-[calc(1.5rem-0.375rem)] p-5">
                        <h3 className="font-bold">{content.h1}</h3>
                        <p className="mt-1.5 line-clamp-2 text-sm leading-7 text-muted-foreground">{content.lead}</p>
                      </Bezel>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/learn">{footerT.learnNav}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
