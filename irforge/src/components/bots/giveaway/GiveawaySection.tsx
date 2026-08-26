/**
 * GiveawaySection.tsx — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * List + editor + entrant/winner drill-down for the `giveaway` plugin. The
 * generic `PluginCollectionTable` showed entrants as one flat, unfiltered
 * list across every campaign and had no field for winner_ids at all, so a
 * drawn winner was invisible on the site — see `lib/giveawayStore.ts`'s
 * header comment. The draw itself stays bot-only; this section only
 * defines/edits pre-draw fields and reads entrants/winners.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Gift, Loader2, Plus, Trash2, Pencil, Users, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type Giveaway = {
  id: string; title: string; prize: string; description: string;
  winner_count: number; status: string; ends_at: string; require_channel: string;
  min_points: number; winner_ids: string[]; entry_count: number;
};
type Entrant = { id: string; user_id: string; username: string; created_at?: string };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

const STATUS_BADGE: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  running: "default", drawn: "secondary", canceled: "destructive", draft: "outline",
};

function GiveawayEditor({
  botId, giveaway, onClose,
}: { botId: string; giveaway: Giveaway | null; onClose: () => void }) {
  const t = useT("botGiveaway");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(giveaway?.title ?? "");
  const [prize, setPrize] = useState(giveaway?.prize ?? "");
  const [description, setDescription] = useState(giveaway?.description ?? "");
  const [winnerCount, setWinnerCount] = useState(giveaway?.winner_count ?? 1);
  const [endsAt, setEndsAt] = useState(giveaway?.ends_at ? giveaway.ends_at.slice(0, 16) : "");
  const [requireChannel, setRequireChannel] = useState(giveaway?.require_channel ?? "");
  const [minPoints, setMinPoints] = useState(giveaway?.min_points ?? 0);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title, prize, description, winner_count: winnerCount,
        ends_at: endsAt ? new Date(endsAt).toISOString() : "",
        require_channel: requireChannel, min_points: minPoints,
      };
      return giveaway
        ? customFetch(`/api/bots/${botId}/giveaways/${giveaway.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/giveaways`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-giveaways", botId] });
      toast({ title: giveaway ? t.giveawayUpdated : t.giveawayCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{giveaway ? t.editGiveaway : t.newGiveaway}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t.fieldTitle}</Label>
              <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldPrize}</Label>
              <Input value={prize} maxLength={120} onChange={(e) => setPrize(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.fieldDescription}</Label>
            <Textarea rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t.fieldWinnerCount}</Label>
              <Input type="number" dir="ltr" min={1} value={winnerCount} onChange={(e) => setWinnerCount(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldEndsAt}</Label>
              <Input type="datetime-local" dir="ltr" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t.endsAtHint}</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.fieldRequireChannel}</Label>
            <Input dir="ltr" placeholder="@channel" value={requireChannel} maxLength={80} onChange={(e) => setRequireChannel(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t.requireChannelHint}</p>
          </div>
          <div className="space-y-1">
            <Label>{t.fieldMinPoints}</Label>
            <Input type="number" dir="ltr" min={0} value={minPoints} onChange={(e) => setMinPoints(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!title.trim() || !prize.trim() || save.isPending}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntrantsDialog({ botId, giveaway, onClose }: { botId: string; giveaway: Giveaway; onClose: () => void }) {
  const t = useT("botGiveaway");
  const { data: entrantsData, isLoading: loadingEntrants } = useQuery({
    queryKey: ["bot-giveaway-entrants", botId, giveaway.id],
    queryFn: () => customFetch<{ entrants: Entrant[] }>(`/api/bots/${botId}/giveaways/${giveaway.id}/entrants`),
  });
  const { data: winnersData } = useQuery({
    queryKey: ["bot-giveaway-winners", botId, giveaway.id],
    queryFn: () => customFetch<{ winners: Entrant[] }>(`/api/bots/${botId}/giveaways/${giveaway.id}/winners`),
    enabled: giveaway.status === "drawn",
  });

  const winnerIds = new Set((winnersData?.winners ?? []).map((w) => w.user_id));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{giveaway.title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {giveaway.status === "drawn" && (
            <div className="space-y-1.5">
              <Label>{t.winnersLabel}</Label>
              {(winnersData?.winners ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noWinnersDrawn}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {winnersData!.winners.map((w) => (
                    <Badge key={w.id} variant="default" className="gap-1">
                      🏆 {w.username ? `@${w.username}` : w.user_id}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t.entrantsLabel.replace("{n}", String(entrantsData?.entrants.length ?? 0))}</Label>
            {loadingEntrants ? (
              <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>
            ) : (entrantsData?.entrants ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.noEntrantsYet}</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {entrantsData!.entrants.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
                    <span>{e.username ? `@${e.username}` : e.user_id}</span>
                    {winnerIds.has(e.user_id) && <Badge variant="outline">🏆 {t.winnerBadge}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GiveawaySection({ bot }: { bot: Bot }) {
  const t = useT("botGiveaway");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Giveaway | null | "new">(null);
  const [viewingEntrants, setViewingEntrants] = useState<Giveaway | null>(null);

  const key = ["bot-giveaways", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ giveaways: Giveaway[] }>(`/api/bots/${bot.id}/giveaways`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/giveaway`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: key }); },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/giveaways/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/giveaways/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.giveawayDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Gift className="size-8 text-muted-foreground" />
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

  const giveaways = data?.giveaways ?? [];
  const statusLabel = (s: string) => (t as any)[`status_${s}`] ?? s;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="me-1.5 size-4" /> {t.newGiveaway}
        </Button>
      </div>

      {giveaways.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noGiveaways}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {giveaways.map((g) => (
            <Card key={g.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span className="truncate">{g.title}</span>
                      <Badge variant={STATUS_BADGE[g.status] ?? "outline"}>{statusLabel(g.status)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">🎁 {g.prize}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.winnerCountLabel.replace("{n}", String(g.winner_count))} · {t.entryCountLabel.replace("{n}", String(g.entry_count))}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setViewingEntrants(g)}>
                    <Users className="me-1.5 size-3.5" /> {t.viewEntrants}
                  </Button>
                  {g.status === "running" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditing(g)}>
                        <Pencil className="me-1.5 size-3.5" /> {t.edit}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cancel.mutate(g.id)} disabled={cancel.isPending}>
                        <Ban className="me-1.5 size-3.5" /> {t.cancelGiveaway}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(g.id)} disabled={remove.isPending}>
                    <Trash2 className="me-1.5 size-3.5" /> {t.delete}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <GiveawayEditor botId={bot.id} giveaway={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
      {viewingEntrants && (
        <EntrantsDialog botId={bot.id} giveaway={viewingEntrants} onClose={() => setViewingEntrants(null)} />
      )}
    </div>
  );
}
