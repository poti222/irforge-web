/**
 * WorkflowsSection.tsx — ورک‌فلوها (فاز ۲۰).
 *
 * ویرایشگر **گام‌به‌گام** است، نه بوم گرافیکی: یک لیست از تریگر → شرط‌ها →
 * اقدام‌ها. ساده و قابل اتکا، و دقیقاً هم‌شکل ساختاری که بات ذخیره می‌کند.
 * اقدام‌هایی که به یک پلاگین غیرفعال وابسته‌اند صریح علامت می‌خورند.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Plus, Trash2, ArrowRight, Workflow as WorkflowIcon, Save, History, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type Workflow = {
  id: string;
  name: string;
  trigger: { type: string; config: Record<string, any> };
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  actions: Array<{ type: string; params: Record<string, any> }>;
  is_active: boolean;
};

type Catalog = {
  triggerTypes: string[];
  events: string[];
  operators: string[];
  actions: Array<{
    type: string;
    label: string;
    params: Array<{ name: string; required: boolean }>;
    requiresPlugin: string | null;
    available: boolean;
  }>;
};

type Run = {
  id: string;
  workflow_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function emptyWorkflow(): Workflow {
  return {
    id: "",
    name: "",
    trigger: { type: "manual", config: {} },
    conditions: [],
    actions: [],
    is_active: true,
  };
}

function WorkflowEditor({
  botId,
  workflow,
  catalog,
  onBack,
}: {
  botId: string;
  workflow: Workflow;
  catalog: Catalog | undefined;
  onBack: () => void;
}) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Workflow>(workflow);
  const isNew = !workflow.id;

  const save = useMutation({
    mutationFn: () =>
      customFetch<{ workflow: Workflow }>(
        isNew ? `/api/bots/${botId}/workflows` : `/api/bots/${botId}/workflows/${workflow.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          body: JSON.stringify({
            name: draft.name,
            trigger: draft.trigger,
            conditions: draft.conditions,
            actions: draft.actions,
            is_active: draft.is_active,
          }),
        }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-workflows", botId] });
      toast({ title: t.workflowSaved });
      onBack();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const actionMeta = (type: string) => catalog?.actions.find((a) => a.type === type);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="me-1.5 size-4 rtl-flip" /> {t.backToList}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{draft.name || t.newWorkflow}</h3>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.stepBasics}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">{t.workflowName}</Label>
            <Input id="wf-name" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>{t.isActive}</span>
            <Switch checked={draft.is_active} onCheckedChange={(v) => setDraft((p) => ({ ...p, is_active: v }))} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.stepTrigger}</CardTitle>
          <CardDescription>{t.stepTriggerDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={draft.trigger.type}
            onValueChange={(v) => setDraft((p) => ({ ...p, trigger: { type: v, config: {} } }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(catalog?.triggerTypes ?? ["manual"]).map((x) => (
                <SelectItem key={x} value={x}>{(t[`trigger_${x}` as keyof typeof t] as string) ?? x}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {draft.trigger.type === "event" && (
            <div className="space-y-1.5">
              <Label>{t.triggerEvent}</Label>
              <Select
                value={String(draft.trigger.config.event ?? "")}
                onValueChange={(v) => setDraft((p) => ({ ...p, trigger: { ...p.trigger, config: { ...p.trigger.config, event: v } } }))}
              >
                <SelectTrigger><SelectValue placeholder={t.pickEvent} /></SelectTrigger>
                <SelectContent>
                  {(catalog?.events ?? []).map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {draft.trigger.type === "schedule" && (
            <div className="space-y-1.5">
              <Label htmlFor="wf-cron">{t.triggerCron}</Label>
              <Input
                id="wf-cron" dir="ltr" placeholder="0 9 * * *"
                value={String(draft.trigger.config.cron ?? "")}
                onChange={(e) => setDraft((p) => ({ ...p, trigger: { ...p.trigger, config: { ...p.trigger.config, cron: e.target.value } } }))}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.stepConditions}</CardTitle>
          <CardDescription>{t.stepConditionsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.conditions.map((condition, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <Input
                dir="ltr" placeholder={t.conditionField} value={condition.field}
                onChange={(e) => setDraft((p) => ({ ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, field: e.target.value } : c)) }))}
              />
              <Select
                value={condition.operator}
                onValueChange={(v) => setDraft((p) => ({ ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, operator: v } : c)) }))}
              >
                <SelectTrigger className="min-w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(catalog?.operators ?? ["eq"]).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                dir="ltr" placeholder={t.conditionValue} value={String(condition.value ?? "")}
                onChange={(e) => setDraft((p) => ({ ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)) }))}
              />
              <Button
                variant="ghost" size="icon" aria-label={t.removeCondition}
                onClick={() => setDraft((p) => ({ ...p, conditions: p.conditions.filter((_, j) => j !== i) }))}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline" size="sm"
            onClick={() => setDraft((p) => ({ ...p, conditions: [...p.conditions, { field: "", operator: "eq", value: "" }] }))}
          >
            <Plus className="me-1.5 size-4" /> {t.addCondition}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.stepActions}</CardTitle>
          <CardDescription>{t.stepActionsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.actions.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.noActions}</p>
          )}

          {draft.actions.map((action, i) => {
            const meta = actionMeta(action.type);
            return (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.actionNumber.replace("{n}", String(i + 1))}</span>
                  <Select
                    value={action.type}
                    onValueChange={(v) => setDraft((p) => ({ ...p, actions: p.actions.map((a, j) => (j === i ? { type: v, params: {} } : a)) }))}
                  >
                    <SelectTrigger className="min-w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(catalog?.actions ?? []).map((a) => (
                        <SelectItem key={a.type} value={a.type}>
                          {a.label}{!a.available ? ` — ${t.pluginDisabled}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost" size="icon" aria-label={t.removeAction} className="ms-auto"
                    onClick={() => setDraft((p) => ({ ...p, actions: p.actions.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>

                {meta && !meta.available && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {t.actionNeedsPlugin.replace("{plugin}", meta.requiresPlugin ?? "")}
                  </p>
                )}

                {(meta?.params ?? []).map((param) => (
                  <div key={param.name} className="space-y-1.5">
                    <Label htmlFor={`wf-a${i}-${param.name}`}>
                      {param.name}{param.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Input
                      id={`wf-a${i}-${param.name}`} dir="ltr"
                      value={String(action.params[param.name] ?? "")}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          actions: p.actions.map((a, j) =>
                            j === i ? { ...a, params: { ...a.params, [param.name]: e.target.value } } : a
                          ),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            );
          })}

          <Button
            variant="outline" size="sm"
            onClick={() => setDraft((p) => ({ ...p, actions: [...p.actions, { type: catalog?.actions[0]?.type ?? "send_message", params: {} }] }))}
          >
            <Plus className="me-1.5 size-4" /> {t.addAction}
          </Button>
        </CardContent>
      </Card>

      <div className="border-t pt-4">
        <Button onClick={() => save.mutate()} disabled={!draft.name.trim() || draft.actions.length === 0 || save.isPending}>
          {save.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {t.save}
        </Button>
      </div>
    </div>
  );
}

export function WorkflowsSection({ bot }: { bot: Bot }) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["bot-workflows", bot.id],
    queryFn: () => customFetch<{ workflows: Workflow[] }>(`/api/bots/${bot.id}/workflows`),
  });
  const { data: catalog } = useQuery({
    queryKey: ["bot-workflow-catalog", bot.id],
    queryFn: () => customFetch<Catalog>(`/api/bots/${bot.id}/workflow-catalog`),
    staleTime: 60_000,
  });
  const { data: runs } = useQuery({
    queryKey: ["bot-workflow-runs", bot.id],
    queryFn: () => customFetch<{ runs: Run[] }>(`/api/bots/${bot.id}/workflow-runs?limit=30`),
  });

  const [editing, setEditing] = useState<Workflow | null>(null);
  const [tab, setTab] = useState<"list" | "runs">("list");

  const toggle = useMutation({
    mutationFn: (workflowId: string) =>
      customFetch(`/api/bots/${bot.id}/workflows/${workflowId}/toggle`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot-workflows", bot.id] }),
  });
  const remove = useMutation({
    mutationFn: (workflowId: string) => customFetch(`/api/bots/${bot.id}/workflows/${workflowId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-workflows", bot.id] }); toast({ title: t.workflowDeleted }); },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  if (editing) {
    return <WorkflowEditor botId={bot.id} workflow={editing} catalog={catalog} onBack={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "runs")}>
          <TabsList>
            <TabsTrigger value="list">{t.tabWorkflows}</TabsTrigger>
            <TabsTrigger value="runs">{t.tabRuns}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setEditing(emptyWorkflow())}>
          <Plus className="me-1.5 size-4" /> {t.newWorkflow}
        </Button>
      </div>

      {tab === "list" ? (
        data.workflows.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noWorkflows}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.workflows.map((workflow) => (
              <Card key={workflow.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <WorkflowIcon className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
                    <Switch
                      checked={workflow.is_active}
                      aria-label={t.isActive}
                      onCheckedChange={() => toggle.mutate(workflow.id)}
                    />
                  </CardTitle>
                  <CardDescription>
                    {(t[`trigger_${workflow.trigger?.type}` as keyof typeof t] as string) ?? workflow.trigger?.type}
                    {workflow.trigger?.config?.event ? ` · ${workflow.trigger.config.event}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t.actionCount.replace("{n}", String(workflow.actions?.length ?? 0))}</Badge>
                  <Badge variant="outline">{t.conditionCount.replace("{n}", String(workflow.conditions?.length ?? 0))}</Badge>
                  <Button variant="outline" size="sm" className="ms-auto" onClick={() => setEditing(workflow)}>{t.edit}</Button>
                  <Button variant="ghost" size="icon" aria-label={t.deleteWorkflow} onClick={() => remove.mutate(workflow.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (runs?.runs.length ?? 0) === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noRuns}</p>
      ) : (
        <ul className="space-y-2">
          {runs!.runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
              <History className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {data.workflows.find((w) => w.id === run.workflow_id)?.name ?? run.workflow_id}
              </span>
              <Badge variant={run.status === "failed" ? "destructive" : run.status === "running" ? "secondary" : "default"}>
                {(t[`runStatus_${run.status}` as keyof typeof t] as string) ?? run.status}
              </Badge>
              <span dir="ltr" className="text-xs text-muted-foreground">{String(run.started_at ?? "").slice(0, 16).replace("T", " ")}</span>
              {run.error && <span className="min-w-0 flex-1 truncate text-xs text-destructive">{run.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
