import { useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
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
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BrandLogo } from "@/components/layout/brand-home";
import { HeroRobot } from "@/components/landing/HeroRobot";
import { BotChatMockup } from "@/components/landing/BotChatMockup";
import { MiniAnalyticsChart } from "@/components/landing/MiniAnalyticsChart";
import { PluginRail } from "@/components/landing/PluginRail";
import { FaqSection } from "@/components/landing/FaqSection";
import { LandingPlans } from "@/components/landing/LandingPlans";
import { PublicFooter } from "@/components/layout/public-footer";
import { useLanguage } from "@/hooks/use-language";
import { articleFor, type ArticleSlug } from "@/lib/learn-content";

/** The four guides worth surfacing on the homepage, highest intent first. */
const FEATURED_GUIDES: ArticleSlug[] = [
  "how-to-make-a-telegram-bot",
  "telegram-bot-token",
  "telegram-shop-bot",
  "telegram-bot-cost",
];
import { useIsMobileViewport } from "@/components/landing/use-is-mobile-viewport";
import { RevealItem, VIEWPORT_ONCE, revealContainer, revealItem } from "@/components/landing/motion";
import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { useMotionDirection } from "@/hooks/use-motion-direction";

/**
 * CTA proof row. Intentionally empty: the numbers aren't wired to the API yet
 * and the banner must never ship invented figures. When real aggregates exist,
 * push `{ value, label }` entries in here (label from `useT("landing")`) and
 * the row renders itself.
 */
type LandingStat = { value: string; label: string };

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
  const dirSign = useMotionDirection(); // +1 in LTR, -1 in RTL

  // Scroll-linked motion and ambient loops are desktop-only, and always off
  // under prefers-reduced-motion. Mobile gets mount/in-view fades only.
  const richMotion = !isMobile && !reduce;

  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  // The mascot drifts outward (direction-aware), shrinks and fades as the hero
  // scrolls away, so it's gone by the time "how it works" is in view.
  // +direction = outward past the mockup's end edge, where the mascot sits, in
  // both LTR and RTL
  const robotX = useTransform(scrollYProgress, [0, 1], [0, 90 * dirSign]);
  const robotScale = useTransform(scrollYProgress, [0, 1], [1, 0.55]);
  // Drop the compositor hint once the hero is fully scrolled past. A motion
  // value, not state, so it costs no re-render.
  const robotWillChange = useTransform(scrollYProgress, (v) =>
    v >= 0.999 ? "auto" : "transform, opacity"
  );

  // Style object kept referentially stable: handing framer a fresh object on
  // every re-render (auth resolving, language flips…) makes it re-seed values
  // from the new object instead of tracking the bound motion values.
  const robotStyle = useMemo(
    () => (richMotion ? { x: robotX, scale: robotScale, willChange: robotWillChange } : undefined),
    [richMotion, robotX, robotScale, robotWillChange]
  );

  // Opacity is written straight to the node rather than through `style`: with a
  // motion value in the same style object as the transforms it renders once and
  // then stops tracking. This runs inside framer's own scroll frame loop — no
  // extra scroll listener — and only ever touches a compositor-only property.
  const robotRef = useRef<HTMLDivElement>(null);
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const node = robotRef.current;
    if (!node || !richMotion) return;
    node.style.opacity = String(Math.max(0, Math.min(1, 1 - p / 0.7)));
  });
  useEffect(() => {
    // mobile / reduced motion: make sure no stale fade is left behind
    if (!richMotion && robotRef.current) robotRef.current.style.opacity = "";
  }, [richMotion]);

  const heroContainer = revealContainer(reduce ? 0 : 0.09);
  const heroItem = revealItem(!!reduce);
  const sectionItem = revealItem(!!reduce);
  const staggerContainer = revealContainer(reduce || isMobile ? 0 : 0.08);

  const steps: { icon: LucideIcon; title: string; description: string }[] = [
    { icon: Bot, title: tr.step1Title, description: tr.step1Desc },
    { icon: Blocks, title: tr.step2Title, description: tr.step2Desc },
    { icon: Rocket, title: tr.step3Title, description: tr.step3Desc },
  ];

  // Bento: two oversized tiles carry a real mini-visual, the rest stay compact.
  // Spans add up to 6 per row, so no row-span tricks are needed and nothing can
  // leave a hole in the grid.
  const features: {
    icon: LucideIcon;
    title: string;
    description: string;
    span: string;
    visual?: "plugins" | "analytics";
  }[] = [
    {
      icon: Blocks,
      title: tr.pluginMarketplace,
      description: tr.pluginMarketplaceDesc,
      span: "md:col-span-4",
      visual: "plugins",
    },
    { icon: Terminal, title: tr.advancedCommands, description: tr.advancedCommandsDesc, span: "md:col-span-2" },
    { icon: Zap, title: tr.instantDeploy, description: tr.instantDeployDesc, span: "md:col-span-2" },
    {
      icon: BarChart3,
      title: tr.analyticsDashboard,
      description: tr.analyticsDashboardDesc,
      span: "md:col-span-4",
      visual: "analytics",
    },
    { icon: Shield, title: tr.enterpriseSecurity, description: tr.enterpriseSecurityDesc, span: "md:col-span-3" },
    { icon: Bot, title: tr.multiBotManagement, description: tr.multiBotManagementDesc, span: "md:col-span-3" },
  ];

  const ctaPoints = [tr.ctaPointFree, tr.ctaPointNoCard, tr.ctaPointSupport];
  const stats: LandingStat[] = [];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-2">
          <BrandLogo href={null} className="sm:gap-3 min-w-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Public nav entry into the content hub. Root-relative: the router
                base already supplies the language prefix. */}
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/learn">{footerT.learnNav}</Link>
            </Button>
            <ThemeToggleButton className="rounded-full" />

            <LanguageSwitcher />

            {isAuthLoading ? (
              <div className="h-8 w-[72px] rounded-md bg-muted animate-pulse" aria-hidden="true" />
            ) : user ? (
              <Button asChild size="sm">
                <Link href="/dashboard">{tr.dashboard}</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href="/login">{tr.signIn}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────────
            overflow-x-hidden is load-bearing: the mascot translates along x
            and must never open a horizontal scrollbar. Height uses dvh so the
            mobile URL bar collapsing doesn't make the section jump. */}
        <section
          ref={heroRef}
          className="relative overflow-hidden border-b md:min-h-[calc(100dvh-4rem)] md:flex md:items-center"
        >
          <HeroBackdrop animate={richMotion} />

          <div className="container relative z-10 mx-auto w-full px-4 py-16 md:py-24">
            <div className="grid items-center gap-14 md:grid-cols-2 md:gap-10">
              {/* copy column — one-shot staggered entrance on mount */}
              <motion.div
                className="text-center md:text-start"
                variants={heroContainer}
                initial="hidden"
                animate="show"
              >
                <RevealItem variants={heroItem}>
                  <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    <span className="size-1.5 rounded-full bg-primary" />
                    {tr.heroBadge}
                  </span>
                </RevealItem>

                <RevealItem variants={heroItem}>
                  <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                    {tr.heroTitleLine1}{" "}
                    <span className="bg-gradient-to-r from-primary via-orange-400 to-amber-400 bg-clip-text text-transparent">
                      {tr.heroTitleGradient}
                    </span>
                  </h1>
                </RevealItem>

                <RevealItem variants={heroItem}>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg md:mx-0 mx-auto">
                    {tr.taglineSub}
                  </p>
                </RevealItem>

                <RevealItem variants={heroItem}>
                  {/* flex-wrap matters: Turkish/Russian labels are ~50% wider
                      than English and would otherwise push the second button
                      out of its grid column and under the mockup */}
                  <div className="mt-8 flex flex-col flex-wrap gap-3 sm:flex-row sm:justify-center md:justify-start">
                    <Button size="lg" className="h-12 px-8 text-base font-semibold" asChild>
                      <Link href={user ? "/dashboard" : "/register"}>
                        {tr.startBuilding} <ChevronRight className="ms-2 size-4 rtl-flip" />
                      </Link>
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-12 px-8 text-base border-primary/30 hover:border-primary hover:text-primary"
                      asChild
                    >
                      <Link href="/docs" data-testid="link-view-documentation">
                        <Terminal className="me-2 size-4" />
                        {tr.viewDocs}
                      </Link>
                    </Button>
                  </div>
                </RevealItem>
              </motion.div>

              {/* Product column: chat mockup with the mascot peeking over it.
                  Deliberately OUTSIDE the variant-driven copy column — a
                  variant label propagating down here would re-assert opacity on
                  the mascot and fight the scroll-linked motion values. */}
              <div className="relative">
                <div className="relative mx-auto w-full max-w-md md:max-w-none">
                  <motion.div
                    ref={robotRef}
                    className="absolute -top-12 -end-3 z-20 w-24 sm:-top-14 sm:w-28 md:-top-20 md:w-32"
                    style={robotStyle}
                  >
                    <HeroRobot className="w-full text-primary drop-shadow-xl" />
                  </motion.div>

                  <motion.div
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0.3 : 0.5, delay: reduce ? 0 : 0.2, ease: "easeOut" }}
                  >
                    <BotChatMockup />
                  </motion.div>

                  {/* Deploy status chip on the window's outer bottom corner —
                      the inner corner points at the copy column and would
                      collide with the CTA buttons on md screens. */}
                  <div className="absolute -bottom-4 -end-2 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-lg sm:-end-4">
                    <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="size-2.5" />
                    </span>
                    {tr.deployedBadge}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section className="border-b py-20 md:py-24">
          <div className="container mx-auto px-4">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={VIEWPORT_ONCE}
            >
              <RevealItem variants={sectionItem}>
                <div className="mx-auto mb-14 max-w-2xl text-center">
                  <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{tr.howItWorks}</h2>
                  <p className="mt-3 text-muted-foreground">{tr.howItWorksSub}</p>
                </div>
              </RevealItem>

              <div className="relative mx-auto grid max-w-5xl gap-8 md:grid-cols-3 md:gap-6">
                {/* connector line, desktop only, purely decorative */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-[16%] top-7 hidden h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent md:block"
                />
                {steps.map((step, i) => (
                  <RevealItem key={step.title} variants={sectionItem} className="relative">
                    <div className="flex flex-col items-center text-center">
                      <span className="relative z-10 flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-card text-primary shadow-sm">
                        <step.icon className="size-6" />
                        <span className="absolute -top-2 -end-2 flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                          {i + 1}
                        </span>
                      </span>
                      <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                        {step.description}
                      </p>
                    </div>
                  </RevealItem>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── Features (bento) ────────────────────────────────────────────── */}
        <section className="bg-card/30 py-20 md:py-24">
          <div className="container mx-auto px-4">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.1 }}
            >
              <RevealItem variants={sectionItem}>
                <div className="mx-auto mb-14 max-w-2xl text-center">
                  <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{tr.engineeredForScale}</h2>
                  <p className="mt-3 text-muted-foreground">{tr.engineeredSub}</p>
                </div>
              </RevealItem>

              {/* rows size to their own content (no auto-rows-fr — that would
                  pad the short tiles out to the tallest row) while cards still
                  stretch to fill their row */}
              <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-6">
                {features.map((feature) => (
                  <RevealItem key={feature.title} variants={sectionItem} className={`${feature.span} h-full`}>
                    <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-colors hover:border-primary/40">
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                          <feature.icon className="size-5" />
                        </span>
                        <h3 className="text-lg font-semibold">{feature.title}</h3>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
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
                    </div>
                  </RevealItem>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── Plans ───────────────────────────────────────────────────────
            بعد از «چه چیزی می‌گیری» و قبل از سؤال‌های متداول: کسی که تا اینجا
            آمده، سؤال بعدی‌اش قیمت است. */}
        <LandingPlans reduce={!!reduce} />

        {/* ── FAQ ─────────────────────────────────────────────────────────
            Also the source of the FAQPage schema on this page. */}
        <FaqSection reduce={!!reduce} stagger={reduce || isMobile ? 0 : 0.08} />

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <motion.section
          className="relative overflow-hidden border-t py-20"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.32 }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5" />
          <div className="container relative z-10 mx-auto px-4 text-center">
            <h2 className="text-3xl font-extrabold md:text-4xl">{tr.readyToForge}</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{tr.readyToForgeSub}</p>

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
                  <Check className="size-4 shrink-0 text-primary" />
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="h-12 px-10 text-base font-bold" asChild>
                <Link href={user ? "/dashboard" : "/register"}>
                  {tr.createFreeAccount} <ChevronRight className="ms-2 size-4 rtl-flip" />
                </Link>
              </Button>
              <Button size="lg" variant="ghost" className="h-12 px-6 text-base" asChild>
                <Link href="/docs">{tr.viewDocs}</Link>
              </Button>
            </div>
          </div>
        </motion.section>

        {/* ── Latest guides ────────────────────────────────────────────────
            A real entry point into /learn from the highest-authority page,
            using the articles' own titles rather than generic link text. */}
        <section className="border-t py-16 md:py-20">
          <div className="container mx-auto px-4">
            <div className="mx-auto mb-8 max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{footerT.learnTitle}</h2>
            </div>
            <ul className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
              {FEATURED_GUIDES.map((slug) => {
                const content = articleFor(lang, slug);
                if (!content) return null;
                return (
                  <li key={slug}>
                    <Link href={`/learn/${slug}`} className="block h-full">
                      <div className="h-full rounded-xl border bg-card p-5 transition-colors hover:border-primary/50">
                        <h3 className="font-semibold">{content.h1}</h3>
                        <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{content.lead}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 text-center">
              <Button asChild variant="outline">
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

/**
 * Hero backdrop: orange glow blobs plus the lion-and-sun flag woven into the
 * background (masked + very low opacity) instead of sitting in the layout as a
 * separate photo. Blobs drift only when `animate` is true — i.e. desktop with
 * motion allowed — and only via transform.
 */
function HeroBackdrop({ animate }: { animate: boolean }) {
  const drift = (
    keyframes: { x: number[]; y: number[]; scale: number[] },
    duration: number
  ) =>
    animate
      ? {
          animate: keyframes,
          transition: { duration, repeat: Infinity, ease: "easeInOut" as const },
          style: { willChange: "transform" as const },
        }
      : {};

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.div
        className="absolute -top-24 left-1/2 size-[620px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        {...drift({ x: [0, 40, -30, 0], y: [0, -26, 18, 0], scale: [1, 1.06, 0.97, 1] }, 19)}
      />
      <motion.div
        className="absolute bottom-0 end-[10%] size-[320px] rounded-full bg-primary/5 blur-2xl"
        {...drift({ x: [0, -34, 22, 0], y: [0, 20, -16, 0], scale: [1, 0.95, 1.05, 1] }, 16)}
      />
      <picture className="contents">
        <source srcSet="/lion-sun-flag.webp" type="image/webp" />
        <img
          src="/lion-sun-flag.png"
          alt=""
          aria-hidden="true"
          width={560}
          height={336}
          loading="lazy"
          decoding="async"
          className="absolute -end-32 top-1/2 hidden w-[560px] -translate-y-1/2 select-none opacity-[0.07] md:block dark:opacity-[0.1] [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_68%)]"
        />
      </picture>
    </div>
  );
}
