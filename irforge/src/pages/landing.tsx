import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Terminal, Blocks, Zap, ChevronRight, Github, Shield, BarChart3, Bot } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OrangeRobot } from "@/components/layout/brand-home";
import { HeroRobot } from "@/components/landing/HeroRobot";
import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useT } from "@/hooks/use-translation";

export default function Landing() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const tr = useT("landing");

  const reduce = useReducedMotion();

  // W8: one-time staggered hero entrance (plays on mount, not on scroll).
  const heroContainer = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.1 } } };
  const heroItem = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.28 } } };

  const features = [
    { icon: Terminal, title: tr.advancedCommands, description: tr.advancedCommandsDesc },
    { icon: Blocks, title: tr.pluginMarketplace, description: tr.pluginMarketplaceDesc },
    { icon: Zap, title: tr.instantDeploy, description: tr.instantDeployDesc },
    { icon: Shield, title: tr.enterpriseSecurity, description: tr.enterpriseSecurityDesc },
    { icon: BarChart3, title: tr.analyticsDashboard, description: tr.analyticsDashboardDesc },
    { icon: Bot, title: tr.multiBotManagement, description: tr.multiBotManagementDesc },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex aspect-square size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <OrangeRobot className="size-6 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-none min-w-0">
              <span className="font-extrabold text-lg tracking-tight text-foreground truncate">IrForge</span>
              <span className="hidden sm:block text-[9px] text-primary font-semibold tracking-widest uppercase opacity-80">Bot Platform</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
        {/* Hero Section */}
        <section className="py-20 md:py-32 border-b relative overflow-hidden">
          {/* Orange glow background only - not touching the flag */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute top-20 right-1/4 w-[300px] h-[300px] bg-primary/5 rounded-full blur-2xl" />
          </div>

          <motion.div
            className="container mx-auto px-4 relative z-10 text-center max-w-5xl"
            variants={heroContainer}
            initial="hidden"
            animate="show"
          >
            {/* W9: animated orange-robot mascot (replaces the former static flag image) */}
            <motion.div variants={heroItem} className="flex justify-center mb-8">
              <HeroRobot className="w-64 md:w-80 text-primary drop-shadow-2xl" />
            </motion.div>

            <motion.div variants={heroItem} className="inline-flex items-center gap-2 rounded-full border border-primary/30 px-3 py-1 text-xs font-semibold bg-primary/10 text-primary mb-6">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              {tr.heroBadge}
            </motion.div>

            <motion.h1 variants={heroItem} className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight">
              {tr.heroTitleLine1}
              <br className="hidden md:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-orange-400 to-amber-400">
                {" "}{tr.heroTitleGradient}
              </span>
            </motion.h1>
            <motion.p variants={heroItem} className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              {tr.taglineSub}
            </motion.p>

            <div className="flex items-center justify-center mb-10">
              <img
                src="/lion-sun-flag.png"
                alt="پرچم شیر و خورشید"
                className="h-16 md:h-20 w-auto rounded-md shadow-md ring-1 ring-black/10"
              />
            </div>

            <motion.div variants={heroItem} className="flex flex-col sm:flex-row justify-center gap-4">
              <Button size="lg" className="h-12 px-8 text-base font-semibold" asChild>
                <Link href={user ? "/dashboard" : "/register"}>
                  {tr.startBuilding} <ChevronRight className="ms-2 size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-8 text-base border-primary/30 hover:border-primary hover:text-primary" asChild>
                <Link href="/docs" data-testid="link-view-documentation">
                  <Terminal className="me-2 size-4" />
                  {tr.viewDocs}
                </Link>
              </Button>
            </motion.div>
          </motion.div>
        </section>

        {/* Features Section */}
        {/* W5: scroll-reveal — fades+slides into place once, doesn't re-trigger on scroll-back-up */}
        <motion.section
          className="py-24 bg-card/30"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.32 }}
        >
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight mb-4">{tr.engineeredForScale}</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                {tr.engineeredSub}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {features.map((feature, i) => (
                <div key={i} className="bg-card p-6 rounded-xl border border-border hover:border-primary/40 transition-colors shadow-sm flex flex-col items-center text-center group">
                  <div className="p-3 bg-primary/10 rounded-lg mb-4 text-primary group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="size-6" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* CTA Banner — W5 scroll-reveal */}
        <motion.section
          className="py-20 border-t relative overflow-hidden"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.32 }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 pointer-events-none" />
          <div className="container mx-auto px-4 text-center relative z-10">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
              {tr.readyToForge}
            </h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              {tr.readyToForgeSub}
            </p>
            <Button size="lg" className="h-12 px-10 text-base font-bold" asChild>
              <Link href={user ? "/dashboard" : "/register"}>
                {tr.createFreeAccount} <ChevronRight className="ms-2 size-4" />
              </Link>
            </Button>
          </div>
        </motion.section>
      </main>

      <footer className="border-t py-10 bg-card/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <OrangeRobot className="size-5 text-primary-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-bold text-foreground">IrForge Platform</span>
                <img
                  src="/lion-sun-flag.png"
                  alt="پرچم شیر و خورشید"
                  className="h-3.5 w-auto rounded-sm"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} IrForge. {tr.madeWith}
            </p>
            <div className="flex gap-4">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors" aria-label="گیت‌هاب IrForge">
                <Github className="size-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
