import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LayoutDashboard, IdCard, Terminal, Blocks, Activity, Settings, type LucideIcon } from "lucide-react";
import type { Bot } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useMotionDirection } from "@/hooks/use-motion-direction";
import { SidebarBrandHeader } from "@/components/layout/brand-home";
import { CommandsEditor } from "@/components/bots/CommandsEditor";
import { PluginsManager } from "@/components/bots/PluginsManager";
import { BotStatsPanel } from "@/components/bots/BotStatsPanel";
import { BotSettingsForm } from "@/components/bots/BotSettingsForm";
import { BotProfileForm } from "@/components/bots/BotProfileForm";
import type { LocaleShape } from "@/hooks/use-translation";

type SectionKey = "overview" | "profile" | "commands" | "plugins" | "stats" | "settings";

const SECTION_META: { key: SectionKey; icon: LucideIcon; labelKey: keyof LocaleShape["botWorkspace"] }[] = [
  { key: "overview", icon: LayoutDashboard, labelKey: "sectionOverview" },
  { key: "profile", icon: IdCard, labelKey: "sectionProfile" },
  { key: "commands", icon: Terminal, labelKey: "sectionCommands" },
  { key: "plugins", icon: Blocks, labelKey: "sectionPlugins" },
  { key: "stats", icon: Activity, labelKey: "sectionStats" },
  { key: "settings", icon: Settings, labelKey: "sectionSettings" },
];

/**
 * Q5: the bot workspace as a single "document" shell — a narrow sidebar for
 * jumping between sections and a main area that hosts each section's real
 * interactive content (Q1's command table + its live preview, Q2's plugin list,
 * Q3's stat cards, Q4's settings form). Sections cross-fade via AnimatePresence
 * (also satisfies W6/Y1), and the direction-aware slide respects RTL. The
 * Commands section carries the live, data-derived preview panel required by Q5.
 */
export function BotWorkspaceDocument({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("botWorkspace");
  const reduce = useReducedMotion();
  const dir = useMotionDirection();
  const [section, setSection] = useState<SectionKey>("overview");

  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(fa ? "fa-IR" : "en-US");

  const anim = reduce
    ? {}
    : {
        initial: { opacity: 0, x: dir * 12 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: dir * -12 },
        transition: { type: "spring" as const, duration: 0.25, bounce: 0.1 },
      };

  return (
    <div className="flex flex-1 flex-col gap-4 min-h-0 md:flex-row">
      {/* Sidebar section nav — vertical on md+, horizontal scroll on mobile.
          On md+ it carries the same brand header band as the app sidebar so
          every sidebar surface in the product reads as the same component.
          The header is hidden on mobile, where the nav collapses to a single
          horizontal strip of chips and a 64px logo band would just eat space. */}
      <nav className="flex shrink-0 flex-col md:w-52">
        <SidebarBrandHeader className="hidden md:flex mb-2" size="sm" />
        <div className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
          {SECTION_META.map((s) => {
            const active = section === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors md:w-full ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span>{t[s.labelKey]}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main area */}
      <div className="flex-1 min-w-0 overflow-auto rounded-md border bg-card p-4">
        <AnimatePresence mode="wait">
          <motion.div key={section} {...anim}>
            {section === "overview" && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t.overviewTotalUsers}</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{nf(bot.userCount)}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t.overviewMessages}</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{nf(bot.messageCount)}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t.overviewCommands}</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{nf(bot.commandCount)}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t.overviewPlugins}</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold">{nf(bot.pluginCount)}</div></CardContent>
                </Card>
              </div>
            )}
            {section === "profile" && <BotProfileForm bot={bot} />}
            {section === "commands" && <CommandsEditor botId={bot.id} />}
            {section === "plugins" && <PluginsManager botId={bot.id} />}
            {section === "stats" && <BotStatsPanel botId={bot.id} status={bot.status} />}
            {section === "settings" && <BotSettingsForm bot={bot} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
