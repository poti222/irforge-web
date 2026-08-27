/**
 * panels/api.ts — هوک‌های react-query برای اندپوینت‌های `botPanels.ts`.
 * با `customFetch` نوشته شده، نه کلاینت تولیدشده‌ی orval (این مسیرها در
 * `openapi.yaml` نیستند).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { PanelButton } from "@/lib/panel-buttons";

export type PanelSettings = {
  timer_seconds?: number;
  password?: string;
  capacity?: number;
  capacity_used?: number;
  forward_groups?: string[];
  carousel_ids?: string[];
  [key: string]: unknown;
};

export type Panel = {
  id: string;
  title: string;
  type: string;
  content: string;
  media_file_id: string;
  buttons: PanelButton[];
  settings: PanelSettings;
  children: string[];
  parent_id: string | null;
  is_home: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PanelNode = Panel & { childNodes: PanelNode[]; depth: number };

export type PanelsResponse = { panels: Panel[]; tree: PanelNode[]; count: number };

export type PanelReferences = {
  parent: { id: string; title: string } | null;
  children: Array<{ id: string; title: string }>;
  buttons: Array<{ panelId: string; panelTitle: string; index: number; label: string }>;
  commands: Array<{ command: string; description: string }>;
  isHome: boolean;
};

export type HealthIssue = {
  code: string;
  panelId?: string;
  detail: string;
  repairable: boolean;
};

export type PanelCatalog = {
  panelTypes: string[];
  buttonActions: string[];
  /** مقدارِ ثابتی که با انتخابِ یک اکشنِ پلاگینی (مثلاً «رزرو نوبت») خودکار در value می‌نشیند. */
  buttonFixedValues?: Record<string, string>;
  buttonStyles: string[];
  multiMediaTypes: string[];
  textOnlyTypes: string[];
  maxButtonsPerRow: number;
};

export type DeleteStrategy = "cascade" | "reparent" | "orphan";
export type ButtonStrategy = "disable" | "remove";

export type DeleteReport = {
  deleted: string[];
  reparented: string[];
  orphaned: string[];
  buttonsChanged: number;
  homeCleared: boolean;
  danglingCommands: Array<{ command: string; description: string }>;
};

export const panelsKey = (botId: string) => ["bot-panels", botId] as const;
export const panelHealthKey = (botId: string) => ["bot-panels-health", botId] as const;
export const panelRefsKey = (botId: string, panelId: string) =>
  ["bot-panel-refs", botId, panelId] as const;

export function apiErrorMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

export function apiErrorCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function usePanels(botId: string) {
  return useQuery({
    queryKey: panelsKey(botId),
    queryFn: () => customFetch<PanelsResponse>(`/api/bots/${botId}/panels`),
  });
}

export function usePanelCatalog(botId: string) {
  return useQuery({
    queryKey: ["bot-panel-catalog", botId],
    queryFn: () => customFetch<PanelCatalog>(`/api/bots/${botId}/panel-catalog`),
    staleTime: 5 * 60_000,
  });
}

export function usePanelReferences(botId: string, panelId: string | null) {
  return useQuery({
    queryKey: panelRefsKey(botId, panelId ?? ""),
    queryFn: () => customFetch<PanelReferences>(`/api/bots/${botId}/panels/${panelId}/references`),
    enabled: Boolean(panelId),
  });
}

export function usePanelHealth(botId: string) {
  return useQuery({
    queryKey: panelHealthKey(botId),
    queryFn: () => customFetch<{ issues: HealthIssue[]; healthy: boolean }>(`/api/bots/${botId}/panels/health`),
  });
}

function useInvalidatePanels(botId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: panelsKey(botId) });
    qc.invalidateQueries({ queryKey: panelHealthKey(botId) });
  };
}

export function useCreatePanel(botId: string) {
  const invalidate = useInvalidatePanels(botId);
  return useMutation({
    mutationFn: (body: Partial<Panel>) =>
      customFetch<{ panel: Panel }>(`/api/bots/${botId}/panels`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdatePanel(botId: string) {
  const invalidate = useInvalidatePanels(botId);
  return useMutation({
    mutationFn: ({ panelId, patch }: { panelId: string; patch: Partial<Panel> }) =>
      customFetch<{ panel: Panel; dropped: string[] }>(`/api/bots/${botId}/panels/${panelId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeletePanel(botId: string) {
  const invalidate = useInvalidatePanels(botId);
  return useMutation({
    mutationFn: ({
      panelId,
      strategy,
      buttonStrategy,
    }: {
      panelId: string;
      strategy: DeleteStrategy;
      buttonStrategy: ButtonStrategy;
    }) =>
      customFetch<DeleteReport>(
        `/api/bots/${botId}/panels/${panelId}?strategy=${strategy}&buttonStrategy=${buttonStrategy}`,
        { method: "DELETE" }
      ),
    onSuccess: invalidate,
  });
}

export function useSetHomePanel(botId: string) {
  const invalidate = useInvalidatePanels(botId);
  return useMutation({
    mutationFn: (panelId: string) =>
      customFetch<{ panels: Panel[] }>(`/api/bots/${botId}/panels/${panelId}/home`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useTogglePanel(botId: string) {
  const invalidate = useInvalidatePanels(botId);
  return useMutation({
    mutationFn: (panelId: string) =>
      customFetch<{ panel: Panel }>(`/api/bots/${botId}/panels/${panelId}/toggle`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useRepairPanels(botId: string) {
  const invalidate = useInvalidatePanels(botId);
  return useMutation({
    mutationFn: () =>
      customFetch<{ fixed: number; issues: HealthIssue[] }>(`/api/bots/${botId}/panels/repair`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
}

/** آپلود مدیا (فاز ۱۰) — فایل را با توکن بات به تلگرام می‌فرستد و file_id می‌دهد. */
export function useUploadMedia(botId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // هیچ content-type دستی ست نمی‌شود: مرورگر باید خودش boundary را بگذارد.
      return customFetch<{ fileId: string; type: string }>(`/api/bots/${botId}/media`, {
        method: "POST",
        body: form,
      });
    },
  });
}
