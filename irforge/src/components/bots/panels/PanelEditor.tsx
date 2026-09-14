/**
 * PanelEditor.tsx — ویرایش کامل یک پنل (فازهای ۸ تا ۱۰).
 *
 * چهار باگ بات که اینجا حل می‌شوند:
 *   B1 — تغییرات تا «ذخیره» جایی نمی‌روند، ولی ترک صفحه هشدار می‌دهد.
 *   B2 — مدیا لیست است، نه یک فیلد که با هر ویرایش replace شود.
 *   B4 — `panelId` همیشه از URL می‌آید، هرگز از یک state سراسری.
 *   B5 — نوع پنل قابل تغییر است، با هشداری که دقیقاً می‌گوید چه چیزی می‌رود.
 */
import { useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, RotateCcw, ArrowRight, AlertTriangle, Home, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedGuard } from "@/lib/unsaved-changes";
import { buttonsToRows, rowsToButtons, overfullRows, type PanelButton } from "@/lib/panel-buttons";
import { ButtonBuilder } from "./ButtonBuilder";
import { PanelPreview } from "./PanelPreview";
import { MediaList, type MediaMeta } from "./MediaList";
import { panelTypeLabel } from "./labels";
import { isMediaLikeType, isWalletLikeType, panelMediaItems, panelWalletMode, type MediaItemType } from "./mediaCollapse";
import { SendViaBotButton, materializeSession, type CapturedContent, type MaterializedItem } from "@/components/bots/SendViaBotButton";
import {
  apiErrorMessage, usePanelReferences, useSetHomePanel, useTogglePanel, useUpdatePanel,
  type Panel, type PanelCatalog,
} from "./api";

type EditorTab = "content" | "buttons" | "advanced" | "references";

/** فرم‌ها برای انتخابگرِ دکمه‌ی `form`. اگر اندپوینت نبود، لیست خالی. */
function useFormOptions(botId: string) {
  return useQuery({
    queryKey: ["bot-form-options", botId],
    queryFn: async () => {
      try {
        const res = await customFetch<{ forms: Array<{ id: string; title: string }> }>(
          `/api/bots/${botId}/forms`
        );
        return res.forms ?? [];
      } catch {
        return [] as Array<{ id: string; title: string }>;
      }
    },
    staleTime: 60_000,
  });
}

/**
 * آیتم‌های catalog برای انتخابگرِ محصولِ پنل `sell` — همان اندپوینت و شکلِ
 * دقیقاً مشابهِ `useCatalogItemsForPicker` در ButtonBuilder.tsx (اکشنِ
 * «ثبت سفارش یک محصول»)، عمداً با همان queryKey تا کش بینِ دو تب مشترک شود.
 */
function useSellCatalogItems(botId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["bot-panel-catalog-items", botId],
    queryFn: () =>
      customFetch<{ items: Array<{ id: string; name: string; name_fa: string; status: string }> }>(
        `/api/bots/${botId}/catalog/items`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

/** گزینه‌های (option) یک آیتمِ catalog — فقط وقتی که آیتمی برای پنل انتخاب شده. */
function useSellCatalogOptions(botId: string, itemId: string) {
  return useQuery({
    queryKey: ["bot-panel-catalog-options", botId, itemId],
    queryFn: () =>
      customFetch<{ options: Array<{ id: string; label: string }> }>(
        `/api/bots/${botId}/catalog/items/${itemId}/options`,
      ),
    enabled: Boolean(itemId),
  });
}

/** مدیای پنل، به‌صورت یک لیست واحد — بدون توجه به اینکه شکلِ ذخیره‌شده
 * قدیمی است (`media_file_id`/`carousel_ids`) یا تازه (`settings.media_items`). */
function mediaOf(panel: Panel): string[] {
  return panelMediaItems(panel).map((it) => it.file_id);
}

/** نوعِ واقعیِ هر فایل — برایِ پرکردنِ اولیه‌یِ `mediaMeta` از رویِ داده‌یِ
 * ذخیره‌شده، بدونِ نیازِ به حدس‌زدن دوباره در مرورگر. */
function mediaMetaOf(panel: Panel): Record<string, MediaMeta> {
  const out: Record<string, MediaMeta> = {};
  for (const it of panelMediaItems(panel)) out[it.file_id] = { kind: it.type, duration: null };
  return out;
}

/** نوعی که ویرایشگر باید نشان دهد — قدیمی یا تازه، فرقی نمی‌کند، همیشه
 * یکی از پنج نوعِ ادغام‌شده. */
function effectiveTypeOf(panel: Panel): string {
  return isMediaLikeType(panel.type) ? "media" : isWalletLikeType(panel.type) ? "wallet" : panel.type;
}

export function PanelEditor({
  botId,
  panel,
  panels,
  catalog,
  watermark,
  onBack,
  onDeleted,
}: {
  botId: string;
  panel: Panel;
  panels: Panel[];
  catalog: PanelCatalog | undefined;
  watermark?: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const t = useT("botPanels");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const update = useUpdatePanel(botId);
  const setHome = useSetHomePanel(botId);
  const toggle = useTogglePanel(botId);
  const { data: forms = [] } = useFormOptions(botId);
  const references = usePanelReferences(botId, panel.id);

  const [tab, setTab] = useState<EditorTab>("content");
  const [title, setTitle] = useState(panel.title);
  // IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش B — نوعِ
  // اولیه همیشه یکی از پنج نوعِ تازه است، حتی برایِ پنلِ قدیمیِ
  // هنوز-مهاجرت‌نکرده (text/photo/carousel/video/audio/document → «media»،
  // wallet_balance → «wallet»). ذخیره همیشه با همین نوعِ تازه می‌رود، یعنی
  // هر پنلی که از اینجا ویرایش و ذخیره شود همان‌جا هم مهاجرت می‌کند.
  const [type, setType] = useState(() => effectiveTypeOf(panel));
  const [content, setContent] = useState(panel.content);
  const [media, setMedia] = useState<string[]>(() => mediaOf(panel));
  const [mediaMeta, setMediaMeta] = useState<Record<string, MediaMeta>>(() => mediaMetaOf(panel));
  const [rows, setRows] = useState<PanelButton[][]>(() => buttonsToRows(panel.buttons ?? []));
  const [settings, setSettings] = useState<Record<string, unknown>>(() => ({ ...panel.settings }));
  const [walletMode, setWalletMode] = useState<"shared" | "personal">(() => panelWalletMode(panel));
  const [pendingType, setPendingType] = useState<string | null>(null);

  const showMedia = type === "media";

  const sellCatalogItemId = String(settings.catalog_item_id ?? "");
  const { data: sellCatalogItemsData, isLoading: sellCatalogItemsLoading } =
    useSellCatalogItems(botId, type === "sell");
  const { data: sellCatalogOptionsData } = useSellCatalogOptions(botId, sellCatalogItemId);
  const sellCatalogItems = (sellCatalogItemsData?.items ?? []).filter((i) => i.status === "active");
  const sellCatalogOptions = sellCatalogOptionsData?.options ?? [];
  const sellCatalogItemMissing =
    Boolean(sellCatalogItemId) && !sellCatalogItemsLoading &&
    !sellCatalogItems.some((i) => i.id === sellCatalogItemId);

  const dirty = useMemo(() => {
    const before = {
      title: panel.title,
      type: effectiveTypeOf(panel),
      content: panel.content,
      media: mediaOf(panel),
      buttons: rowsToButtons(buttonsToRows(panel.buttons ?? [])),
      settings: panel.settings ?? {},
      walletMode: panelWalletMode(panel),
    };
    const now = { title, type, content, media, buttons: rowsToButtons(rows), settings, walletMode };
    return JSON.stringify(before) !== JSON.stringify(now);
  }, [panel, title, type, content, media, rows, settings, walletMode]);

  // باگ B1: ترک صفحه با کار ذخیره‌نشده نباید بی‌صدا باشد.
  useUnsavedGuard(`panel:${panel.id}`, dirty);

  const tooFull = overfullRows(rows);

  /** آنچه با تغییر نوع از دست می‌رود — قبل از اعمال به کاربر گفته می‌شود (B5).
   * تنها نوعی که مدیا می‌گیرد «media» است؛ رفتن به هر نوعِ دیگری یعنی هر چه
   * آیتمِ مدیا بوده پاک می‌شود. */
  function lossOfChangingTypeTo(nextType: string): string | null {
    if (type === "media" && nextType !== "media" && media.length > 0) return t.typeChangeDropsAllMedia;
    return null;
  }

  function requestTypeChange(nextType: string) {
    if (nextType === type) return;
    if (lossOfChangingTypeTo(nextType)) {
      setPendingType(nextType);
      return;
    }
    setType(nextType);
  }

  function applyPendingType() {
    const nextType = pendingType;
    setPendingType(null);
    if (!nextType) return;
    if (nextType !== "media") setMedia([]);
    setType(nextType);
  }

  /** آیتم‌هایِ گرفته‌شده از «با بات بفرست» (بخشِ A) به لیستِ مدیایِ همین
   * پنل اضافه می‌شوند؛ اگر بینشان متن هم بود (کسی وسطِ فرستادنِ مدیا یک
   * پیامِ متنی هم فرستاده) و محتوایِ پنل هنوز خالی است، همان را می‌گذاریم. */
  async function handleBotMediaCaptured(captured: CapturedContent) {
    try {
      const { items } = await materializeSession(captured.id);
      const newIds: string[] = [];
      const newMeta: Record<string, MediaMeta> = {};
      let firstText: string | null = null;
      for (const item of items as MaterializedItem[]) {
        if (item.type === "text") {
          if (firstText === null) firstText = item.content;
          continue;
        }
        newIds.push(item.fileId);
        newMeta[item.fileId] = { kind: item.type as MediaItemType, duration: null };
      }
      if (newIds.length) {
        setMedia((prev) => [...prev, ...newIds]);
        setMediaMeta((prev) => ({ ...prev, ...newMeta }));
      }
      if (firstText && !content.trim()) setContent(firstText);
      if (newIds.length || firstText) toast({ title: t.mediaUploaded });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) });
    }
  }

  function save() {
    if (!title.trim()) {
      setTab("content");
      toast({ variant: "destructive", title: t.errorTitleRequired });
      return;
    }
    if (tooFull.length > 0) {
      setTab("buttons");
      toast({ variant: "destructive", title: t.errorRowTooFull });
      return;
    }

    // مدیا همان‌جایی نوشته می‌شود که بات می‌خواند: `settings.media_items`
    // (نوعِ هر آیتم از mediaMeta، پیش‌فرضش «عکس»). حالتِ کیف‌پول فقط برایِ
    // نوعِ wallet نوشته می‌شود.
    const nextSettings = { ...settings };
    if (type === "media") {
      nextSettings.media_items = media.map((fileId) => ({
        type: mediaMeta[fileId]?.kind && mediaMeta[fileId].kind !== "unknown" ? mediaMeta[fileId].kind : "photo",
        file_id: fileId,
      }));
    } else if (type === "wallet") {
      nextSettings.mode = walletMode;
    }

    update.mutate(
      {
        panelId: panel.id,
        patch: {
          title: title.trim(),
          type,
          content,
          media_file_id: type === "media" ? (media[0] ?? "") : "",
          buttons: rowsToButtons(rows),
          settings: nextSettings,
        },
      },
      {
        onSuccess: ({ dropped }) => {
          toast({
            title: t.panelSaved,
            description: dropped?.length ? t.panelSavedWithDrop : undefined,
          });
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) }),
      }
    );
  }

  function revert() {
    setTitle(panel.title);
    setType(effectiveTypeOf(panel));
    setContent(panel.content);
    setMedia(mediaOf(panel));
    setMediaMeta(mediaMetaOf(panel));
    setRows(buttonsToRows(panel.buttons ?? []));
    setSettings({ ...panel.settings });
    setWalletMode(panelWalletMode(panel));
  }

  const setSetting = (key: string, value: unknown) => setSettings((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="me-1.5 size-4 rtl-flip" /> {t.backToList}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{panel.title || t.untitledPanel}</h3>
        {panel.is_home && <Badge variant="secondary"><Home className="me-1 size-3" />{t.badgeHome}</Badge>}
        {!panel.is_active && <Badge variant="destructive">{t.badgeInactive}</Badge>}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as EditorTab)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="content">{t.tabContent}</TabsTrigger>
            <TabsTrigger value="buttons">{t.tabButtons}</TabsTrigger>
            <TabsTrigger value="advanced">{t.tabAdvanced}</TabsTrigger>
            <TabsTrigger value="references">{t.tabReferences}</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {tab === "content" && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-1.5">
                  <Label htmlFor="pe-title">{t.fieldTitle}</Label>
                  <Input id="pe-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pe-type">{t.fieldType}</Label>
                  <Select value={type} onValueChange={requestTypeChange}>
                    <SelectTrigger id="pe-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(catalog?.panelTypes ?? [type]).map((x) => (
                        <SelectItem key={x} value={x}>{panelTypeLabel(t, x, catalog?.panelTypeLabels)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* در بات نوع پنل اصلاً قابل تغییر نیست (باگ B5). */}
                  <p className="text-xs text-muted-foreground">{t.fieldTypeChangeHint}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pe-content">{t.fieldContent}</Label>
                  <Textarea id="pe-content" rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
                  <p className="text-xs text-muted-foreground tabular-nums">{content.length} / 4000</p>
                </div>

                {showMedia && (
                  <div className="space-y-1.5">
                    <Label>{t.fieldMediaList}</Label>
                    <MediaList
                      botId={botId}
                      fileIds={media}
                      multiple
                      onChange={setMedia}
                      onMetaChange={setMediaMeta}
                    />
                    {/* IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش A —
                        همان مکانیزمِ عمومیِ «با بات بفرست»؛ اینجا با kind="panel_media"
                        چند پیام (متن/عکس/ویدیو/صوت/فایل) در یک نشست جمع می‌شود و با
                        دکمه‌ی «پایان» در خودِ تلگرام تمام می‌شود — نه فقط اولین پیام. */}
                    <SendViaBotButton kind="panel_media" botId={botId} label={t.mediaSendViaBotCta} onCaptured={handleBotMediaCaptured} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "buttons" && (
            <Card>
              <CardHeader>
                <CardTitle>{t.tabButtons}</CardTitle>
                <CardDescription>{t.buttonsDesc}</CardDescription>
              </CardHeader>
              <CardContent>
                <ButtonBuilder
                  botId={botId}
                  rows={rows}
                  panels={panels.filter((p) => p.id !== panel.id)}
                  forms={forms}
                  catalog={catalog}
                  onChange={setRows}
                />
              </CardContent>
            </Card>
          )}

          {tab === "advanced" && (
            <Card>
              <CardHeader>
                <CardTitle>{t.tabAdvanced}</CardTitle>
                <CardDescription>{t.advancedDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pe-timer">{t.settingTimer}</Label>
                    <Input
                      id="pe-timer" type="number" min={0} dir="ltr"
                      value={Number(settings.timer_seconds ?? 0)}
                      onChange={(e) => setSetting("timer_seconds", Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">{t.settingTimerHint}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pe-capacity">{t.settingCapacity}</Label>
                    <Input
                      id="pe-capacity" type="number" min={0} dir="ltr"
                      value={Number(settings.capacity ?? 0)}
                      onChange={(e) => setSetting("capacity", Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t.settingCapacityUsed.replace("{n}", String(Number(settings.capacity_used ?? 0)))}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pe-password">{t.settingPassword}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pe-password" dir="ltr" type="text"
                      value={String(settings.password ?? "")}
                      onChange={(e) => setSetting("password", e.target.value)}
                    />
                    <Button variant="outline" onClick={() => setSetting("password", "")} disabled={!settings.password}>
                      {t.settingPasswordClear}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.settingPasswordHint}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pe-forward">{t.settingForwardGroups}</Label>
                  <Textarea
                    id="pe-forward" rows={3} dir="ltr"
                    value={(Array.isArray(settings.forward_groups) ? (settings.forward_groups as string[]) : []).join("\n")}
                    onChange={(e) =>
                      setSetting("forward_groups", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
                    }
                  />
                  <p className="text-xs text-muted-foreground">{t.settingForwardGroupsHint}</p>
                </div>

                {type === "wallet" && (
                  <div className="space-y-1.5 rounded-md border p-3">
                    <Label htmlFor="pe-wallet-mode">{t.settingWalletMode}</Label>
                    <Select value={walletMode} onValueChange={(v) => setWalletMode(v as "shared" | "personal")}>
                      <SelectTrigger id="pe-wallet-mode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shared">{t.settingWalletModeShared}</SelectItem>
                        <SelectItem value="personal">{t.settingWalletModePersonal}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {walletMode === "shared" ? t.settingWalletModeSharedHint : t.settingWalletModePersonalHint}
                    </p>
                  </div>
                )}

                {type === "sell" && (
                  <div className="space-y-4 rounded-md border p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pe-sell-item">{t.settingSellCatalogItem}</Label>
                      {sellCatalogItemsLoading ? (
                        <p className="text-xs text-muted-foreground">{t.loadingProducts}</p>
                      ) : (
                        <Select
                          value={sellCatalogItemId || "__manual__"}
                          onValueChange={(v) => {
                            setSetting("catalog_item_id", v === "__manual__" ? "" : v);
                            setSetting("catalog_option_id", "");
                          }}
                        >
                          <SelectTrigger id="pe-sell-item"><SelectValue placeholder={t.pickProduct} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">{t.settingSellManualEntry}</SelectItem>
                            {sellCatalogItems.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {(lang === "fa" ? item.name_fa : item.name) || item.name || item.name_fa}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <p className="text-xs text-muted-foreground">{t.settingSellCatalogItemHint}</p>
                    </div>

                    {sellCatalogItemMissing && (
                      <p className="flex items-center gap-1.5 text-xs text-destructive">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {t.settingSellItemMissingWarning}
                      </p>
                    )}

                    {Boolean(sellCatalogItemId) && sellCatalogOptions.length > 0 && (
                      <div className="space-y-1.5">
                        <Label htmlFor="pe-sell-option">{t.settingSellOption}</Label>
                        <Select
                          value={String(settings.catalog_option_id || "__none__")}
                          onValueChange={(v) => setSetting("catalog_option_id", v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger id="pe-sell-option"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t.settingSellOptionNone}</SelectItem>
                            {sellCatalogOptions.map((opt) => (
                              <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="pe-product">{t.settingProductName}</Label>
                        <Input
                          id="pe-product"
                          disabled={Boolean(sellCatalogItemId)}
                          value={String(settings.product_name ?? "")}
                          onChange={(e) => setSetting("product_name", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pe-price">{t.settingPrice}</Label>
                        {/* IRFORGE_SELL_PANEL_PROMPT Phase 7 — was `settings.price`,
                            a key the bot has never read (handlers/panel_builder.py
                            writes/reads `product_price`); every manual sell-panel
                            price edited from the site was silently dropped. */}
                        <AmountInput
                          id="pe-price"
                          disabled={Boolean(sellCatalogItemId)}
                          value={String(settings.product_price ?? 0)}
                          onChange={(e) => setSetting("product_price", Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pe-receipt">{t.settingReceiptGroup}</Label>
                        {/* was `settings.receipt_group` — the bot's own key is
                            `target_group` (fsm_sell_target_group, panel_builder.py). */}
                        <Input
                          id="pe-receipt" dir="ltr"
                          disabled={Boolean(sellCatalogItemId)}
                          value={String(settings.target_group ?? "")}
                          onChange={(e) => setSetting("target_group", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="pe-product-desc">{t.settingProductDesc}</Label>
                        {/* was `settings.product_description` — the bot's own key
                            is `product_desc` (resolve_sell_product, utils/sell_panel.py). */}
                        <Textarea
                          id="pe-product-desc" rows={2}
                          disabled={Boolean(sellCatalogItemId)}
                          value={String(settings.product_desc ?? "")}
                          onChange={(e) => setSetting("product_desc", e.target.value)}
                        />
                      </div>
                    </div>
                    {Boolean(sellCatalogItemId) && (
                      <p className="text-xs text-muted-foreground">{t.settingSellManualFieldsDisabledHint}</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    variant="outline" size="sm"
                    disabled={panel.is_home || setHome.isPending}
                    onClick={() =>
                      setHome.mutate(panel.id, { onSuccess: () => toast({ title: t.homeSet }) })
                    }
                  >
                    <Home className="me-1.5 size-4" /> {panel.is_home ? t.alreadyHome : t.setAsHome}
                  </Button>
                  <Button
                    variant="outline" size="sm" disabled={toggle.isPending}
                    onClick={() => toggle.mutate(panel.id)}
                  >
                    <Power className="me-1.5 size-4" /> {panel.is_active ? t.deactivate : t.activate}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {tab === "references" && (
            <Card>
              <CardHeader>
                <CardTitle>{t.tabReferences}</CardTitle>
                <CardDescription>{t.referencesDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {references.isLoading && <Loader2 className="size-4 animate-spin" />}
                {references.data && (
                  <>
                    <div>
                      <p className="font-medium">{t.refParent}</p>
                      <p className="text-muted-foreground">
                        {references.data.parent?.title ?? t.refNone}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium">{t.refChildren}</p>
                      {references.data.children.length === 0 ? (
                        <p className="text-muted-foreground">{t.refNone}</p>
                      ) : (
                        <ul className="list-inside list-disc text-muted-foreground">
                          {references.data.children.map((c) => <li key={c.id}>{c.title || c.id}</li>)}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{t.refButtons}</p>
                      {references.data.buttons.length === 0 ? (
                        <p className="text-muted-foreground">{t.refNone}</p>
                      ) : (
                        <ul className="list-inside list-disc text-muted-foreground">
                          {references.data.buttons.map((b, i) => (
                            <li key={i}>{t.refButtonLine.replace("{button}", b.label).replace("{panel}", b.panelTitle || b.panelId)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{t.refCommands}</p>
                      {references.data.commands.length === 0 ? (
                        <p className="text-muted-foreground">{t.refNone}</p>
                      ) : (
                        <ul className="list-inside list-disc text-muted-foreground">
                          {references.data.commands.map((c) => <li key={c.command} dir="ltr">/{c.command}</li>)}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
              {t.save}
            </Button>
            <Button variant="ghost" onClick={revert} disabled={!dirty || update.isPending}>
              <RotateCcw className="me-2 size-4" /> {t.revert}
            </Button>
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">{t.unsavedBadge}</span>}
          </div>
        </div>

        {/* پیش‌نمایش زنده — همیشه دیده می‌شود، روی موبایل زیر فرم. */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <PanelPreview
            title={title}
            content={content}
            type={type}
            media={media}
            mediaMeta={mediaMeta}
            botId={botId}
            rows={rows}
            watermark={watermark}
            hasParent={Boolean(panel.parent_id)}
          />
        </div>
      </div>

      <AlertDialog open={pendingType !== null} onOpenChange={(open) => !open && setPendingType(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              {t.typeChangeTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingType ? lossOfChangingTypeTo(pendingType) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); applyPendingType(); }}>
              {t.typeChangeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
