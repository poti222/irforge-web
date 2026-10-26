import { newAction, type EditorEnv } from "../action-editor";
import { newId } from "../ids";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ModuleId = "tickets" | "leveling" | "welcome" | "goodbye" | "autorole" | "reaction_roles" | "verification" | "logs" | "automod" | "antispam" | "moderation";

export interface ModuleOutput { events: any[]; commands: any[] }
export interface ModuleDef {
  id: ModuleId;
  icon: string; // lucide icon name (resolved in the UI)
  title: [string, string];
  desc: [string, string];
  /** چه چیزهایی بعد از فعال‌سازی لازم است (نمایش در کارت) */
  needs: [string, string][];
  defaults: (fa: boolean) => any;
  generate: (cfg: any, env: EditorEnv) => ModuleOutput;
  /** هشدارهای فرم (فیلد خالی …)؛ لیست خالی = آماده */
  problems: (cfg: any, fa: boolean) => string[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────
export const idList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[\s,،]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);

export function mk(env: EditorEnv, type: string, patch: Record<string, any> = {}): any {
  const spec = env.actionByType[type];
  const base = spec ? newAction(spec) : { type };
  return { ...base, ...patch };
}
export const cond = (env: EditorEnv, ifc: any, then: any[], els: any[] = []) => mk(env, "condition", { if: ifc, then, else: els });
export const rule = (left: string, op: string, right = "") => ({ left, op, right });
export const allOf = (rules: any[]) => (rules.length === 0 ? {} : rules.length === 1 ? rules[0] : { and: rules });
export const ev = (module: string, on: string, filters: any, actions: any[]) => ({ id: newId(), on, enabled: true, filters, actions, module });
export const cmd = (module: string, name: string, description: string, actions: any[], extra: Record<string, any> = {}) => ({
  id: newId(), name, description, type: "slash", enabled: true, ephemeral: false, cooldown: 0, permissions: [], options: [], actions, module, ...extra,
});
export const opt = (name: string, type: string, description: string, required = true) => ({ name, type, description, required });

