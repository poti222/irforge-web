/**
 * BotSettingsSection.tsx — میزبان تب‌های سکشن «تنظیمات».
 *
 * جای `BotSettingsForm.tsx` قدیمی را گرفته؛ آن فایل یک صفحه‌ی طولانی از چهار
 * موضوع بی‌ربط بود (نام بات، کد ادمین، شیت، حذف). حالا هر موضوع تب خودش را
 * دارد و تب‌ها روی موبایل افقی اسکرول می‌شوند.
 *
 * تب فعال هم در URL است (`?section=settings&tab=messages`) — به همان دلیلی که
 * سکشن در URL است: قابل بوکمارک و refresh.
 *
 * هشدار «تغییرات ذخیره‌نشده» (باگ B1): سوییچ تب وقتی فرم dirty است اول یک
 * دیالوگ تأیید می‌آورد. ترک کل صفحه با `beforeunload` در `useUnsavedGuard`
 * پوشش داده شده.
 */
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, SlidersHorizontal, MessageSquare, CreditCard, ShieldAlert, Users2, Clock, Gauge } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/use-translation";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useBotSettings, apiErrorCode, apiErrorMessage } from "./api";
import { TabGeneral } from "./TabGeneral";
import { TabMessages } from "./TabMessages";
import { TabPayment } from "./TabPayment";
import { TabDanger } from "./TabDanger";
import { TabForceJoin } from "./TabForceJoin";
import { TabWorkingHours } from "./TabWorkingHours";
import { TabAntiFlood } from "./TabAntiFlood";
import type { LocaleShape } from "@/hooks/use-translation";

type TabKey =
  | "general"
  | "messages"
  | "forceJoin"
  | "workingHours"
  | "antiFlood"
  | "payment"
  | "danger";

const TABS: { key: TabKey; labelKey: keyof LocaleShape["botSettings"]; icon: typeof SlidersHorizontal }[] = [
  { key: "general", labelKey: "tabGeneral", icon: SlidersHorizontal },
  { key: "messages", labelKey: "tabMessages", icon: MessageSquare },
  { key: "forceJoin", labelKey: "tabForceJoin", icon: Users2 },
  { key: "workingHours", labelKey: "tabWorkingHours", icon: Clock },
  { key: "antiFlood", labelKey: "tabAntiFlood", icon: Gauge },
  { key: "payment", labelKey: "tabPayment", icon: CreditCard },
  { key: "danger", labelKey: "tabDanger", icon: ShieldAlert },
];

export function BotSettingsSection({ bot }: { bot: Bot }) {
  const t = useT("botSettings");
  const [, navigate] = useLocation();
  const search = useSearch();
  const { data, isLoading, error } = useBotSettings(bot.id);

  const requested = new URLSearchParams(search).get("tab") as TabKey | null;
  const tab: TabKey = TABS.some((x) => x.key === requested) ? (requested as TabKey) : "general";

  /** تب مقصدی که منتظر تأیید «دور ریختن تغییرات» است. */
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null);

  function applyTab(next: TabKey) {
    const params = new URLSearchParams(search);
    params.set("section", "settings");
    params.set("tab", next);
    navigate(`/bots/${bot.id}?${params.toString()}`);
  }

  function requestTab(next: string) {
    if (next === tab) return;
    if (hasUnsavedChanges()) {
      setPendingTab(next as TabKey);
      return;
    }
    applyTab(next as TabKey);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error || !data) {
    // یک بات بدون شیت اختصاصی (۴۰۹ `no_sheet`) خطای واقعی نیست — یعنی هنوز
    // نوبتش نشده. جدا از خطاهای دیگر پیام می‌گیرد.
    const code = apiErrorCode(error);
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {code === "no_sheet"
          ? t.noSheetYet
          : code === "entity_on_postgres"
            ? t.errorOnPostgres
            : apiErrorMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={requestTab}>
        {/* روی موبایل نوار تب‌ها افقی اسکرول می‌شود؛ هفت تب روی ۳۷۵px جا نمی‌شود
            و شکستن به دو خط، ارتفاع مفید را می‌خورد. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            {TABS.map((x) => (
              <TabsTrigger key={x.key} value={x.key} className="gap-1.5">
                <x.icon className="size-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t[x.labelKey]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {tab === "general" && <TabGeneral bot={bot} data={data} />}
      {tab === "messages" && <TabMessages botId={bot.id} data={data} />}
      {tab === "forceJoin" && <TabForceJoin botId={bot.id} data={data} />}
      {tab === "workingHours" && <TabWorkingHours botId={bot.id} data={data} />}
      {tab === "antiFlood" && <TabAntiFlood botId={bot.id} data={data} />}
      {tab === "payment" && <TabPayment botId={bot.id} data={data} />}
      {tab === "danger" && <TabDanger bot={bot} />}

      <AlertDialog open={pendingTab !== null} onOpenChange={(open) => !open && setPendingTab(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.unsavedTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.unsavedDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.unsavedStay}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const next = pendingTab;
                setPendingTab(null);
                if (next) applyTab(next);
              }}
            >
              {t.unsavedDiscard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
