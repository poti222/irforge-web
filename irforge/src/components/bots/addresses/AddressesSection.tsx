/**
 * AddressesSection.tsx — IRFORGE_PROMPT_V3 Phase 18
 * ─────────────────────────────────────────────────────────────────────────────
 * List + editor for the new `address` plugin. The editor's map picker is
 * built on Leaflet + OpenStreetMap tiles — no API key, no billing account,
 * works from Iran (unlike the Google Maps JS SDK) — per the phase spec.
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

type Address = {
  id: string;
  title: string;
  text: string;
  latitude: number;
  longitude: number;
  photo_file_id?: string;
  phone?: string;
  plus_code?: string;
  map_url?: string;
  hours_note?: string;
  is_default?: boolean;
  is_active?: boolean;
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
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

function AddressEditor({
  botId, address, onClose,
}: { botId: string; address: Address | null; onClose: () => void }) {
  const t = useT("botAddresses");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState(address?.title ?? "");
  const [text, setText] = useState(address?.text ?? "");
  const [lat, setLat] = useState(address?.latitude ?? DEFAULT_CENTER[0]);
  const [lng, setLng] = useState(address?.longitude ?? DEFAULT_CENTER[1]);
  const [phone, setPhone] = useState(address?.phone ?? "");
  const [hoursNote, setHoursNote] = useState(address?.hours_note ?? "");
  const [plusCode, setPlusCode] = useState(address?.plus_code ?? "");
  const [isDefault, setIsDefault] = useState(address?.is_default ?? false);
  const [photoFileId, setPhotoFileId] = useState(address?.photo_file_id ?? "");
  const [uploading, setUploading] = useState(false);

  async function handlePhoto(file: File) {
    setUploading(true);
    try {
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
      setPhotoFileId(result.fileId);
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) });
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title, text, latitude: lat, longitude: lng, phone,
        hours_note: hoursNote, plus_code: plusCode, is_default: isDefault,
        photo_file_id: photoFileId,
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
          </div>
          <div className="space-y-1">
            <Label>{t.fieldText}</Label>
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          </div>

          <div className="space-y-1">
            <Label>{t.fieldMap}</Label>
            <p className="text-xs text-muted-foreground">{t.mapHelp}</p>
            <MapPicker lat={lat} lng={lng} onChange={(a, b) => { setLat(a); setLng(b); }} />
            <p dir="ltr" className="text-xs text-muted-foreground">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
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

          <div className="space-y-1">
            <Label>{t.fieldPhoto}</Label>
            <div className="flex items-center gap-3">
              {photoFileId && (
                <img
                  src={`/api/bots/${botId}/media/${photoFileId}`}
                  alt=""
                  className="h-16 w-16 rounded-md border object-cover"
                />
              )}
              <Input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); }}
              />
              {uploading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <span>{t.fieldIsDefault}</span>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !title.trim() || !text.trim() || uploading}
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
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{addr.text}</p>
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
