import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation, useSearch } from "wouter";
import {
  LayoutDashboard,
  IdCard,
  Terminal,
  Blocks,
  Activity,
  Settings,
  Globe,
  Lock,
  LayoutPanelLeft,
  FileText,
  Users,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  Megaphone,
  LifeBuoy,
  Boxes,
  Share2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Bot } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useMotionDirection } from "@/hooks/use-motion-direction";
import { SidebarBrandHeader } from "@/components/layout/brand-home";
import { confirmDiscardUnsaved, setDiscardMessage } from "@/lib/unsaved-changes";
import { CommandsEditor } from "@/components/bots/CommandsEditor";
import { PluginsManager } from "@/components/bots/PluginsManager";
import { BotStatsPanel } from "@/components/bots/BotStatsPanel";
import { BotSettingsSection } from "@/components/bots/settings/BotSettingsSection";
import { BotProfileForm } from "@/components/bots/BotProfileForm";
import { BotIdentityCard } from "@/components/bots/BotIdentityCard";
import type { LocaleShape } from "@/hooks/use-translation";

type SectionKey =
  | "overview"
  | "profile"
  | "stats"
  | "panels"
  | "forms"
  | "commands"
  | "users"
  | "admins"
  | "orders"
  | "discounts"
  | "broadcast"
  | "tickets"
  | "objects"
  | "relations"
  | "workflows"
  | "plugins"
  | "language"
  | "settings";

type SectionMeta = {
  key: SectionKey;
  icon: LucideIcon;
  labelKey: keyof LocaleShape["botWorkspace"];
  /** Rendered but not selectable — the feature has no implementation yet.
   *  Each migration phase unlocks exactly its own section, nothing else. */
  locked?: boolean;
};

type SectionGroup = {
  key: string;
  labelKey: keyof LocaleShape["botWorkspace"];
  items: SectionMeta[];
};

/**
 * The workspace is deliberately split into small, separate sections instead of
 * one giant page: "build a panel" is not "bot settings" is not "forms". The
 * groups below mirror how a bot admin actually thinks about their bot.
 */
const SECTION_GROUPS: SectionGroup[] = [
  {
    key: "overview",
    labelKey: "groupOverview",
    items: [
      { key: "overview", icon: LayoutDashboard, labelKey: "sectionOverview" },
      { key: "profile", icon: IdCard, labelKey: "sectionProfile" },
      { key: "stats", icon: Activity, labelKey: "sectionStats" },
    ],
  },
  {
    key: "content",
    labelKey: "groupContent",
    items: [
      { key: "panels", icon: LayoutPanelLeft, labelKey: "sectionPanels", locked: true },
      { key: "forms", icon: FileText, labelKey: "sectionForms", locked: true },
      { key: "commands", icon: Terminal, labelKey: "sectionCommands" },
    ],
  },
  {
    key: "people",
    labelKey: "groupPeople",
    items: [
      { key: "users", icon: Users, labelKey: "sectionUsers", locked: true },
      { key: "admins", icon: ShieldCheck, labelKey: "sectionAdmins", locked: true },
    ],
  },
  {
    key: "sales",
    labelKey: "groupSales",
    items: [
      { key: "orders", icon: ShoppingCart, labelKey: "sectionOrders", locked: true },
      { key: "discounts", icon: Ticket, labelKey: "sectionDiscounts", locked: true },
    ],
  },
  {
    key: "comms",
    labelKey: "groupComms",
    items: [
      { key: "broadcast", icon: Megaphone, labelKey: "sectionBroadcast", locked: true },
      { key: "tickets", icon: LifeBuoy, labelKey: "sectionTickets", locked: true },
    ],
  },
  {
    key: "advanced",
    labelKey: "groupAdvanced",
    items: [
      { key: "objects", icon: Boxes, labelKey: "sectionObjects", locked: true },
      { key: "relations", icon: Share2, labelKey: "sectionRelations", locked: true },
      { key: "workflows", icon: Workflow, labelKey: "sectionWorkflows", locked: true },
      { key: "plugins", icon: Blocks, labelKey: "sectionPlugins" },
    ],
  },
  {
    key: "settings",
    labelKey: "groupSettings",
    items: [
      // The standalone /language page is gone; bot language belongs to the bot,
      // not to the account. Shown locked until the per-bot implementation lands.
      { key: "language", icon: Globe, labelKey: "sectionLanguage", locked: true },
      // The gear, always last in the list.
      { key: "settings", icon: Settings, labelKey: "sectionSettings" },
    ],
  },
];

const ALL_SECTIONS: SectionMeta[] = SECTION_GROUPS.flatMap((g) => g.items);

function findSection(key: string | null): SectionMeta | undefined {
  return ALL_SECTIONS.find((s) => s.key === key);
}

/**
 * Q5: the bot workspace as a single "document" shell — a narrow sidebar for
 * jumping between sections and a main area that hosts each section's real
 * interactive content. Sections cross-fade via AnimatePresence (also satisfies
 * W6/Y1), and the direction-aware slide respects RTL.
 *
 * The active section lives in the URL (`?section=panels`), not in component
 * state, so a section is bookmarkable, survives a refresh, and the browser's
 * back button walks between sections the way a user expects. An unknown or
 * locked value falls back to `overview` instead of rendering nothing.
 */
export function BotWorkspaceDocument({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("botWorkspace");
  const ts = useT("botSettings");
  const reduce = useReducedMotion();
  const dir = useMotionDirection();
  const [, navigate] = useLocation();
  const search = useSearch();

  // The registry lives outside React, so its message has to be pushed in from
  // somewhere that has the locale.
  setDiscardMessage(ts.unsavedLeaveWarning);

  const requested = new URLSearchParams(search).get("section");
  const match = findSection(requested);
  // A locked section is not a valid destination either — someone with a stale
  // bookmark from a future phase shouldn't land on a blank panel.
  const section: SectionKey = match && !match.locked ? match.key : "overview";

  function goTo(next: SectionKey) {
    // Leaving a section with an unsaved form throws the user's work away
    // silently — that's bug B1 on the bot side, and it must not repeat here.
    if (!confirmDiscardUnsaved()) return;
    const params = new URLSearchParams(search);
    params.set("section", next);
    // Tab state belongs to the section being left, not the one being entered.
    params.delete("tab");
    navigate(`/bots/${bot.id}?${params.toString()}`);
  }

  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(fa ? "fa-IR" : "en-US");

  const anim = reduce
    ? {}
    : {
        initial: { opacity: 0, x: dir * 12 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: dir * -12 },
        // A tween, not a spring. With `AnimatePresence mode="wait"` the new
        // section only mounts once the old one's exit *completes*, and the
        // duration+bounce spring here never reported completion — so clicking
        // a section left the panel permanently blank (old section stuck at
        // opacity 0, new one never mounted). Reproduced on the build before
        // this section was added, so it predates the Bot Language tab.
        transition: { duration: 0.2, ease: "easeOut" as const },
      };

  return (
    <div className="flex flex-1 flex-col gap-4 min-h-0 md:flex-row">
      {/* Sidebar section nav — grouped and vertical on md+, one flat
          horizontally-scrolling strip of chips on mobile (group headers are
          hidden there; at 375px a stack of headers would eat the whole
          viewport before the first item). The header band matches the app
          sidebar so every sidebar surface reads as the same component. */}
      <nav className="flex shrink-0 flex-col md:w-52">
        <SidebarBrandHeader className="hidden md:flex mb-2" size="sm" />
        <div className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:gap-0 md:overflow-visible md:pb-0">
          {SECTION_GROUPS.map((group) => (
            <div key={group.key} className="contents md:block md:mb-3">
              <div className="hidden md:block px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {t[group.labelKey]}
              </div>
              {group.items.map((s) => {
                const active = section === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => !s.locked && goTo(s.key)}
                    disabled={s.locked}
                    title={s.locked ? t.comingSoon : undefined}
                    className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors md:w-full ${
                      s.locked
                        ? "cursor-not-allowed text-muted-foreground/50"
                        : active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <s.icon className="h-4 w-4 shrink-0" />
                    <span>{t[s.labelKey]}</span>
                    {s.locked && <Lock className="ms-auto h-3 w-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* Main area */}
      <div className="flex-1 min-w-0 overflow-auto rounded-md border bg-card p-4">
        {/* No mode="wait": with it, the incoming section only mounts after the
            outgoing one's exit completes, and that completion never fired here
            — clicking a section left the panel showing the old content forever
            (verified on the build predating this file's changes). Without it
            the new section mounts immediately and the old one fades out over
            the top, which is what the cross-fade was meant to look like. */}
        <AnimatePresence>
          <motion.div key={section} {...anim}>
            {section === "overview" && (
              <div className="space-y-4">
                <BotIdentityCard bot={bot} />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">{t.overviewTotalUsers}</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">{nf(bot.userCount)}</div></CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">{t.overviewActiveToday}</CardTitle></CardHeader>
                    <CardContent>
                      {/* No invented number: the field is a TODO on the API, so
                          until it arrives this says so instead of guessing. */}
                      {bot.activeUsersToday == null ? (
                        <div className="text-sm text-muted-foreground">{t.noDataYet}</div>
                      ) : (
                        <div className="text-2xl font-bold">{nf(bot.activeUsersToday)}</div>
                      )}
                    </CardContent>
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
              </div>
            )}
            {section === "profile" && <BotProfileForm bot={bot} />}
            {section === "commands" && <CommandsEditor botId={bot.id} />}
            {section === "plugins" && <PluginsManager botId={bot.id} />}
            {section === "stats" && <BotStatsPanel botId={bot.id} status={bot.status} />}
            {section === "settings" && <BotSettingsSection bot={bot} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Placeholder for a section whose phase hasn't landed yet. */
export function LockedSectionNotice({ label }: { label: string }) {
  const t = useT("botWorkspace");
  const ts = useT("botSettings");
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
      <Badge variant="secondary" className="mb-3">{t.comingSoon}</Badge>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
