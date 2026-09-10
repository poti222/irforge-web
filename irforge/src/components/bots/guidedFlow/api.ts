/**
 * guidedFlow/api.ts — هوک‌های react-query برای اندپوینت‌های `routes/guidedFlow.ts`.
 * همان الگویِ `panels/api.ts` — `customFetch` مستقیم، نه کلاینتِ orval (این
 * مسیرها هنوز در `openapi.yaml` نیستند، دقیقاً مثلِ پنل‌ها/بوکینگ/دریپ).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { PanelButton } from "@/lib/panel-buttons";

export type FlowOption = { label: string; value: string };

export type FlowMediaItem = {
  type: "photo" | "video" | "animation" | "document";
  file_id: string;
  caption?: string;
};

export type StepType = "question" | "result";

/** شرطِ تخت یا گروهِ تودرتویِ AND/OR/NOT — همان فرمتی که
 * `utils/workflow_engine.py::_node_from_config` سمتِ بات می‌فهمد. */
export type ConditionLeaf = { field: string; operator: string; value: string };
export type ConditionGroup = { logic: "and" | "or"; conditions: FlowCondition[] };
export type FlowCondition = ConditionLeaf | ConditionGroup | Record<string, never>;

export function isConditionGroup(c: FlowCondition): c is ConditionGroup {
  return typeof c === "object" && c !== null && "logic" in c && Array.isArray((c as ConditionGroup).conditions);
}

export type GuidedFlow = {
  id: string;
  title: string;
  start_step_id: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type GuidedFlowStep = {
  id: string;
  flow_id: string;
  step_type: StepType;
  question_text: string;
  options: FlowOption[];
  media: FlowMediaItem[];
  body_html: string;
  buttons: PanelButton[];
  default_to_step_id: string;
  created_at?: string;
  updated_at?: string;
};

export type GuidedFlowTransition = {
  id: string;
  from_step_id: string;
  to_step_id: string;
  condition: FlowCondition;
  priority: number;
  created_at?: string;
  updated_at?: string;
};

export type FlowStats = { sessions: number; completed: number };

export function apiErrorMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

export function apiErrorCode(err: any): string | null {
  return err?.data?.code ?? null;
}

const flowsKey = (botId: string) => ["guided-flows", botId] as const;
const stepsKey = (botId: string, flowId: string) => ["guided-flow-steps", botId, flowId] as const;
const transitionsKey = (botId: string, stepId: string) => ["guided-flow-transitions", botId, stepId] as const;
const statsKey = (botId: string, flowId: string) => ["guided-flow-stats", botId, flowId] as const;

// ── گفت‌وگوها ────────────────────────────────────────────────────────────

export function useGuidedFlows(botId: string) {
  return useQuery({
    queryKey: flowsKey(botId),
    queryFn: () => customFetch<{ flows: GuidedFlow[] }>(`/api/bots/${botId}/guided-flow/flows`),
  });
}

export function useGuidedFlowStats(botId: string, flowId: string | null) {
  return useQuery({
    queryKey: statsKey(botId, flowId ?? ""),
    queryFn: () => customFetch<{ stats: FlowStats }>(`/api/bots/${botId}/guided-flow/flows/${flowId}/stats`),
    enabled: Boolean(flowId),
  });
}

export function useCreateGuidedFlow(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      customFetch<{ flow: GuidedFlow }>(`/api/bots/${botId}/guided-flow/flows`, {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowsKey(botId) }),
  });
}

export function useUpdateGuidedFlow(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flowId, patch }: { flowId: string; patch: Partial<Pick<GuidedFlow, "title" | "start_step_id" | "is_active">> }) =>
      customFetch<{ flow: GuidedFlow }>(`/api/bots/${botId}/guided-flow/flows/${flowId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowsKey(botId) }),
  });
}

export function useDeleteGuidedFlow(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flowId: string) =>
      customFetch<{ removed: boolean }>(`/api/bots/${botId}/guided-flow/flows/${flowId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: flowsKey(botId) }),
  });
}

// ── گام‌ها ───────────────────────────────────────────────────────────────

export function useGuidedFlowSteps(botId: string, flowId: string | null) {
  return useQuery({
    queryKey: stepsKey(botId, flowId ?? ""),
    queryFn: () => customFetch<{ steps: GuidedFlowStep[] }>(`/api/bots/${botId}/guided-flow/flows/${flowId}/steps`),
    enabled: Boolean(flowId),
  });
}

export type StepInput = {
  step_type: StepType;
  question_text?: string;
  options?: FlowOption[];
  media?: FlowMediaItem[];
  body_html?: string;
  buttons?: PanelButton[];
  default_to_step_id?: string;
};

function useInvalidateSteps(botId: string, flowId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: stepsKey(botId, flowId) });
    qc.invalidateQueries({ queryKey: flowsKey(botId) }); // start_step_id ممکن است پاک شده باشد
  };
}

export function useCreateGuidedFlowStep(botId: string, flowId: string) {
  const invalidate = useInvalidateSteps(botId, flowId);
  return useMutation({
    mutationFn: (input: StepInput) =>
      customFetch<{ step: GuidedFlowStep }>(`/api/bots/${botId}/guided-flow/flows/${flowId}/steps`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateGuidedFlowStep(botId: string, flowId: string) {
  const invalidate = useInvalidateSteps(botId, flowId);
  return useMutation({
    mutationFn: ({ stepId, patch }: { stepId: string; patch: Partial<StepInput> }) =>
      customFetch<{ step: GuidedFlowStep }>(`/api/bots/${botId}/guided-flow/steps/${stepId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteGuidedFlowStep(botId: string, flowId: string) {
  const invalidate = useInvalidateSteps(botId, flowId);
  return useMutation({
    mutationFn: (stepId: string) =>
      customFetch<{ removed: boolean }>(`/api/bots/${botId}/guided-flow/steps/${stepId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ── یال‌ها (transitions) ─────────────────────────────────────────────────

export function useGuidedFlowTransitions(botId: string, stepId: string | null) {
  return useQuery({
    queryKey: transitionsKey(botId, stepId ?? ""),
    queryFn: () => customFetch<{ transitions: GuidedFlowTransition[] }>(`/api/bots/${botId}/guided-flow/steps/${stepId}/transitions`),
    enabled: Boolean(stepId),
  });
}

export function useCreateGuidedFlowTransition(botId: string, stepId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { to_step_id: string; condition: FlowCondition; priority: number }) =>
      customFetch<{ transition: GuidedFlowTransition }>(`/api/bots/${botId}/guided-flow/steps/${stepId}/transitions`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: transitionsKey(botId, stepId) }),
  });
}

export function useUpdateGuidedFlowTransition(botId: string, stepId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ transitionId, patch }: { transitionId: string; patch: Partial<{ to_step_id: string; condition: FlowCondition; priority: number }> }) =>
      customFetch<{ transition: GuidedFlowTransition }>(`/api/bots/${botId}/guided-flow/transitions/${transitionId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: transitionsKey(botId, stepId) }),
  });
}

export function useDeleteGuidedFlowTransition(botId: string, stepId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transitionId: string) =>
      customFetch<{ removed: boolean }>(`/api/bots/${botId}/guided-flow/transitions/${transitionId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: transitionsKey(botId, stepId) }),
  });
}
