import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation, useSearch } from "wouter";
import {
  LayoutDashboard,
  IdCard,
  Terminal,
  Blocks,
  Activity,
  Settings,
  Lock,
  LayoutPanelLeft,
  FileText,
  Users,
  ShieldCheck,
  ShoppingCart,
  CreditCard,
  Receipt,
  Ticket,
  Megaphone,
  LifeBuoy,
  Boxes,
  Share2,
  Workflow,
  Star,
  CalendarClock,
  BadgeCheck,
  Gift,
  ClipboardList,
  Send,
  Contact,
  MapPin,
  Store,
  Wallet,
  Languages,
  Newspaper,
  GitBranch,
  Database,
  Gamepad2,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import type { Bot } from "@workspace/api-client-react";
import { useGetBotStats, getGetBotStatsQueryKey, customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useMotionDirection } from "@/hooks/use-motion-direction";
import { hasUnsavedChanges, setDiscardMessage } from "@/lib/unsaved-changes";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CommandsEditor } from "@/components/bots/CommandsEditor";
import { PluginsManager } from "@/components/bots/PluginsManager";
import { BotStatsPanel } from "@/components/bots/BotStatsPanel";
import { BotSettingsSection } from "@/components/bots/settings/BotSettingsSection";
import { PanelsSection } from "@/components/bots/panels/PanelsSection";
import { FormsSection } from "@/components/bots/forms/FormsSection";
import { AdminsSection } from "@/components/bots/admins/AdminsSection";
import { UsersSection } from "@/components/bots/users/UsersSection";
import { BroadcastSection } from "@/components/bots/broadcast/BroadcastSection";
import { OrdersSection } from "@/components/bots/orders/OrdersSection";
import { PaymentsSection } from "@/components/bots/payments/PaymentsSection";
import { InvoicesSection } from "@/components/bots/invoices/InvoicesSection";
import { ObjectsSection } from "@/components/bots/advanced/ObjectsSection";
import { RelationsSection } from "@/components/bots/advanced/RelationsSection";
import { WorkflowsSection } from "@/components/bots/advanced/WorkflowsSection";
import { TicketsSection } from "@/components/bots/tickets/TicketsSection";
import { BookingSection } from "@/components/bots/booking/BookingSection";
import { TranslatePostSection } from "@/components/bots/translate-post/TranslatePostSection";
import { PostboxSection } from "@/components/bots/postbox/PostboxSection";
import { GuidedFlowSection } from "@/components/bots/guidedFlow/GuidedFlowSection";
import { AddressesSection } from "@/components/bots/addresses/AddressesSection";
import { GameServersSection } from "@/components/bots/gameserver_cs2/GameServersSection";
import { DripSection } from "@/components/bots/drip/DripSection";
import { CrmSection } from "@/components/bots/crm/CrmSection";
import { CatalogSection } from "@/components/bots/catalog/CatalogSection";
import { WalletSection } from "@/components/bots/wallet/WalletSection";
import { DatabaseSection } from "@/components/bots/database/DatabaseSection";
import { SurveySection } from "@/components/bots/survey/SurveySection";
import { GiveawaySection } from "@/components/bots/giveaway/GiveawaySection";
import { LoyaltySection } from "@/components/bots/loyalty/LoyaltySection";
// سکشن عمومیِ پلاگین‌های تازه — جدول‌هایش از اسکیمای سرور ساخته می‌شوند.
import { PluginSection } from "@/components/bots/plugins/PluginSection";
import { BotProfileForm } from "@/components/bots/BotProfileForm";
import { BotOverview } from "@/components/bots/BotOverview";
import { TutorialButton } from "@/components/tutorial/TutorialButton";
import { TUTORIALS } from "@/lib/tutorials/content";
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
  | "payments"
  | "invoices"
  | "discounts"
  | "broadcast"
  | "tickets"
  | "objects"
  | "relations"
  | "workflows"
  | "plugins"
  | "loyalty"
  | "booking"
  | "addresses"
  | "gameservers"
  | "subscriptions"
  | "giveaways"
  | "surveys"
  | "drip"
  | "translatePost"
  | "postbox"
  | "guidedFlow"
  | "crm"
  | "catalog"
  | "wallet"
  | "database"
  | "settings";

type SectionMeta = {
  key: SectionKey;
  icon: LucideIcon;
  labelKey: keyof LocaleShape["botWorkspace"];
  /** Rendered but not selectable — the feature has no implementation yet.
   *  Each migration phase unlocks exactly its own section, nothing else. */
  locked?: boolean;
  /**
   * پلاگینی که این سکشن بدون آن بی‌معناست.
   *
   * سکشن **اصلاً رندر نمی‌شود** وقتی پلاگین خاموش است — نه قفل‌شده و نه
   * خاکستری. یک تب قفل، کاربر را وسوسه می‌کند رویش کلیک کند و چیزی به او
   * نمی‌گوید؛ یک بات بدون فروش هم اصلاً نباید «سفارش‌ها» را ببیند.
   * گیت واقعی سمت سرور است (`lib/pluginGate.ts`).
   */
  requiresPlugin?: string;
  /**
   * استثنای بالا، برای سکشن‌هایی که خاموش‌بودنِ پلاگین‌شان خودش خبری است که
   * کاربر باید ببیند — نه یک سکشن که وجودش بی‌معناست.
   *
   * IRFORGE_PROMPT_V3 Phase 16 — «در را باز کن، سکشن را پنهان نکن»: تیکت‌ها
   * برخلاف سفارش‌ها/رزرو، یک قابلیتِ همیشه-مرتبط است (هر بات ممکن است کاربر
   * پیام بدهد)، پس به‌جای ناپدید شدن، یک CTA بزرگِ «فعال‌سازی» نشان می‌دهد —
   * خودِ سکشن (`TicketsSection.tsx`) این تصمیم را از روی خطای
   * `plugin_disabled` سرور می‌گیرد.
   */
  showWhenDisabled?: boolean;
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
 *
 * Reorganized per explicit operator direction (2026-09-23): a smaller,
 * curated top-level set (the first 7 groups), with every other pre-existing
 * section demoted into the trailing "other" group and locked there —
 * visible so nothing silently vanishes for a tenant already relying on it
 * via a bookmark, but not reachable by anyone until a future phase
 * deliberately promotes one back up. `showWhenDisabled: true` was added to
 * a few items here (orders/payments/invoices/loyalty) that didn't have it
 * before, specifically so the lock applies uniformly to every tenant
 * regardless of that plugin's on/off state — the request was "disable for
 * everyone", not "disable only for tenants who already had it visible".
 */
const SECTION_GROUPS: SectionGroup[] = [
  {
    key: "overview",
    labelKey: "groupOverview",
    items: [
      { key: "overview", icon: LayoutDashboard, labelKey: "sectionOverview" },
      { key: "profile", icon: IdCard, labelKey: "sectionProfile" },
      { key: "plugins", icon: Blocks, labelKey: "sectionPlugins" },
      // IRFORGE_PAID_SQL_DATABASE_PROMPT — انتخابِ Sheet/SQL برای این بات؛
      // همیشه قابلِ دیدن است (بدون requiresPlugin)، چون به هیچ پلاگینی
      // وابسته نیست، به خودِ زیرساختِ داده‌ی بات.
      { key: "database", icon: Database, labelKey: "sectionDatabase" },
    ],
  },
  {
    key: "content",
    labelKey: "groupContent",
    items: [
      { key: "panels", icon: LayoutPanelLeft, labelKey: "sectionPanels" },
      { key: "forms", icon: FileText, labelKey: "sectionForms" },
      { key: "commands", icon: Terminal, labelKey: "sectionCommands" },
    ],
  },
  {
    key: "people",
    labelKey: "groupPeople",
    items: [
      { key: "stats", icon: Activity, labelKey: "sectionStats" },
      { key: "users", icon: Users, labelKey: "sectionUsers" },
      { key: "admins", icon: ShieldCheck, labelKey: "sectionAdmins" },
    ],
  },
  {
    key: "sales",
    labelKey: "groupSales",
    items: [
      // IRFORGE_PROMPT_V3 Phase 24 — همان الگوی `showWhenDisabled`ی booking/address:
      // سکشن ناپدید نمی‌شود، فقط وقتی پلاگین خاموش است یک CTA فعال‌سازی نشان می‌دهد.
      { key: "catalog", icon: Store, labelKey: "sectionCatalog", requiresPlugin: "catalog", showWhenDisabled: true },
      // پلاگین‌های تازه‌ی فروش‌محور. هرکدام فقط وقتی رندر می‌شوند که پلاگینشان
      // روی این بات روشن باشد — گیت واقعی سمت سرور است (`lib/pluginGate.ts`).
      { key: "subscriptions", icon: BadgeCheck, labelKey: "sectionSubscriptions", requiresPlugin: "subscription" },
      // IRFORGE_PROMPT_V3 Phase 24 — admin-only wallet actions (balance
      // lookup, credit/debit, freeze/unfreeze, order charge/refund, notify
      // templates) that used to be Telegram-command-only. Same
      // `showWhenDisabled` pattern as booking/address/crm below.
      { key: "wallet", icon: Wallet, labelKey: "sectionWallet", requiresPlugin: "wallet", showWhenDisabled: true },
      // 2026-09-23 — پرداخت‌ها از گروه «سایر» (قفل‌شده) به اینجا، زیر کیف پول،
      // برگشت و فعال شد. ترتیب سکشن‌های فروش: catalog → wallet → payments →
      // booking. همان گیت پلاگین کیف پول و همان الگوی `showWhenDisabled`.
      { key: "payments", icon: CreditCard, labelKey: "sectionPayments", requiresPlugin: "wallet", showWhenDisabled: true },
      // IRFORGE_RECEIPT_DEBUG_INVOICES_PROMPT Part 2 — a new view on the
      // same `payments` data Orders already reads, not a new data source.
      // 2026-09-23 — از «سایر» به اینجا، زیر پرداخت‌ها، برگشت و فعال شد.
      { key: "invoices", icon: Receipt, labelKey: "sectionInvoices", requiresPlugin: "wallet", showWhenDisabled: true },
      // IRFORGE_PROMPT_V3 Phase 17 — همان الگوی `showWhenDisabled` تیکت
      // (فاز ۱۶): سکشن ناپدید نمی‌شود، فقط وقتی پلاگین خاموش است یک CTA
      // فعال‌سازی نشان می‌دهد (`BookingSection.tsx`'s plugin_disabled branch).
      { key: "booking", icon: CalendarClock, labelKey: "sectionBooking", requiresPlugin: "booking", showWhenDisabled: true },
    ],
  },
  {
    key: "comms",
    labelKey: "groupComms",
    items: [
      { key: "broadcast", icon: Megaphone, labelKey: "sectionBroadcast" },
      // پشتیبانیِ پایه (`handlers/support.py`) همیشه هسته و روشن است؛ پلاگین
      // «تیکت» چیزی که از قبل کار می‌کرد را روشن/خاموش نمی‌کند، فقط صف
      // ادمین/اولویت/SLA را روی همان داده اضافه می‌کند (IRFORGE_PROMPT_V3
      // Phase 16). به همین دلیل `showWhenDisabled`: این سکشن هیچ‌وقت نباید
      // ناپدید شود، فقط وقتی پلاگین خاموش است یک CTA فعال‌سازی نشان می‌دهد.
      { key: "tickets", icon: LifeBuoy, labelKey: "sectionTickets", requiresPlugin: "ticket", showWhenDisabled: true },
      // IRFORGE_PROMPT_V3 Phase 19 — همان الگوی `showWhenDisabled`ی booking/address:
      // سکشن ناپدید نمی‌شود، فقط وقتی پلاگین خاموش است یک CTA فعال‌سازی نشان می‌دهد.
      { key: "drip", icon: Send, labelKey: "sectionDrip", requiresPlugin: "drip", showWhenDisabled: true },
    ],
  },
  {
    key: "advanced",
    labelKey: "groupAdvanced",
    items: [
      // IRFORGE_PROMPT_V3 Phase 18
      { key: "addresses", icon: MapPin, labelKey: "sectionAddresses", requiresPlugin: "address", showWhenDisabled: true },
      // IRFORGE_PROMPT_V3 Phase 20
      { key: "giveaways", icon: Gift, labelKey: "sectionGiveaways", requiresPlugin: "giveaway", showWhenDisabled: true },
    ],
  },
  {
    key: "settings",
    labelKey: "groupSettings",
    items: [
      // The gear, always last of the curated groups.
      { key: "settings", icon: Settings, labelKey: "sectionSettings" },
    ],
  },
  {
    // 2026-09-23 — everything not in the curated set above, demoted here and
    // locked (visible, never selectable — see BotWorkspaceDocument's `goTo`/
    // `section` gate, which already refuses to navigate to a locked key even
    // via a direct URL). `showWhenDisabled: true` is added wherever a
    // `requiresPlugin` item didn't already have it, so the lock is the same
    // for every tenant instead of only appearing for the ones whose plugin
    // happened to be on.
    key: "other",
    labelKey: "groupOther",
    items: [
      { key: "orders", icon: ShoppingCart, labelKey: "sectionOrders", requiresPlugin: "wallet", showWhenDisabled: true, locked: true },
      // Deliberately still locked, and the only one left. "Discounts" means two
      // different things here: the platform's own discount codes (routes/
      // discounts.ts, site Postgres) and the bot's `discount` plugin with its
      // own `discounts` tab. Wiring this section to either without deciding
      // which one it represents would repeat exactly the B13/B14 mistake, and
      // no migration phase covers it — see docs/BOT_ADMIN_ON_WEB.md.
      { key: "discounts", icon: Ticket, labelKey: "sectionDiscounts", locked: true },
      { key: "loyalty", icon: Star, labelKey: "sectionLoyalty", requiresPlugin: "loyalty", showWhenDisabled: true, locked: true },
      { key: "objects", icon: Boxes, labelKey: "sectionObjects", locked: true },
      { key: "relations", icon: Share2, labelKey: "sectionRelations", locked: true },
      { key: "workflows", icon: Workflow, labelKey: "sectionWorkflows", locked: true },
      // IRFORGE_CS2_RCON_PLUGIN_PROMPT Phase 3 — همان الگوی showWhenDisabled.
      { key: "gameservers", icon: Gamepad2, labelKey: "sectionGameServers", requiresPlugin: "gameserver_cs2", showWhenDisabled: true, locked: true },
      { key: "surveys", icon: ClipboardList, labelKey: "sectionSurveys", requiresPlugin: "survey", showWhenDisabled: true, locked: true },
      // پستِ چندزبانه (Google Translate API) — همان الگوی showWhenDisabled.
      { key: "translatePost", icon: Languages, labelKey: "sectionTranslatePost", requiresPlugin: "translate_post", showWhenDisabled: true, locked: true },
      // IRFORGE_POSTBOX_PROMPT Phase B2 — همان الگویِ showWhenDisabled.
      { key: "postbox", icon: Newspaper, labelKey: "sectionPostbox", requiresPlugin: "autoposter", showWhenDisabled: true, locked: true },
      { key: "guidedFlow", icon: GitBranch, labelKey: "sectionGuidedFlow", requiresPlugin: "guided_flow", showWhenDisabled: true, locked: true },
      { key: "crm", icon: Contact, labelKey: "sectionCrm", requiresPlugin: "crm", showWhenDisabled: true, locked: true },
    ],
  },
];

const ALL_SECTIONS: SectionMeta[] = SECTION_GROUPS.flatMap((g) => g.items);

function findSection(key: string | null): SectionMeta | undefined {
  return ALL_SECTIONS.find((s) => s.key === key);
}

/**
 * پلاگین‌های فعالِ این بات — همان چیزی که خودِ بات می‌بیند
 * (`__plugin_states__`). موقع لود شدن `undefined` است؛ در آن فاصله سکشن‌های
 * پلاگین‌دار پنهان می‌مانند تا با آمدن پاسخ ناگهان ظاهر شوند، نه اینکه اول
 * ظاهر شوند و بعد بپرند.
 */
export function useEnabledPlugins(botId: string): Set<string> | undefined {
  const { data } = useQuery({
    queryKey: ["bot-plugins", botId],
    queryFn: () =>
      customFetch<{ plugins: Array<{ id: string; enabled: boolean }> }>(`/api/bots/${botId}/plugins`),
    staleTime: 60_000,
    retry: false,
  });
  if (!data) return undefined;
  return new Set(data.plugins.filter((p) => p.enabled).map((p) => p.id));
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

  const enabledPlugins = useEnabledPlugins(bot.id);

  /**
   * سکشنی که پلاگینش خاموش است اصلاً وجود ندارد — مگر `showWhenDisabled`،
   * که به‌جای ناپدید شدن یک CTA فعال‌سازی نشان می‌دهد (فاز ۱۶).
   */
  function visible(meta: SectionMeta): boolean {
    if (!meta.requiresPlugin) return true;
    if (meta.showWhenDisabled) return true;
    return enabledPlugins?.has(meta.requiresPlugin) ?? false;
  }

  const requested = new URLSearchParams(search).get("section");
  const match = findSection(requested);
  // A locked section is not a valid destination either — someone with a stale
  // bookmark from a future phase shouldn't land on a blank panel. Same for a
  // section whose plugin is off and doesn't opt into `showWhenDisabled`: a
  // bookmark from when it was on must not land on a section the server will
  // 403. A `showWhenDisabled` section is always a valid destination — it
  // handles its own "plugin is off" state instead of relying on this gate.
  const section: SectionKey = match && !match.locked && visible(match) ? match.key : "overview";

  /** سکشن مقصدی که منتظر تأیید «دور ریختن تغییرات» است. */
  const [pendingSection, setPendingSection] = useState<SectionKey | null>(null);
  /** the collapsed "other / not available yet" group */
  const [showOther, setShowOther] = useState(false);
  const activeMeta = findSection(section);
  const ActiveIcon = activeMeta?.icon;
  const activeLabel = activeMeta ? t[activeMeta.labelKey] : "";

  function applyGoTo(next: SectionKey) {
    const params = new URLSearchParams(search);
    params.set("section", next);
    // Tab state belongs to the section being left, not the one being entered.
    params.delete("tab");
    params.delete("panel");
    params.delete("form");
    navigate(`/bots/${bot.id}?${params.toString()}`);
  }

  function goTo(next: SectionKey) {
    // Leaving a section with an unsaved form throws the user's work away
    // silently — that's bug B1 on the bot side, and it must not repeat here.
    // A `window.confirm()` gate here (the previous approach) is a genuine
    // no-op inside Telegram's in-app WebView and similar embedded browsers —
    // it returns falsy without ever showing anything, so a lingering dirty
    // flag from an unrelated section silently blocked every further click on
    // the sidebar with zero feedback ("I click Commands/Plugins and nothing
    // happens"). An in-app AlertDialog is fully within our control, exactly
    // like the tab-switch confirm in BotSettingsSection.tsx, so it always
    // renders regardless of the host webview.
    if (!hasUnsavedChanges()) {
      applyGoTo(next);
      return;
    }
    setPendingSection(next);
  }

  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(fa ? "fa-IR" : "en-US");

  // آمار کاربران فقط برای کارت‌های نمای کلی لازم است؛ در بقیه‌ی سکشن‌ها خوانده
  // نمی‌شود تا هر بار باز کردن «پنل‌ها» یک خواندن اضافه از شیت نزند. سرور
  // خودش ۶۰ ثانیه کش می‌کند (lib/botStats.ts).
  const { data: stats } = useGetBotStats(bot.id, {
    query: { queryKey: getGetBotStatsQueryKey(bot.id), enabled: section === "overview" },
  });

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
    <div className="flex flex-1 flex-col gap-5 min-h-0 md:flex-row md:items-start">
      {/* Section rail — grouped and vertical on md+ (sticky, so it stays in
          reach while a long section scrolls), one flat horizontally-scrolling
          strip of chips on mobile (group headers are hidden there; at 375px a
          stack of headers would eat the whole viewport before the first
          item). Sections that are not available yet live in one collapsed
          "other" group instead of a wall of padlocks. */}
      <nav className="flex shrink-0 flex-col md:sticky md:top-20 md:max-h-[calc(100vh-6.5rem)] md:w-56 md:overflow-y-auto md:pe-1" aria-label={t.sectionOverview}>
        <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-0 md:overflow-visible md:pb-0">
          {/* گروهی که همه‌ی آیتم‌هایش پنهان شده‌اند، عنوانِ تنها نشان نمی‌دهد. */}
          {SECTION_GROUPS.filter((g) => g.items.some(visible)).map((group) => {
            const isOther = group.key === "other";
            const collapsed = isOther && !showOther && !group.items.some((s) => s.key === section);
            return (
              <div key={group.key} className="contents md:block md:mb-4">
                {isOther ? (
                  <button
                    type="button"
                    onClick={() => setShowOther((v) => !v)}
                    aria-expanded={!collapsed}
                    className="hidden w-full items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold text-muted-foreground/70 transition-colors hover:text-foreground md:flex"
                  >
                    <ChevronDown className={`size-3 transition-transform ${collapsed ? "-rotate-90 rtl:rotate-90" : ""}`} />
                    {t[group.labelKey]}
                  </button>
                ) : (
                  <div className="hidden px-3 pb-1.5 text-[11px] font-semibold text-muted-foreground/70 md:block">
                    {t[group.labelKey]}
                  </div>
                )}
                {!collapsed && group.items.filter(visible).map((s) => {
                  const active = section === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => !s.locked && goTo(s.key)}
                      disabled={s.locked}
                      title={s.locked ? t.comingSoon : undefined}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors md:w-full ${
                        s.locked
                          ? "cursor-not-allowed text-muted-foreground/45"
                          : active
                            ? "bg-primary/10 text-primary before:absolute before:inset-y-2 before:start-0 before:hidden before:w-[3px] before:rounded-full before:bg-primary md:before:block"
                            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      }`}
                    >
                      <s.icon className="h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">{t[s.labelKey]}</span>
                      {s.locked && <Lock className="ms-auto h-3 w-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Main area */}
      <div className="min-w-0 flex-1 rounded-3xl border border-border/70 bg-card/70 p-4 shadow-[var(--shadow-card)] sm:p-6">
        {/* One heading per section, so you always know where you are; the
            tutorial button sits opposite it (IRFORGE_TUTORIAL_SYSTEM_PROMPT —
            one shared spot instead of a button inside every section; it
            renders nothing for a section without a tutorial). */}
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            {ActiveIcon && (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <ActiveIcon className="size-5" />
              </span>
            )}
            <h2 className="truncate text-xl font-bold tracking-tight">{activeLabel}</h2>
          </div>
          <TutorialButton section={section} />
        </div>
        {/* No mode="wait": with it, the incoming section only mounts after the
            outgoing one's exit completes, and that completion never fired here
            — clicking a section left the panel showing the old content forever
            (verified on the build predating this file's changes). Without it
            the new section mounts immediately and the old one fades out over
            the top, which is what the cross-fade was meant to look like. */}
        <AnimatePresence>
          <motion.div key={section} {...anim}>
            {section === "overview" && (
              <BotOverview
                bot={bot}
                stats={stats}
                nf={nf}
                onGo={(k) => goTo(k as SectionKey)}
                actions={(["panels", "commands", "broadcast", "plugins"] as const).flatMap((k) => {
                  const m = findSection(k);
                  return m && !m.locked && visible(m) ? [{ key: m.key, icon: m.icon, label: t[m.labelKey] }] : [];
                })}
              />
            )}
            {section === "panels" && <PanelsSection bot={bot} />}
            {section === "forms" && <FormsSection bot={bot} />}
            {section === "admins" && <AdminsSection bot={bot} />}
            {section === "users" && <UsersSection bot={bot} />}
            {section === "broadcast" && <BroadcastSection bot={bot} />}
            {section === "orders" && <OrdersSection bot={bot} />}
            {section === "payments" && <PaymentsSection bot={bot} />}
            {section === "invoices" && <InvoicesSection bot={bot} />}
            {section === "objects" && <ObjectsSection bot={bot} />}
            {section === "relations" && <RelationsSection bot={bot} />}
            {section === "workflows" && <WorkflowsSection bot={bot} />}
            {section === "tickets" && <TicketsSection bot={bot} />}
            {section === "loyalty" && <LoyaltySection bot={bot} />}
            {section === "booking" && <BookingSection bot={bot} />}
            {section === "addresses" && <AddressesSection bot={bot} />}
            {section === "gameservers" && <GameServersSection bot={bot} />}
            {section === "subscriptions" && <PluginSection bot={bot} plugin="subscription" />}
            {section === "giveaways" && <GiveawaySection bot={bot} />}
            {section === "surveys" && <SurveySection bot={bot} />}
            {section === "drip" && <DripSection bot={bot} />}
            {section === "translatePost" && <TranslatePostSection bot={bot} />}
            {section === "postbox" && <PostboxSection bot={bot} />}
            {section === "guidedFlow" && <GuidedFlowSection bot={bot} />}
            {section === "crm" && <CrmSection bot={bot} />}
            {section === "catalog" && <CatalogSection bot={bot} />}
            {section === "wallet" && <WalletSection bot={bot} />}
            {section === "database" && <DatabaseSection bot={bot} />}
            {section === "profile" && <BotProfileForm bot={bot} />}
            {section === "commands" && <CommandsEditor botId={bot.id} />}
            {section === "plugins" && <PluginsManager botId={bot.id} />}
            {section === "stats" && <BotStatsPanel botId={bot.id} status={bot.status} />}
            {section === "settings" && <BotSettingsSection bot={bot} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <AlertDialog open={pendingSection !== null} onOpenChange={(open) => !open && setPendingSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ts.unsavedTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ts.unsavedDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ts.unsavedStay}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const next = pendingSection;
                setPendingSection(null);
                if (next) applyGoTo(next);
              }}
            >
              {ts.unsavedDiscard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
