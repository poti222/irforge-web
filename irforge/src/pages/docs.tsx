import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Terminal,
  LayoutDashboard,
  Bot,
  Users,
  BarChart3,
  Settings,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandHomeButton } from "@/components/layout/brand-home";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

// ─── Sanitized example snippets ──────────────────────────────────────────
// These are illustrative only — no real tokens, IDs, or internal endpoints.
// Swap YOUR_BOT_TOKEN / placeholders with your own values from the dashboard.

const QUICK_START = `import { createBot } from "@irforge/sdk";

const bot = createBot({
  token: process.env.BOT_TOKEN, // never hardcode this
});

bot.command("start", async (ctx) => {
  await ctx.reply("Welcome! Your bot is alive 🤖");
});

bot.launch();`;

const COMMAND_WITH_ARGS = `bot.command("price", async (ctx) => {
  const [symbol] = ctx.args; // e.g. /price BTC
  const data = await getQuote(symbol);
  await ctx.reply(\`\${symbol}: $\${data.price}\`);
});`;

const PLUGIN_EXAMPLE = `// Plugins hook into the bot lifecycle.
export default definePlugin({
  name: "welcome-message",
  onUserJoin: async (ctx) => {
    await ctx.reply(\`Hey \${ctx.user.firstName}, glad you're here!\`);
  },
});`;

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/40">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-muted-foreground hover:text-primary transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <pre className="p-4 text-sm overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: "easeOut" as const },
  }),
};

export default function Docs() {
  const t = useT("common");
  useSEO({
    title: "مستندات IrForge | راهنمای ساخت ربات تلگرام با SDK",
    description:
      "مستندات کامل IrForge برای ساخت ربات تلگرام: شروع سریع، تعریف دستورات با آرگومان، نوشتن پلاگین و آشنایی با پنل مدیریت.",
  });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <BrandHomeButton />
            <div className="flex flex-col leading-none min-w-0">
              <span className="font-extrabold text-lg tracking-tight truncate">{t.docsPageTitle}</span>
              <span className="hidden sm:block text-[9px] text-primary font-semibold tracking-widest uppercase opacity-80">
                IrForge Platform
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" asChild>
            <Link href="/" data-testid="link-back-home" aria-label={t.backToHome}>
              <ArrowLeft className="sm:me-2 size-4 rtl-flip" />
              <span className="hidden sm:inline">{t.backToHome}</span>
            </Link>
          </Button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" as const }}
        className="container mx-auto px-4 py-12 max-w-5xl space-y-14"
      >
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
          <Badge variant="secondary" className="mb-4">{t.gettingStartedBadge}</Badge>
          <h1 className="text-4xl font-extrabold tracking-tight mb-3">
            {t.buildFirstBotTitle}
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            {t.buildFirstBotDesc}
          </p>
        </motion.div>

        {/* Quick start */}
        <motion.section variants={fadeUp} initial="hidden" animate="show" custom={1} className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Terminal className="size-5 text-primary" /> {t.quickStartTitle}
          </h2>
          <CodeBlock code={QUICK_START} label="bot.ts" />
        </motion.section>

        {/* Commands */}
        <motion.section variants={fadeUp} initial="hidden" animate="show" custom={2} className="space-y-4">
          <h2 className="text-xl font-bold">{t.commandsWithArgsTitle}</h2>
          <CodeBlock code={COMMAND_WITH_ARGS} label="commands/price.ts" />
        </motion.section>

        {/* Plugins */}
        <motion.section variants={fadeUp} initial="hidden" animate="show" custom={3} className="space-y-4">
          <h2 className="text-xl font-bold">{t.writingPluginTitle}</h2>
          <CodeBlock code={PLUGIN_EXAMPLE} label="plugins/welcome-message.ts" />
        </motion.section>

        {/* Panel preview */}
        <motion.section variants={fadeUp} initial="hidden" animate="show" custom={4} className="space-y-4">
          <h2 className="text-xl font-bold">{t.panelPreviewTitle}</h2>
          <p className="text-muted-foreground">
            {t.panelPreviewDesc}
          </p>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, ease: "easeOut" as const }}
            className="rounded-xl border bg-card shadow-xl overflow-hidden"
          >
            <div className="flex h-9 items-center gap-1.5 border-b bg-muted/40 px-3">
              <span className="size-2.5 rounded-full bg-red-400/70" />
              <span className="size-2.5 rounded-full bg-yellow-400/70" />
              <span className="size-2.5 rounded-full bg-green-400/70" />
              <span className="ms-3 text-xs text-muted-foreground">dashboard.irforge.app</span>
            </div>
            <div className="flex">
              {/* fake sidebar */}
              <div className="hidden sm:flex w-48 flex-col gap-1 border-r p-3 bg-muted/20">
                {[
                  { icon: LayoutDashboard, label: t.dashboard, active: true },
                  { icon: Bot, label: t.myBots },
                  { icon: Users, label: t.docsNavUsers },
                  { icon: BarChart3, label: t.docsNavAnalytics },
                  { icon: Settings, label: t.docsNavSettings },
                ].map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                      item.active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </motion.div>
                ))}
              </div>
              {/* fake content */}
              <div className="flex-1 p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: t.statActiveBots, value: "3" },
                  { label: t.statTotalUsers, value: "12.4K" },
                  { label: t.statMessagesPerDay, value: "48.2K" },
                ].map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + i * 0.08 }}
                  >
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground">
                          {stat.label}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-2xl font-bold">{stat.value}</span>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.section>

        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={5} className="text-center pt-6">
          <Button size="lg" className="h-12 px-10" asChild>
            <Link href="/register">{t.startBuildingNow}</Link>
          </Button>
        </motion.div>
      </motion.main>
    </div>
  );
}
