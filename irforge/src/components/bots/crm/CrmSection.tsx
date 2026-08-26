/**
 * CrmSection.tsx — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Tag catalog + per-user tag assignment/notes for the `crm` plugin. The
 * generic `PluginCollectionTable` could show the tag catalog as a flat CRUD
 * table, but assignment was structurally impossible there (the join table's
 * id is a deterministic `<user_id>:<tag_id>` composite key, and the generic
 * system only ever generates a random id) — see `lib/crmStore.ts`'s header
 * comment. User lookup reuses the existing bot-users search endpoint
 * (`UsersSection.tsx`'s own data source) rather than duplicating it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Contact, Loader2, Plus, Trash2, Pencil, Search, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type CrmTag = { id: string; name: string; emoji: string; description: string; memberCount: number };
type CrmNote = { id: string; body: string; author_id: string; created_at?: string };
type UserSummary = { user_id: string; username: string; first_name: string; last_name: string };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function displayName(u: UserSummary): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || (u.username ? `@${u.username}` : u.user_id);
}

function TagEditor({
  botId, tag, onClose,
}: { botId: string; tag: CrmTag | null; onClose: () => void }) {
  const t = useT("botCrm");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(tag?.name ?? "");
  const [emoji, setEmoji] = useState(tag?.emoji ?? "🏷");
  const [description, setDescription] = useState(tag?.description ?? "");

  const save = useMutation({
    mutationFn: () => {
      const body = { name, emoji, description };
      return tag
        ? customFetch(`/api/bots/${botId}/crm/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/crm/tags`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-crm-tags", botId] });
      toast({ title: tag ? t.tagUpdated : t.tagCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{tag ? t.editTag : t.newTag}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[5rem_1fr] gap-3">
            <div className="space-y-1">
              <Label>{t.fieldEmoji}</Label>
              <Input dir="ltr" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.fieldTagName}</Label>
              <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.fieldDescription}</Label>
            <Textarea rows={2} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserProfilePanel({ botId, user }: { botId: string; user: UserSummary }) {
  const t = useT("botCrm");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");
  const [addingTagId, setAddingTagId] = useState("");

  const profileKey = ["bot-crm-user", botId, user.user_id] as const;
  const { data, isLoading } = useQuery({
    queryKey: profileKey,
    queryFn: () => customFetch<{ tags: CrmTag[]; notes: CrmNote[] }>(`/api/bots/${botId}/crm/users/${user.user_id}`),
  });

  const { data: allTagsData } = useQuery({
    queryKey: ["bot-crm-tags", botId],
    queryFn: () => customFetch<{ tags: CrmTag[] }>(`/api/bots/${botId}/crm/tags`),
  });

  const assign = useMutation({
    mutationFn: (tagId: string) =>
      customFetch(`/api/bots/${botId}/crm/users/${user.user_id}/tags`, { method: "POST", body: JSON.stringify({ tag_id: tagId }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKey }); qc.invalidateQueries({ queryKey: ["bot-crm-tags", botId] }); setAddingTagId(""); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const unassign = useMutation({
    mutationFn: (tagId: string) => customFetch(`/api/bots/${botId}/crm/users/${user.user_id}/tags/${tagId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKey }); qc.invalidateQueries({ queryKey: ["bot-crm-tags", botId] }); },
  });

  const addNote = useMutation({
    mutationFn: () => customFetch(`/api/bots/${botId}/crm/users/${user.user_id}/notes`, { method: "POST", body: JSON.stringify({ body: noteBody }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKey }); setNoteBody(""); toast({ title: t.noteAdded }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) => customFetch(`/api/bots/${botId}/crm/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKey }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  const userTagIds = new Set((data?.tags ?? []).map((tg) => tg.id));
  const assignableTags = (allTagsData?.tags ?? []).filter((tg) => !userTagIds.has(tg.id));

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="font-medium">{displayName(user)}</p>
          <p dir="ltr" className="text-xs text-muted-foreground">{user.user_id}{user.username ? ` · @${user.username}` : ""}</p>
        </div>

        <div className="space-y-2">
          <Label>{t.userTags}</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {(data?.tags ?? []).length === 0 && <span className="text-xs text-muted-foreground">{t.noTagsYet}</span>}
            {(data?.tags ?? []).map((tg) => (
              <Badge key={tg.id} variant="outline" className="gap-1">
                {tg.emoji} {tg.name}
                <button type="button" aria-label={t.removeTag} onClick={() => unassign.mutate(tg.id)}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          {assignableTags.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={addingTagId || "__none__"} onValueChange={(v) => { setAddingTagId(v); if (v !== "__none__") assign.mutate(v); }}>
                <SelectTrigger className="w-48"><SelectValue placeholder={t.addTag} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.addTag}</SelectItem>
                  {assignableTags.map((tg) => <SelectItem key={tg.id} value={tg.id}>{tg.emoji} {tg.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {assign.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t.userNotes}</Label>
          <div className="space-y-2">
            {(data?.notes ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t.noNotesYet}</p>}
            {(data?.notes ?? []).map((note) => (
              <div key={note.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/40 p-2 text-sm">
                <p className="min-w-0 whitespace-pre-wrap">{note.body}</p>
                <Button size="icon" variant="ghost" className="shrink-0" onClick={() => deleteNote.mutate(note.id)}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Textarea rows={2} value={noteBody} maxLength={1000} onChange={(e) => setNoteBody(e.target.value)} placeholder={t.noteBodyPlaceholder} />
            <Button size="sm" onClick={() => addNote.mutate()} disabled={!noteBody.trim() || addNote.isPending}>
              {addNote.isPending ? <Loader2 className="size-4 animate-spin" /> : t.addNote}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UserSearch({ botId }: { botId: string }) {
  const t = useT("botCrm");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UserSummary | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["bot-crm-user-search", botId, query],
    queryFn: () => customFetch<{ users: UserSummary[] }>(`/api/bots/${botId}/bot-users?search=${encodeURIComponent(query)}&limit=8`),
    enabled: query.trim().length >= 2,
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="ps-8" value={query} placeholder={t.searchUsersPlaceholder}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        />
      </div>

      {isFetching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>}

      {!selected && (data?.users?.length ?? 0) > 0 && (
        <div className="space-y-1">
          {data!.users.map((u) => (
            <button
              key={u.user_id} type="button" onClick={() => setSelected(u)}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-sm hover:bg-muted"
            >
              <span>{displayName(u)}</span>
              <span dir="ltr" className="text-xs text-muted-foreground">{u.user_id}</span>
            </button>
          ))}
        </div>
      )}

      {!selected && query.trim().length >= 2 && !isFetching && (data?.users?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">{t.noUsersFound}</p>
      )}

      {selected && (
        <div className="space-y-2">
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>{t.backToSearch}</Button>
          <UserProfilePanel botId={botId} user={selected} />
        </div>
      )}
    </div>
  );
}

export function CrmSection({ bot }: { bot: Bot }) {
  const t = useT("botCrm");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingTag, setEditingTag] = useState<CrmTag | null | "new">(null);

  const tagsKey = ["bot-crm-tags", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: tagsKey,
    queryFn: () => customFetch<{ tags: CrmTag[] }>(`/api/bots/${bot.id}/crm/tags`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/crm`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: tagsKey }); },
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/crm/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tagsKey }); toast({ title: t.tagDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Contact className="size-8 text-muted-foreground" />
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

  const tags = data?.tags ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t.tagsSectionTitle}</p>
          <Button size="sm" onClick={() => setEditingTag("new")}>
            <Plus className="me-1.5 size-4" /> {t.newTag}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t.tagsSectionDesc}</p>

        {tags.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.noTagsAtAll}</p>
        ) : (
          <div className="space-y-2">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-lg">{tag.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{tag.name}</p>
                    {tag.description && <p className="truncate text-xs text-muted-foreground">{tag.description}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">
                    <Tag className="me-1 size-3" /> {tag.memberCount.toLocaleString("fa-IR")}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => setEditingTag(tag)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteTag.mutate(tag.id)}><Trash2 className="size-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">{t.usersSectionTitle}</p>
        <p className="text-xs text-muted-foreground">{t.usersSectionDesc}</p>
        <UserSearch botId={bot.id} />
      </div>

      {editingTag && (
        <TagEditor botId={bot.id} tag={editingTag === "new" ? null : editingTag} onClose={() => setEditingTag(null)} />
      )}
    </div>
  );
}
