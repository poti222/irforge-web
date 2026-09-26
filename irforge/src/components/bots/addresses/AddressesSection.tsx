/**
 * AddressesSection.tsx — IRFORGE_PROMPT_V3 Phase 18
 * ─────────────────────────────────────────────────────────────────────────────
 * List + editor for the new `address` plugin. The editor's map picker is
 * built on Leaflet, tiled from CARTO's free basemap CDN — no API key, no
 * billing account, works from Iran (unlike the Google Maps JS SDK). Raw
 * OpenStreetMap tile subdomains (`{s}.tile.openstreetmap.org`) used to be
 * here but OSM's tile usage policy 403s exactly this kind of embedded,
 * unauthenticated traffic once it's not a one-off; CARTO's tiles are
 * explicitly free for this.
 *
 * Media upload/preview is delegated to `MediaList` (`../panels/MediaList`) —
 * the exact same multi-type (photo/video/audio/document) picker panels use,
 * reused as-is instead of the old photo-only uploader this section used to
 * build by hand (live report, 2026-09-23: "can't add multiple photos or
 * videos or ..."). It talks to the same `POST /api/bots/:botId/media`
 * upload endpoint and the same authed media proxy for previews.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2, Plus, Star, Trash2, Pencil, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { MediaList, type MediaMeta } from "../panels/MediaList";
import { ButtonBuilder } from "../panels/ButtonBuilder";
import { usePanels, usePanelCatalog } from "../panels/api";
import { buttonsToRows, rowsToButtons, type PanelButton } from "@/lib/panel-buttons";

type ContactEntryKind = "phone" | "address" | "email" | "link" | "text";
type ContactEntry = { id: string; kind: ContactEntryKind; label: string; value: string };
const CONTACT_ENTRY_KINDS: ContactEntryKind[] = ["phone", "address", "email", "link", "text"];
const MAX_CONTACT_ENTRIES = 20;

type AddressMediaItem = { type: "photo" | "video" | "audio" | "document"; file_id: string };

/** فرم‌ها برایِ انتخابگرِ دکمه‌ی «form» — آینه‌ی `PanelEditor.tsx::useFormOptions`،
 * عمداً با همان queryKey تا کش بینِ دو ویرایشگر مشترک شود. */
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

type Address = {
  id: string;
  title: string;
  text: string;
  latitude: number | null;
  longitude: number | null;
  photo_file_ids?: string[];
  /** عکس/ویدیو/صوت/فایل — همان شکلِ `Panel.settings.media_items`. سرور برایِ
   * رکوردهایِ قدیمی این را از `photo_file_ids` بازمی‌سازد، پس اینجا همیشه
   * منبعِ حقیقت است (نگاه کن `addressStore.ts::withMediaFallback`). */
  media_items?: AddressMediaItem[];
  phone?: string;
  plus_code?: string;
  map_url?: string;
  hours_note?: string;
  is_default?: boolean;
  is_active?: boolean;
  /** دقیقاً همان شکلِ `Panel.buttons` — `ButtonBuilder.tsx` بدونِ هیچ تغییری
   * اینجا هم استفاده می‌شود (لایوباگ ۲۰۲۶-۰۹-۲۳: «قابلیتِ دکمه‌زدن مثلِ
   * پنل‌ها رو نداره»). */
  buttons?: PanelButton[];
  /** IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT پیگیری — لیستِ آزادِ
   *  شماره‌هایِ اضافی/ایمیل/لینک/یادداشت، ادغام‌شده از نوعِ پنلِ رایگانِ
   *  contact_info به داخلِ همینِ پلاگین. */
  contact_entries?: ContactEntry[];
};

const DEFAULT_CENTER: [number, number] = [35.7219, 51.3347]; // تهران

const MAP_PROVIDERS = ["google", "neshan", "balad"] as const;
type MapProvider = (typeof MAP_PROVIDERS)[number];

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

// Leaflet's default marker icon references image files by a relative URL
// that Vite's bundler doesn't resolve — every consumer of vanilla Leaflet
// hits this. Rebuilding the icon from the bundled assets is the standard
// fix (no CDN, keeping the "no API key, no external service" requirement).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const DEFAULT_ICON = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/** یک نقشه‌ی لیفلت + یک مارکرِ قابل‌کشیدن/کلیک؛ مختصات فقط از این طریق تغییر می‌کند.
 * `focusToken`: یک شمارنده که فقط برایِ جهش‌هایِ برنامه‌ای (مثلاً دکمه‌ی «موقعیت
 * من») افزایش می‌یابد — کلیک/کشیدنِ دستی عمداً نقشه را دوباره پن/زوم نمی‌کند
 * (وسطِ تعاملِ کاربر، پرش‌ناگهانیِ نما گیج‌کننده است). */
function MapPicker({
  lat, lng, onChange, focusToken,
}: { lat: number; lng: number; onChange: (lat: number, lng: number) => void; focusToken?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // زومِ ۱۴ (سطحِ محله) برایِ گذاشتنِ دقیقِ پین خیلی درشت بود — لایوباگِ
    // ۲۰۲۶-۰۹-۲۳ («مسیریابی از موقعیتِ خودم نمی‌ره») نشون داد که پینِ ذخیره‌شده
    // گاهی همون مرکزِ پیش‌فرضِ تهران بوده، چون ادمین اصلاً لمسش نکرده بود؛ زومِ
    // ۱۶ (سطحِ خیابون) این خطا را برایِ کلیکِ اول هم کمتر محتمل می‌کند.
    const map = L.map(containerRef.current).setView([lat || DEFAULT_CENTER[0], lng || DEFAULT_CENTER[1]], 16);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);

    const marker = L.marker([lat || DEFAULT_CENTER[0], lng || DEFAULT_CENTER[1]], { draggable: true, icon: DEFAULT_ICON })
      .addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onChange(pos.lat, pos.lng);
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChange(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // یک تغییرِ بیرونی (مثلاً پاک‌شدن فرم) باید مارکر را هم جابه‌جا کند، بدون
  // اینکه کل نقشه دوباره ساخته شود.
  useEffect(() => {
    if (markerRef.current && lat && lng) markerRef.current.setLatLng([lat, lng]);
  }, [lat, lng]);

  // فقط جهش‌هایِ برنامه‌ای (دکمه‌ی «موقعیت من») نما را هم پن/زوم می‌کنند.
  useEffect(() => {
    if (focusToken === undefined || focusToken === 0 || !mapRef.current) return;
    mapRef.current.flyTo([lat, lng], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  return <div ref={containerRef} className="h-72 w-full rounded-md border" />;
}


function AddressEditor({
  botId, address, onClose,
}: { botId: string; address: Address | null; onClose: () => void }) {
  const t = useT("botAddresses");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState(address?.title ?? "");
  const [text, setText] = useState(address?.text ?? "");
  const [hasLocation, setHasLocation] = useState(address?.latitude != null && address?.longitude != null);
  const [lat, setLat] = useState(address?.latitude ?? DEFAULT_CENTER[0]);
  const [lng, setLng] = useState(address?.longitude ?? DEFAULT_CENTER[1]);
  // لایوباگ ۲۰۲۶-۰۹-۲۳: بدونِ این، ادمین می‌توانست hasLocation را روشن کند و
  // بدونِ لمسِ نقشه ذخیره کند — پینِ پیش‌فرض (مرکزِ تهران) بی‌صدا به‌عنوانِ
  // موقعیتِ واقعی ذخیره می‌شد. یک آدرسِ موجود که از قبل مختصاتِ واقعی داشت
  // «لمس‌شده» فرض می‌شود؛ آدرسِ تازه یا لوکیشنِ تازه‌روشن‌شده نه.
  const [locationTouched, setLocationTouched] = useState(address?.latitude != null && address?.longitude != null);
  const [locatingSelf, setLocatingSelf] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [phone, setPhone] = useState(address?.phone ?? "");
  const [hoursNote, setHoursNote] = useState(address?.hours_note ?? "");
  const [plusCode, setPlusCode] = useState(address?.plus_code ?? "");
  const [isDefault, setIsDefault] = useState(address?.is_default ?? false);
  const [media, setMedia] = useState<string[]>((address?.media_items ?? []).map((it) => it.file_id));
  const [mediaMeta, setMediaMeta] = useState<Record<string, MediaMeta>>(() => {
    const out: Record<string, MediaMeta> = {};
    for (const it of address?.media_items ?? []) out[it.file_id] = { kind: it.type, duration: null };
    return out;
  });
  const [contactEntries, setContactEntries] = useState<ContactEntry[]>(address?.contact_entries ?? []);
  const [rows, setRows] = useState<PanelButton[][]>(() => buttonsToRows(address?.buttons ?? []));
  const { data: panelsData } = usePanels(botId);
  const panels = panelsData?.panels ?? [];
  const { data: formsData } = useFormOptions(botId);
  const forms = formsData ?? [];
  const { data: catalog } = usePanelCatalog(botId);

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast({ variant: "destructive", title: t.geolocationUnsupported });
      return;
    }
    setLocatingSelf(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLocationTouched(true);
        setFocusToken((x) => x + 1);
        setLocatingSelf(false);
      },
      () => {
        toast({ variant: "destructive", title: t.geolocationFailed });
        setLocatingSelf(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title, text,
        latitude: hasLocation ? lat : null,
        longitude: hasLocation ? lng : null,
        phone, hours_note: hoursNote, plus_code: plusCode, is_default: isDefault,
        media_items: media.map((fileId) => ({
          type: mediaMeta[fileId]?.kind && mediaMeta[fileId].kind !== "unknown" ? mediaMeta[fileId].kind : "photo",
          file_id: fileId,
        })),
        contact_entries: contactEntries,
        buttons: rowsToButtons(rows),
      };
      return address
        ? customFetch(`/api/bots/${botId}/addresses/${address.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/addresses`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-addresses", botId] });
      toast({ title: address ? t.addressUpdated : t.addressCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{address ? t.editAddress : t.newAddress}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t.fieldTitle}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            <p className="text-xs text-muted-foreground">{t.fieldTitleHint}</p>
          </div>
          <div className="space-y-1">
            <Label>{t.fieldText}</Label>
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          </div>

          <div className="space-y-1 rounded-md border p-3">
            <div className="flex items-center gap-3">
              <Switch checked={hasLocation} onCheckedChange={setHasLocation} />
              <span>{t.fieldLocationToggle}</span>
            </div>
            {hasLocation && (
              <div className="space-y-1 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{t.mapHelp}</p>
                  <Button
                    type="button" variant="outline" size="sm"
                    disabled={locatingSelf}
                    onClick={useMyLocation}
                  >
                    {locatingSelf ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
                    {locatingSelf ? t.locatingSelf : t.useMyLocationCta}
                  </Button>
                </div>
                <MapPicker
                  lat={lat} lng={lng} focusToken={focusToken}
                  onChange={(a, b) => { setLat(a); setLng(b); setLocationTouched(true); }}
                />
                <p dir="ltr" className="text-xs text-muted-foreground">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
                {!locationTouched && (
                  <p className="text-xs text-destructive">{t.locationNotPlacedWarning}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t.fieldPhone}</Label>
              <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldPlusCode}</Label>
              <Input dir="ltr" value={plusCode} onChange={(e) => setPlusCode(e.target.value)} maxLength={32} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t.fieldHoursNote}</Label>
            <Input value={hoursNote} onChange={(e) => setHoursNote(e.target.value)} maxLength={300} />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1">
              <Label>{t.fieldContactEntries}</Label>
              <p className="text-xs text-muted-foreground">{t.fieldContactEntriesHint}</p>
            </div>
            <div className="space-y-3">
              {contactEntries.map((entry, i) => (
                <div key={entry.id} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[140px_1fr_1fr_auto]">
                  <Select
                    value={entry.kind}
                    onValueChange={(v) =>
                      setContactEntries(contactEntries.map((e, j) => (j === i ? { ...e, kind: v as ContactEntryKind } : e)))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTACT_ENTRY_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>{t[`contactEntryKind_${k}` as keyof typeof t] as string}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={t.contactEntryLabelPlaceholder}
                    value={entry.label}
                    onChange={(e) =>
                      setContactEntries(contactEntries.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)))
                    }
                  />
                  <Input
                    dir={entry.kind === "link" ? "ltr" : undefined}
                    placeholder={entry.kind === "link" ? "https://…" : t.contactEntryValuePlaceholder}
                    value={entry.value}
                    onChange={(e) =>
                      setContactEntries(contactEntries.map((it, j) => (j === i ? { ...it, value: e.target.value } : it)))
                    }
                  />
                  <Button
                    type="button" variant="ghost" size="icon"
                    aria-label={t.contactEntryRemove}
                    onClick={() => setContactEntries(contactEntries.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button" variant="outline" size="sm"
              disabled={contactEntries.length >= MAX_CONTACT_ENTRIES}
              onClick={() =>
                setContactEntries([...contactEntries, { id: crypto.randomUUID(), kind: "phone", label: "", value: "" }])
              }
            >
              <Plus className="me-1.5 size-4" /> {t.contactEntryAddCta}
            </Button>
            {contactEntries.length >= MAX_CONTACT_ENTRIES && (
              <p className="text-xs text-muted-foreground">{t.contactEntryMaxReached}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t.fieldPhoto}</Label>
            <MediaList botId={botId} fileIds={media} multiple onChange={setMedia} onMetaChange={setMediaMeta} />
          </div>

          <div className="space-y-1.5">
            <Label>{t.fieldButtons}</Label>
            <p className="text-xs text-muted-foreground">{t.fieldButtonsHint}</p>
            <ButtonBuilder botId={botId} rows={rows} panels={panels} forms={forms} catalog={catalog} onChange={setRows} />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <span>{t.fieldIsDefault}</span>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !title.trim() || (hasLocation && !locationTouched)}
          >
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddressesSection({ bot }: { bot: Bot }) {
  const t = useT("botAddresses");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Address | null | "new">(null);

  const key = ["bot-addresses", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ addresses: Address[] }>(`/api/bots/${bot.id}/addresses`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/address`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.addressDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      customFetch(`/api/bots/${bot.id}/addresses/${id}`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const configKey = ["bot-address-config", bot.id] as const;
  const configQuery = useQuery({
    queryKey: configKey,
    queryFn: () => customFetch<{ config: { map_provider: MapProvider } }>(`/api/bots/${bot.id}/addresses/settings`),
    enabled: !error,
  });
  const saveProvider = useMutation({
    mutationFn: (map_provider: MapProvider) =>
      customFetch(`/api/bots/${bot.id}/addresses/settings`, { method: "PUT", body: JSON.stringify({ map_provider }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: configKey }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <MapPin className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activate.isPending ? t.activating : t.activatePlugin}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const addresses = data?.addresses ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t.mapProviderLabel}</Label>
          <Select
            value={configQuery.data?.config.map_provider ?? "google"}
            onValueChange={(v) => saveProvider.mutate(v as MapProvider)}
          >
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAP_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>{t[`mapProvider_${p}` as keyof typeof t] as string}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="me-1.5 size-4" /> {t.newAddress}
        </Button>
      </div>

      {addresses.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noAddresses}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {addresses.map((addr) => (
            <Card key={addr.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      <MapPin className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{addr.title}</span>
                      {addr.is_default && <Badge variant="outline"><Star className="me-1 size-3" />{t.defaultBadge}</Badge>}
                    </div>
                    {addr.text && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{addr.text}</p>}
                    {addr.phone && (
                      <p dir="ltr" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="size-3" /> {addr.phone}
                      </p>
                    )}
                  </div>
                  <Switch checked={addr.is_active ?? true} onCheckedChange={(v) => toggleActive.mutate({ id: addr.id, is_active: v })} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(addr)}>
                    <Pencil className="me-1.5 size-3.5" /> {t.edit}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(addr.id)} disabled={remove.isPending}>
                    <Trash2 className="me-1.5 size-3.5" /> {t.delete}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <AddressEditor
          botId={bot.id}
          address={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
