/**
 * RelationsSection.tsx — روابط بین آبجکت‌ها (فاز ۱۹).
 * تعریف رابطه + مدیریت لینک‌ها. رابطه‌ای که آبجکت دو سرش وجود ندارد صریح
 * «خراب» علامت می‌خورد، نه اینکه عادی نشان داده شود.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Plus, Trash2, ArrowRight, Share2, AlertTriangle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type Relation = {
  id: string;
  name: string;
  slug: string;
  type: string;
  source_object_id: string;
  target_object_id: string;
  source_label: string;
  target_label: string;
  is_active: boolean;
  linkCount: number;
  sourceObjectName: string | null;
  targetObjectName: string | null;
  broken: boolean;
};

type RelationsResponse = {
  relations: Relation[];
  objects: Array<{ id: string; name: string; slug: string }>;
  types: string[];
};

type LinksResponse = {
  relation: Relation;
  links: Array<{ id: string; source_record_id: string; target_record_id: string }>;
  sourceRecords: Array<{ id: string; label: string }>;
  targetRecords: Array<{ id: string; label: string }>;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function LinksEditor({ botId, relation, onBack }: { botId: string; relation: Relation; onBack: () => void }) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-relation-links", botId, relation.id] as const;

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<LinksResponse>(`/api/bots/${botId}/relations/${relation.id}/links`),
  });

  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");

  const create = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${botId}/relations/${relation.id}/links`, {
        method: "POST",
        body: JSON.stringify({ source_record_id: source, target_record_id: target }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setSource(""); setTarget(""); toast({ title: t.linkCreated }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });
  const remove = useMutation({
    mutationFn: (linkId: string) =>
      customFetch(`/api/bots/${botId}/relations/${relation.id}/links/${linkId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const labelOf = (list: Array<{ id: string; label: string }> | undefined, id: string) =>
    list?.find((r) => r.id === id)?.label ?? id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="me-1.5 size-4 rtl-flip" /> {t.backToList}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{relation.name}</h3>
        <Badge variant="outline">{relation.type}</Badge>
      </div>

      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t.addLink}</CardTitle>
              <CardDescription>
                {relation.sourceObjectName ?? relation.source_object_id} → {relation.targetObjectName ?? relation.target_object_id}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue placeholder={t.pickSourceRecord} /></SelectTrigger>
                <SelectContent>
                  {(data?.sourceRecords ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder={t.pickTargetRecord} /></SelectTrigger>
                <SelectContent>
                  {(data?.targetRecords ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button disabled={!source || !target || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Link2 className="me-1.5 size-4" />}
                {t.link}
              </Button>
            </CardContent>
          </Card>

          {(data?.links.length ?? 0) === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.noLinks}</p>
          ) : (
            <ul className="space-y-2">
              {data!.links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="min-w-0 truncate">{labelOf(data!.sourceRecords, link.source_record_id)}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground rtl-flip" />
                  <span className="min-w-0 truncate">{labelOf(data!.targetRecords, link.target_record_id)}</span>
                  <Button
                    variant="ghost" size="icon" aria-label={t.removeLink} className="ms-auto"
                    onClick={() => remove.mutate(link.id)} disabled={remove.isPending}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function RelationsSection({ bot }: { bot: Bot }) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-relations", bot.id] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<RelationsResponse>(`/api/bots/${bot.id}/relations`),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", slug: "", type: "many_to_many", source_object_id: "", target_object_id: "" });
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/relations`, { method: "POST", body: JSON.stringify(draft) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setCreateOpen(false);
      setDraft({ name: "", slug: "", type: "many_to_many", source_object_id: "", target_object_id: "" });
      toast({ title: t.relationCreated });
    },
    onError: (err: any) => setCreateError(errMessage(err, t.errorGeneric)),
  });

  const remove = useMutation({
    mutationFn: (relationId: string) => customFetch(`/api/bots/${bot.id}/relations/${relationId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.relationDeleted }); },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const selected = data.relations.find((r) => r.id === selectedId) ?? null;
  if (selected) return <LinksEditor botId={bot.id} relation={selected} onBack={() => setSelectedId(null)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t.relationsDesc}</p>
        <Button
          disabled={data.objects.length < 1}
          title={data.objects.length < 1 ? t.needObjectsFirst : undefined}
          onClick={() => { setCreateError(null); setCreateOpen(true); }}
        >
          <Plus className="me-1.5 size-4" /> {t.newRelation}
        </Button>
      </div>

      {data.objects.length === 0 && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t.needObjectsFirst}</p>
      )}

      {data.relations.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noRelations}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.relations.map((relation) => (
            <Card key={relation.id} className={relation.broken ? "border-destructive/40" : undefined}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Share2 className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{relation.name}</span>
                  <Badge variant="outline">{relation.type}</Badge>
                </CardTitle>
                <CardDescription>
                  {relation.sourceObjectName ?? relation.source_object_id} → {relation.targetObjectName ?? relation.target_object_id}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                {relation.broken && (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3.5" /> {t.relationBroken}
                  </span>
                )}
                <Badge variant="secondary">{t.linkCount.replace("{n}", String(relation.linkCount))}</Badge>
                <Button variant="outline" size="sm" className="ms-auto" onClick={() => setSelectedId(relation.id)}>
                  {t.manageLinks}
                </Button>
                <Button
                  variant="ghost" size="icon" aria-label={t.deleteRelation}
                  onClick={() => {
                    if (relation.linkCount > 0 && !window.confirm(t.confirmDeleteRelation.replace("{n}", String(relation.linkCount)))) return;
                    remove.mutate(relation.id);
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.newRelation}</DialogTitle>
            <DialogDescription>{t.newRelationDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rel-name">{t.relationName}</Label>
              <Input
                id="rel-name" value={draft.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setDraft((p) => ({
                    ...p, name,
                    slug: p.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
                  }));
                  setCreateError(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-slug">{t.relationSlug}</Label>
              <Input id="rel-slug" dir="ltr" value={draft.slug} onChange={(e) => setDraft((p) => ({ ...p, slug: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-type">{t.relationType}</Label>
              <Select value={draft.type} onValueChange={(v) => setDraft((p) => ({ ...p, type: v }))}>
                <SelectTrigger id="rel-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.types.map((x) => (
                    <SelectItem key={x} value={x}>{(t[`relType_${x}` as keyof typeof t] as string) ?? x}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rel-source">{t.sourceObject}</Label>
                <Select value={draft.source_object_id} onValueChange={(v) => setDraft((p) => ({ ...p, source_object_id: v }))}>
                  <SelectTrigger id="rel-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.objects.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rel-target">{t.targetObject}</Label>
                <Select value={draft.target_object_id} onValueChange={(v) => setDraft((p) => ({ ...p, target_object_id: v }))}>
                  <SelectTrigger id="rel-target"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.objects.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={!draft.name.trim() || !draft.slug.trim() || !draft.source_object_id || !draft.target_object_id || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
