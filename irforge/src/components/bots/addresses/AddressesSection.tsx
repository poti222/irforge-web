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
 * Photo upload reuses the existing `POST /api/bots/:botId/media` endpoint
 * (already used elsewhere for panel/broadcast media): the browser sends a
 * data-URL, the server relays it to Telegram via sendPhoto and hands back
 * the resulting file_id, which is what the bot actually needs to resend
 * the photo later — there is no local image hosting involved.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2, Plus, Star, Trash2, Pencil, Phone, X } from "lucide-react";
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
import { useAuthedBlobUrl } from "@/hooks/use-authed-media";

type ContactEntryKind = "phone" | "address" | "email" | "link" | "text";
type ContactEntry = { id: string; kind: ContactEntryKind; label: string; value: string };
const CONTACT_ENTRY_KINDS: ContactEntryKind[] = ["phone", "address", "email", "link", "text"];
const MAX_CONTACT_ENTRIES = 20;
const MAX_PHOTOS = 10;

type Address = {
  id: string;
  title: string;
  text: string;
  latitude: number | null;
  longitude: number | null;
  photo_file_ids?: string[];
  phone?: string;
  plus_code?: string;
  map_url?: string;
  hours_note?: string;
  is_default?: boolean;
  is_active?: boolean;
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

/** یک نقشه‌ی لیفلت + یک مارکرِ قابل‌کشیدن/کلیک؛ مختصات فقط از این طریق تغییر می‌کند. */
function MapPicker({
  lat, lng, onChange,
}: { lat: number; lng: number; onChange: (lat: number, lng: number) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([lat || DEFAULT_CENTER[0], lng || DEFAULT_CENTER[1]], 14);
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

  return <div ref={containerRef} className="h-72 w-full rounded-md border" />;
}

/** پیش‌نمایشِ یک عکسِ آدرس — پروکسیِ مدیا احرازهویت می‌خواهد، پس `<img
 * src>` خام نمی‌تواند مستقیم به آن اشاره کند (نگاه کن use-authed-media.ts). */
function AddressPhotoThumb({ botId, fid, onRemove, t }: { botId: string; fid: string; onRemove: () => void; t: Record<string, string> }) {
  const { url: blobSrc } = useAuthedBlobUrl(`/api/bots/${botId}/media/${fid}`);
  return (
    <div className="relative">
      {blobSrc ? (
        <img src={blobSrc} alt="" className="h-16 w-16 rounded-md border object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted/40">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <button
        type="button"
        aria-label={t.photoRemove}
        onClick={onRemove}
        className="absolute -end-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
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
  const [phone, setPhone] = useState(address?.phone ?? "");
  const [hoursNote, setHoursNote] = useState(address?.hours_note ?? "");
  const [plusCode, setPlusCode] = useState(address?.plus_code ?? "");
  const [isDefault, setIsDefault] = useState(address?.is_default ?? false);
  const [photoFileIds, setPhotoFileIds] = useState<string[]>(address?.photo_file_ids ?? []);
  const [uploading, setUploading] = useState(false);
  const [contactEntries, setContactEntries] = useState<ContactEntry[]>(address?.contact_entries ?? []);

  async function handlePhotos(files: FileList) {
    const remaining = MAX_PHOTOS - photoFileIds.length;
    if (remaining <= 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await customFetch<{ fileId: string }>(`/api/bots/${botId}/media`, {
          method: "POST",
          body: JSON.stringify({ dataUrl, filename: file.name }),
        });
        setPhotoFileIds((prev) => [...prev, result.fileId]);
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) });
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title, text,
        latitude: hasLocation ? lat : null,
        longitude: hasLocation ? lng : null,
        phone, hours_note: hoursNote, plus_code: plusCode, is_default: isDefault,
        photo_file_ids: photoFileIds, contact_entries: contactEntries,
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
                <p className="text-xs text-muted-foreground">{t.mapHelp}</p>
                <MapPicker lat={lat} lng={lng} onChange={(a, b) => { setLat(a); setLng(b); }} />
                <p dir="ltr" className="text-xs text-muted-foreground">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
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

          <div className="space-y-1">
            <Label>{t.fieldPhoto}</Label>
            <div className="flex flex-wrap items-center gap-3">
              {photoFileIds.map((fid) => (
                <AddressPhotoThumb
                  key={fid}
                  botId={botId}
                  fid={fid}
                  onRemove={() => setPhotoFileIds((prev) => prev.filter((x) => x !== fid))}
                  t={t as unknown as Record<string, string>}
                />
              ))}
              {photoFileIds.length < MAX_PHOTOS && (
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  className="w-auto"
                  onChange={(e) => { if (e.target.files?.length) handlePhotos(e.target.files); e.target.value = ""; }}
                />
              )}
              {uploading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            {photoFileIds.length >= MAX_PHOTOS && <p className="text-xs text-muted-foreground">{t.photoMaxReached}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <span>{t.fieldIsDefault}</span>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !title.trim() || uploading}
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
