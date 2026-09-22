/**
 * GameServersSection.tsx — IRFORGE_CS2_RCON_PLUGIN_PROMPT Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * List + editor for the `gameserver_cs2` plugin's registered CS2 (Source
 * engine) servers. Structurally a stripped-down `AddressesSection.tsx` (same
 * list/Dialog-editor shape, same plugin-disabled CTA, same mutation
 * conventions) — no map picker, no photo upload, none of that applies here.
 *
 * The one thing genuinely specific to this section: the RCON password field
 * is ALWAYS rendered empty, even when editing an existing server — the
 * server never sends a password back (see lib/gameServerStore.ts), so there
 * is nothing to prefill. Leaving it blank on an edit means "keep the
 * current password", which `parseServerInput`'s partial-update path on the
 * backend already implements; only a non-empty value here ever overwrites it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Gamepad2, Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type GameServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  hasRconPassword: boolean;
  is_active?: boolean;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function ServerEditor({
  botId, server, onClose,
}: { botId: string; server: GameServer | null; onClose: () => void }) {
  const t = useT("botGameServers");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [label, setLabel] = useState(server?.label ?? "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(server ? String(server.port) : "27015");
  // Always starts empty -- the backend never sends a password back, and an
  // empty value on an update means "keep the current one" (see module docstring).
  const [rconPassword, setRconPassword] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { label, host, port: Number(port) };
      if (rconPassword) body.rconPassword = rconPassword;
      return server
        ? customFetch(`/api/bots/${botId}/gameservers/${server.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/gameservers`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-gameservers", botId] });
      toast({ title: server ? t.serverUpdated : t.serverCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const portNum = Number(port);
  const canSave = label.trim() && host.trim() && Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535
    && (server ? true : rconPassword.length > 0);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? t.editServer : t.newServer}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t.fieldLabel}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
            <p className="text-xs text-muted-foreground">{t.fieldLabelHint}</p>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <div className="space-y-1">
              <Label>{t.fieldHost}</Label>
              <Input dir="ltr" value={host} onChange={(e) => setHost(e.target.value)} maxLength={255} />
              <p className="text-xs text-muted-foreground">{t.fieldHostHint}</p>
            </div>
            <div className="w-28 space-y-1">
              <Label>{t.fieldPort}</Label>
              <Input
                dir="ltr" type="number" min={1} max={65535}
                value={port} onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.fieldRconPassword}</Label>
            <Input
              dir="ltr" type="password" autoComplete="new-password"
              placeholder={t.fieldRconPasswordPlaceholder}
              value={rconPassword} onChange={(e) => setRconPassword(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {server ? t.fieldRconPasswordHintEdit : t.fieldRconPasswordHintNew}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !canSave}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GameServersSection({ bot }: { bot: Bot }) {
  const t = useT("botGameServers");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<GameServer | null | "new">(null);

  const key = ["bot-gameservers", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ servers: GameServer[] }>(`/api/bots/${bot.id}/gameservers`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/gameserver_cs2`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/gameservers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.serverDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      customFetch(`/api/bots/${bot.id}/gameservers/${id}`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Gamepad2 className="size-8 text-muted-foreground" />
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

  const servers = data?.servers ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="me-1.5 size-4" /> {t.newServer}
        </Button>
      </div>

      {servers.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noServers}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {servers.map((server) => (
            <Card key={server.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Gamepad2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{server.label}</span>
                      <Badge variant={server.is_active ?? true ? "outline" : "secondary"}>
                        {server.is_active ?? true ? t.statusActive : t.statusInactive}
                      </Badge>
                    </div>
                    <p dir="ltr" className="mt-1 text-xs text-muted-foreground">{server.host}:{server.port}</p>
                  </div>
                  <Switch
                    checked={server.is_active ?? true}
                    onCheckedChange={(v) => toggleActive.mutate({ id: server.id, is_active: v })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(server)}>
                    <Pencil className="me-1.5 size-3.5" /> {t.edit}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(server.id)} disabled={remove.isPending}>
                    <Trash2 className="me-1.5 size-3.5" /> {t.delete}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <ServerEditor
          botId={bot.id}
          server={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
