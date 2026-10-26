import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Blocks, Copy, Database, ExternalLink, Gamepad2, LayoutDashboard, Loader2, Play, Plus, RotateCw, Save, ScrollText, Settings as SettingsIcon, Square, Terminal, Trash2, Undo2, Zap, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgePanel } from "@/components/forge-ui/ForgePanel";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { cn } from "@/lib/utils";
import {
  controlDiscordBot, deleteDiscordBot, discordErrorText, DiscordApiError, discordMeta, getDiscordBot, getDiscordKv, getDiscordLogs,
  patchDiscordBot, saveDiscordBlueprint, setDiscordToken, type DiscordBlueprint, type DiscordBotSummary, type DiscordCatalog, type DiscordLogEntry,
} from "@/lib/discord-bots-api";
import { ActionListEditor, ConditionEditor, NativeSelect, makeEnv, type EditorEnv } from "@/components/discord/action-editor";
import { BotStatusPill, runtimeErrorMessage } from "@/components/discord/status";
import { newId } from "@/components/discord/ids";
import { ModulesSection } from "@/components/discord/modules/ModulesSection";

/* eslint-disable @typescript-eslint/no-explicit-any */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function neededIntents(bp: DiscordBlueprint, catalog: DiscordCatalog): string[] {
  const need = new Set<string>();
  if (bp.commands.some((c) => c.enabled && (c.type === "prefix" || c.type === "both"))) need.add("message_content");
  for (const e of bp.events) if (e.enabled) for (const i of catalog.events.find((x) => x.id === e.on)?.needsIntents ?? []) need.add(i);
  return [...need];
}

const STARTER_COMMANDS = (fa: boolean) => [
  { id: newId(), name: "ping", description: fa ? "تست سلامت بات" : "Check the bot is alive", type: "slash", enabled: true, ephemeral: false, cooldown: 5, permissions: [], options: [],
    actions: [{ type: "reply", content: fa ? "پونگ! 🏓 تأخیر: {latency}ms" : "Pong! 🏓 latency: {latency}ms", ephemeral: false, buttons: [] }] },
];
const STARTER_EVENTS = (fa: boolean) => [
  { id: newId(), on: "member_join", enabled: true, filters: {}, actions: [{ type: "send_message", channel: "{config.welcome_channel}", content: fa ? "خوش آمدی {member.mention} به {guild.name}! 🎉" : "Welcome {member.mention} to {guild.name}! 🎉", buttons: [] }] },
];

// ─── variables help ──────────────────────────────────────────────────────────
function VariablesHelp({ env, eventVars }: { env: EditorEnv; eventVars?: string[] }) {
  const { toast } = useToast();
  const fa = env.fa;
  const copy = (s: string) => { void navigator.clipboard?.writeText(`{${s}}`); toast({ title: `{${s}}`, description: fa ? "کپی شد" : "Copied" }); };
  const groups = Object.entries(env.catalog.variableGroups);
  return (
    <details className="rounded-lg border bg-muted/30 p-3 text-xs">
      <summary className="cursor-pointer font-medium">{fa ? "متغیرهای قابل‌استفاده در متن‌ها (کلیک برای کپی)" : "Variables you can use in texts (click to copy)"}</summary>
      <div className="mt-3 space-y-2">
        {eventVars && eventVars.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-semibold">{fa ? "این رویداد:" : "This event:"}</span>
            {eventVars.map((v) => <button key={v} type="button" onClick={() => copy(v)} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">{`{${v}}`}</button>)}
          </div>
        )}
        {groups.map(([g, keys]) => (
          <div key={g} className="flex flex-wrap items-center gap-1">
            <span className="w-14 font-semibold">{g}</span>
            {keys.map((k) => {
              const full = k.startsWith("<") ? k : `${g}.${k}`;
              return k.startsWith("<")
                ? <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{`${g}.${k}`}</span>
                : <button key={k} type="button" onClick={() => copy(full)} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-primary/10">{`{${full}}`}</button>;
            })}
          </div>
        ))}
      </div>
    </details>
  );
}

// ─── commands ────────────────────────────────────────────────────────────────
function choicesToText(choices: any[] | undefined): string {
  return (choices ?? []).map((c) => (String(c.name) === String(c.value) ? String(c.name) : `${c.name}=${c.value}`)).join("\n");
}
function textToChoices(text: string): any[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return i > 0 ? { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { name: l, value: l };
  });
}

function OptionsEditor({ value, onChange, env }: { value: any[]; onChange: (v: any[]) => void; env: EditorEnv }) {
  const fa = env.fa;
  const upd = (i: number, patch: any) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      {value.map((o, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.6fr_auto_auto] sm:items-center">
            <Input dir="ltr" placeholder={fa ? "نام (مثل user)" : "name (e.g. user)"} value={o.name ?? ""} onChange={(e) => upd(i, { name: e.target.value.toLowerCase().replace(/\s+/g, "_") })} />
            <NativeSelect value={o.type ?? "string"} onChange={(v) => upd(i, { type: v, choices: undefined })}>
              {env.catalog.optionTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
            <Input placeholder={fa ? "توضیح" : "Description"} maxLength={100} value={o.description ?? ""} onChange={(e) => upd(i, { description: e.target.value })} />
            <label className="flex items-center gap-1 text-xs"><Switch checked={!!o.required} onCheckedChange={(c) => upd(i, { required: c })} />{fa ? "اجباری" : "Required"}</label>
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
          {["string", "integer", "number"].includes(o.type) && (
            <Textarea rows={2} className="text-xs" placeholder={fa ? "گزینه‌های ثابت (اختیاری) — هر خط: نمایش=مقدار" : "Fixed choices (optional) — one per line: label=value"}
              value={choicesToText(o.choices)} onChange={(e) => upd(i, { choices: textToChoices(e.target.value) })} />
          )}
          <p className="text-[11px] text-muted-foreground" dir="ltr">{`{options.${o.name || "name"}}`}{["user", "channel", "role"].includes(o.type) ? `  {options.${o.name || "name"}_mention}` : ""}</p>
        </div>
      ))}
      {value.length < env.catalog.limits.maxOptionsPerCommand && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { name: "", type: "string", description: "", required: false }])}>
          <Plus className="me-1 size-3.5" />{fa ? "افزودن گزینه (پارامتر)" : "Add option (parameter)"}
        </Button>
      )}
    </div>
  );
}

function CommandEditor({ cmd, onChange, onDelete, env }: { cmd: any; onChange: (c: any) => void; onDelete: () => void; env: EditorEnv }) {
  const fa = env.fa;
  const set = (patch: any) => onChange({ ...cmd, ...patch });
  const togglePerm = (p: string) => set({ permissions: cmd.permissions.includes(p) ? cmd.permissions.filter((x: string) => x !== p) : [...cmd.permissions, p] });
  const typeLabel: Record<string, string> = { slash: fa ? "اسلش (/)" : "Slash (/)", prefix: fa ? "پیشوندی (!)" : "Prefix (!)", both: fa ? "هر دو" : "Both" };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium">{fa ? "نام دستور" : "Command name"} <span className="text-destructive">*</span></label>
          <Input dir="ltr" maxLength={32} placeholder="ping" value={cmd.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/\s+/g, "-") })} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">{fa ? "نوع" : "Type"}</label>
          <NativeSelect value={cmd.type} onChange={(v) => set({ type: v })}>
            {env.catalog.commandTypes.map((t) => <option key={t} value={t}>{typeLabel[t]}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium">{fa ? "توضیح (در دیسکورد نمایش داده می‌شود)" : "Description (shown in Discord)"}</label>
          <Input maxLength={100} value={cmd.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">{fa ? "کول‌داون (ثانیه، برای هر کاربر)" : "Cooldown (seconds per user)"}</label>
          <Input dir="ltr" inputMode="decimal" value={cmd.cooldown} onChange={(e) => set({ cooldown: e.target.value === "" ? 0 : Number(e.target.value) || 0 })} />
        </div>
        <div className="flex items-center gap-6 pt-5">
          <label className="flex items-center gap-2 text-sm"><Switch checked={cmd.enabled} onCheckedChange={(c) => set({ enabled: c })} />{fa ? "فعال" : "Enabled"}</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={!!cmd.ephemeral} onCheckedChange={(c) => set({ ephemeral: c })} />{fa ? "پاسخ فقط برای اجراکننده" : "Reply only visible to caller"}</label>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{fa ? "دسترسی لازم برای اجرا" : "Required permissions to run"}</h4>
        <div className="flex flex-wrap gap-1.5">
          {env.catalog.commandPermissions.map((p) => (
            <button key={p} type="button" onClick={() => togglePerm(p)}
              className={cn("rounded-full border px-2.5 py-1 text-[11px] font-mono transition", cmd.permissions.includes(p) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>{p}</button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{fa ? "اگر هیچ‌کدام انتخاب نشود همه می‌توانند اجرا کنند. (اکشن‌های مدیریتی مثل بن/اخراج همیشه دسترسی واقعی کاربر را هم بررسی می‌کنند.)" : "If none is selected, everyone can run it. (Moderation actions such as ban/kick always re-check the caller's real permission.)"}</p>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{fa ? "گزینه‌ها (پارامترهای دستور)" : "Options (command parameters)"}</h4>
        <OptionsEditor value={cmd.options} onChange={(o) => set({ options: o })} env={env} />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{fa ? "اکشن‌ها (به ترتیب اجرا می‌شوند)" : "Actions (run in order)"}</h4>
        <VariablesHelp env={env} />
        <ActionListEditor value={cmd.actions} onChange={(a) => set({ actions: a })} env={env} />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" className="text-destructive" onClick={onDelete}><Trash2 className="me-2 size-4" />{fa ? "حذف این دستور" : "Delete command"}</Button>
      </div>
    </div>
  );
}

function CommandsTab({ bp, setBp, env }: { bp: DiscordBlueprint; setBp: (b: DiscordBlueprint) => void; env: EditorEnv }) {
  const fa = env.fa;
  const [sel, setSel] = useState(0);
  const idx = Math.min(sel, bp.commands.length - 1);
  const cmd = bp.commands[idx];
  const setCmds = (c: any[]) => setBp({ ...bp, commands: c });
  const add = () => {
    if (bp.commands.length >= env.catalog.limits.maxCommands) return;
    setCmds([...bp.commands, { id: newId(), name: "", description: "", type: "slash", enabled: true, ephemeral: false, cooldown: 0, permissions: [], options: [], actions: [] }]);
    setSel(bp.commands.length);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit">
        <CardContent className="space-y-1 p-2">
          {bp.commands.map((c, i) => (
            <button key={c.id} type="button" onClick={() => setSel(i)}
              className={cn("flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm", i === idx ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted", !c.enabled && "opacity-50")}>
              <span className="truncate" dir="ltr">{c.type === "prefix" ? bp.prefix : c.type === "both" ? `/ ${bp.prefix}` : "/"}{c.name || (fa ? "بدون‌نام" : "unnamed")}</span>
              <span className="flex items-center gap-1">{c.module && <Badge variant="secondary" className="text-[10px]">{c.module}</Badge>}<Badge variant="outline" className="text-[10px]">{c.actions.length}</Badge></span>
            </button>
          ))}
          <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={add}><Plus className="me-1 size-3.5" />{fa ? "دستور جدید" : "New command"}</Button>
          {bp.commands.length === 0 && (
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { setCmds(STARTER_COMMANDS(fa)); setSel(0); }}>{fa ? "افزودن نمونه (ping)" : "Add example (ping)"}</Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 md:p-5">
          {cmd ? (
            <CommandEditor key={cmd.id} cmd={cmd} env={env} onChange={(c) => setCmds(bp.commands.map((x, i) => (i === idx ? c : x)))}
              onDelete={() => { setCmds(bp.commands.filter((_, i) => i !== idx)); setSel(0); }} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{fa ? "دستوری ندارید. یکی بسازید تا شروع کنیم." : "No commands yet — create one to get started."}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── events ──────────────────────────────────────────────────────────────────
function EventsTab({ bp, setBp, env }: { bp: DiscordBlueprint; setBp: (b: DiscordBlueprint) => void; env: EditorEnv }) {
  const fa = env.fa;
  const setEvents = (e: any[]) => setBp({ ...bp, events: e });
  return (
    <div className="space-y-4">
      {bp.events.length === 0 && <p className="text-sm text-muted-foreground">{fa ? "هنوز رویدادی ندارید. رویدادها وقتی اتفاقی در سرور بیفتد (ورود عضو، پیام، ری‌اکشن …) خودکار اجرا می‌شوند." : "No events yet. Events run automatically when something happens in your server (member join, message, reaction…)."}</p>}
      {bp.events.map((ev, i) => {
        const meta = env.catalog.events.find((e) => e.id === ev.on);
        const upd = (patch: any) => setEvents(bp.events.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <Card key={ev.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <NativeSelect className="w-auto min-w-56" value={ev.on} onChange={(v) => upd({ on: v })}>
                  {env.catalog.events.map((e) => <option key={e.id} value={e.id}>{fa ? e.label : e.labelEn}</option>)}
                </NativeSelect>
                <label className="flex items-center gap-2 text-sm"><Switch checked={ev.enabled} onCheckedChange={(c) => upd({ enabled: c })} />{fa ? "فعال" : "Enabled"}</label>
                {(meta?.needsIntents.length ?? 0) > 0 && <Badge variant="outline" className="text-[10px]">Intent: {meta!.needsIntents.join(", ")}</Badge>}
                {ev.module && <Badge variant="secondary" className="text-[10px]" title={fa ? "ساخته‌شده توسط قابلیت آماده — با تغییر فرمِ آن بازنویسی می‌شود" : "Generated by a ready-made feature — overwritten when its form changes"}>{fa ? "قابلیت" : "Feature"}: {ev.module}</Badge>}
                <Button type="button" size="icon" variant="ghost" className="ms-auto text-destructive" onClick={() => setEvents(bp.events.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {["message", "message_edit", "reaction_add", "reaction_remove", "voice_join", "voice_leave", "member_join", "member_role_add", "member_role_remove"].includes(ev.on) && (
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold">{fa ? "فقط وقتی… (فیلتر، اختیاری)" : "Only when… (filter, optional)"}</h4>
                  <ConditionEditor value={ev.filters} onChange={(f) => upd({ filters: f })} env={env} />
                </div>
              )}
              <VariablesHelp env={env} eventVars={meta?.variables} />
              <ActionListEditor value={ev.actions} onChange={(a) => upd({ actions: a })} env={env} />
            </CardContent>
          </Card>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => bp.events.length < env.catalog.limits.maxEvents && setEvents([...bp.events, { id: newId(), on: "member_join", enabled: true, filters: {}, actions: [] }])}>
          <Plus className="me-2 size-4" />{fa ? "رویداد جدید" : "New event"}
        </Button>
        {bp.events.length === 0 && <Button type="button" variant="ghost" onClick={() => setEvents(STARTER_EVENTS(fa))}>{fa ? "افزودن نمونه (خوش‌آمدگویی)" : "Add example (welcome)"}</Button>}
      </div>
    </div>
  );
}

// ─── settings ────────────────────────────────────────────────────────────────
function SettingsTab({ bp, setBp, bot, env, onRename, onDelete }: { bp: DiscordBlueprint; setBp: (b: DiscordBlueprint) => void; bot: DiscordBotSummary; env: EditorEnv; onRename: (n: string) => void; onDelete: () => void }) {
  const fa = env.fa;
  const [name, setName] = useState(bot.name);
  const entries = Object.entries(bp.variables);
  const setVars = (e: [string, string][]) => setBp({ ...bp, variables: Object.fromEntries(e) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">{fa ? "عمومی" : "General"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">{fa ? "نام بات در IrForge" : "Bot name on IrForge"}</label>
            <div className="flex gap-2">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <Button type="button" variant="outline" disabled={!name.trim() || name === bot.name} onClick={() => onRename(name)}>{fa ? "تغییر" : "Rename"}</Button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">{fa ? "پیشوند دستورهای پیشوندی" : "Prefix for prefix commands"}</label>
            <Input dir="ltr" className="max-w-24" maxLength={5} value={bp.prefix} onChange={(e) => setBp({ ...bp, prefix: e.target.value.replace(/\s/g, "") })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
            <div className="space-y-1">
              <label className="text-xs font-medium">{fa ? "وضعیت بات" : "Presence"}</label>
              <NativeSelect value={bp.status.type} onChange={(v) => setBp({ ...bp, status: { ...bp.status, type: v } })}>
                {env.catalog.activityTypes.map((a) => <option key={a} value={a}>{a}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{fa ? "متن وضعیت" : "Presence text"}</label>
              <Input maxLength={128} value={bp.status.text} onChange={(e) => setBp({ ...bp, status: { ...bp.status, text: e.target.value } })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={bp.settings.allow_role_mentions} onCheckedChange={(c) => setBp({ ...bp, settings: { ...bp.settings, allow_role_mentions: c } })} />{fa ? "اجازه‌ی منشن نقش‌ها در پیام‌های بات" : "Allow role mentions in bot messages"}</label>
          <p className="text-[11px] text-muted-foreground">{fa ? "@everyone و @here همیشه خنثی می‌شوند." : "@everyone and @here are always neutralised."}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{fa ? "متغیرهای تنظیمات" : "Config variables"}</CardTitle>
          <CardDescription>{fa ? "مثلاً آیدی کانال‌ها و نقش‌ها؛ در متن‌ها با {config.نام} استفاده می‌شود." : "E.g. channel and role IDs; use them as {config.name} in texts."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.map(([k, v], i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
              <Input dir="ltr" placeholder="welcome_channel" value={k} onChange={(e) => setVars(entries.map((x, j) => (j === i ? [e.target.value.replace(/[^\p{L}\p{N}_]/gu, ""), x[1]] : x)))} />
              <Input dir="ltr" placeholder="123456789012345678" value={v} onChange={(e) => setVars(entries.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
              <Button type="button" size="icon" variant="ghost" onClick={() => setVars(entries.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          {entries.length < env.catalog.limits.maxVariables && (
            <Button type="button" size="sm" variant="outline" onClick={() => { let n = 1; while (bp.variables[`var_${n}`] !== undefined) n++; setBp({ ...bp, variables: { ...bp.variables, [`var_${n}`]: "" } }); }}><Plus className="me-1 size-3.5" />{fa ? "افزودن متغیر" : "Add variable"}</Button>
          )}
          <p className="text-[11px] text-muted-foreground">{fa ? "برای گرفتن آیدی: در دیسکورد Developer Mode را روشن کنید و روی کانال/نقش راست‌کلیک → Copy ID." : "To get an ID: enable Developer Mode in Discord, right-click a channel/role → Copy ID."}</p>
        </CardContent>
      </Card>
      <Card className="border-destructive/40 lg:col-span-2">
        <CardHeader><CardTitle className="text-base text-destructive">{fa ? "منطقه‌ی خطر" : "Danger zone"}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{fa ? "حذف بات، همه‌ی تنظیمات، دیتابیس و لاگ‌های آن را پاک می‌کند. (ابتدا بات باید خاموش باشد.)" : "Deleting removes the bot with its settings, database and logs. (Stop it first.)"}</p>
          <Button type="button" variant="destructive" onClick={onDelete}><Trash2 className="me-2 size-4" />{fa ? "حذف بات" : "Delete bot"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── logs / kv ───────────────────────────────────────────────────────────────
function LogsTab({ botId, fa }: { botId: string; fa: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ["discord-logs", botId], queryFn: () => getDiscordLogs(botId), refetchInterval: 5000 });
  const logs: DiscordLogEntry[] = data?.logs ?? [];
  const tone = { info: "text-muted-foreground", warn: "text-amber-600", error: "text-destructive" } as const;
  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? <div className="p-6"><Loader2 className="size-5 animate-spin" /></div> : logs.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{fa ? "هنوز لاگی ثبت نشده." : "No logs yet."}</p>
        ) : (
          <ul className="max-h-[560px] divide-y overflow-auto font-mono text-xs" dir="auto">
            {[...logs].reverse().map((l) => (
              <li key={l.id} className="flex gap-3 px-4 py-2">
                <span className="shrink-0 text-muted-foreground" dir="ltr">{new Date(l.at).toLocaleTimeString()}</span>
                <span className={cn("shrink-0 font-semibold uppercase", tone[l.level])}>{l.level}</span>
                <span className="break-words">{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function KvTab({ botId, fa }: { botId: string; fa: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ["discord-kv", botId], queryFn: () => getDiscordKv(botId), refetchInterval: 10000 });
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{fa ? "دیتابیس بات (فقط‌خواندنی)" : "Bot database (read-only)"}</CardTitle>
        <CardDescription>{fa ? "با اکشن‌های «ذخیره/خواندن/افزایش دیتابیس» پر می‌شود. حداکثر ۲۰۰۰ کلید." : "Filled by the database actions. Max 2000 keys."}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="size-5 animate-spin" /> : items.length === 0 ? <p className="text-sm text-muted-foreground">{fa ? "خالی است." : "Empty."}</p> : (
          <div className="max-h-[480px] overflow-auto rounded-md border">
            <table className="w-full text-xs" dir="ltr">
              <thead className="bg-muted/50 text-start"><tr><th className="p-2 text-start">key</th><th className="p-2 text-start">value</th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.key} className="border-t"><td className="p-2 font-mono">{i.key}</td><td className="break-all p-2">{i.value}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── overview ────────────────────────────────────────────────────────────────
function OverviewTab({ bot, intents, fa, onToken, tokenBusy }: { bot: DiscordBotSummary; intents: string[]; fa: boolean; onToken: (t: string) => void; tokenBusy: boolean }) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const err = runtimeErrorMessage(bot, fa);
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(err || bot.runnerStale) && (
        <Card className="border-destructive/40 lg:col-span-2">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              {bot.runnerStale ? <p>{t("سرویس اجراکننده‌ی بات‌های دیسکورد پاسخ نمی‌دهد. اگر چند دقیقه طول کشید با پشتیبانی تماس بگیرید.", "The Discord runner service isn't responding. If it persists for a few minutes, contact support.")}</p> : null}
              {err && <p>{err}</p>}
              {bot.runtimeError && bot.runtimeErrorCode === "crash" && <p className="font-mono text-xs text-muted-foreground" dir="ltr">{bot.runtimeError}</p>}
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">{t("وضعیت", "Status")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 text-center text-sm">
          <div><div className="text-2xl font-bold">{bot.guildCount}</div><div className="text-xs text-muted-foreground">{t("سرور", "Servers")}</div></div>
          <div><div className="text-2xl font-bold" dir="ltr">{bot.latencyMs ?? "—"}</div><div className="text-xs text-muted-foreground">{t("تأخیر (ms)", "Latency (ms)")}</div></div>
          <div><div className="text-2xl font-bold">v{bot.blueprintVersion}</div><div className="text-xs text-muted-foreground">{t("نسخه‌ی تنظیمات", "Config version")}</div></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("توکن بات", "Bot token")}</CardTitle>
          <CardDescription>{bot.tokenSet ? `${t("ثبت شده برای", "Set for")} @${bot.botUsername ?? "bot"}` : t("هنوز ثبت نشده", "Not set yet")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input dir="ltr" type="password" autoComplete="off" placeholder={bot.tokenSet ? t("توکن جدید (برای جایگزینی)", "New token (to replace)") : "MTIz…"} value={token} onChange={(e) => setToken(e.target.value)} />
            <Button disabled={!token.trim() || tokenBusy} onClick={() => { onToken(token.trim()); setToken(""); }}>
              {tokenBusy && <Loader2 className="me-2 size-4 animate-spin" />}{t("ثبت", "Save")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("توکن رمزنگاری ذخیره می‌شود و هرگز دوباره نمایش داده نمی‌شود.", "The token is stored encrypted and is never shown again.")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("افزودن بات به سرور", "Add the bot to your server")}</CardTitle>
          <CardDescription>{t("لینک دعوت با دسترسی‌هایی که اکشن‌های فعلی لازم دارند ساخته می‌شود.", "The invite link requests the permissions your current actions need.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {bot.inviteUrl ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild><a href={bot.inviteUrl} target="_blank" rel="noreferrer"><ExternalLink className="me-2 size-4" />{t("دعوت بات", "Invite bot")}</a></Button>
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(bot.inviteUrl!); toast({ title: t("لینک کپی شد", "Link copied") }); }}><Copy className="me-2 size-4" />{t("کپی لینک", "Copy link")}</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t("ابتدا توکن را ثبت کنید.", "Add the token first.")}</p>}
          <p className="text-[11px] text-muted-foreground">{t("با تغییر اکشن‌ها ممکن است دسترسی بیشتری لازم شود؛ در آن صورت دوباره با لینک جدید دعوت کنید یا دسترسی را در تنظیمات نقش بات بدهید.", "New actions may need more permissions — re-invite with the updated link or grant them on the bot's role.")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("Intentهای مورد نیاز", "Required intents")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {intents.length === 0 ? <p className="text-muted-foreground">{t("تنظیمات فعلی به Intent ویژه‌ای نیاز ندارد.", "Your current setup needs no privileged intents.")}</p> : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {intents.map((i) => <Badge key={i} variant="secondary" dir="ltr">{i === "message_content" ? "Message Content Intent" : "Server Members Intent"}</Badge>)}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t("این‌ها را در Developer Portal → Bot → Privileged Gateway Intents روشن کنید، وگرنه بات وصل نمی‌شود.", "Enable these in Developer Portal → Bot → Privileged Gateway Intents or the bot cannot connect.")}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── workspace sections ──────────────────────────────────────────────────────
type SectionKey = "overview" | "modules" | "commands" | "events" | "database" | "logs" | "settings";
const GROUPS = [
  { key: "overview", fa: "نمای کلی", en: "Overview" },
  { key: "features", fa: "قابلیت‌ها", en: "Features" },
  { key: "data", fa: "داده و گزارش", en: "Data & reports" },
  { key: "settings", fa: "تنظیمات", en: "Settings" },
] as const;
const SECTIONS: { key: SectionKey; group: (typeof GROUPS)[number]["key"]; icon: LucideIcon; fa: string; en: string; descFa: string; descEn: string }[] = [
  { key: "overview", group: "overview", icon: LayoutDashboard, fa: "نمای کلی", en: "Overview", descFa: "وضعیت، توکن، لینک دعوت و Intentها", descEn: "Status, token, invite link and intents" },
  { key: "modules", group: "features", icon: Blocks, fa: "قابلیت‌های آماده", en: "Ready-made features", descFa: "خوش‌آمدگویی، ری‌اکشن‌رول، تأیید عضویت، لاگ، مدیریت خودکار …", descEn: "Welcome, reaction roles, verification, logs, auto-moderation…" },
  { key: "commands", group: "features", icon: Terminal, fa: "دستورها", en: "Commands", descFa: "دستورهای اسلش و پیشوندی با اکشن‌های دلخواه", descEn: "Slash and prefix commands with custom actions" },
  { key: "events", group: "features", icon: Zap, fa: "رویدادها", en: "Events", descFa: "کارهایی که با اتفاق‌های سرور خودکار اجرا می‌شوند", descEn: "Things that run automatically when something happens" },
  { key: "database", group: "data", icon: Database, fa: "دیتابیس", en: "Database", descFa: "داده‌هایی که بات ذخیره کرده (فقط‌خواندنی)", descEn: "Data the bot has stored (read-only)" },
  { key: "logs", group: "data", icon: ScrollText, fa: "لاگ‌ها", en: "Logs", descFa: "گزارش اجرای بات و خطاها", descEn: "Run reports and errors" },
  { key: "settings", group: "settings", icon: SettingsIcon, fa: "تنظیمات بات", en: "Bot settings", descFa: "نام، وضعیت، پیشوند، متغیرها و حذف بات", descEn: "Name, presence, prefix, variables and deletion" },
];

// ─── page ────────────────────────────────────────────────────────────────────
export default function DiscordBotEditor() {
  const { id = "" } = useParams<{ id: string }>();
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = (a: string, b: string) => (fa ? a : b);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();

  const meta = useQuery({ queryKey: ["discord-meta"], queryFn: discordMeta, staleTime: Infinity });
  const botQ = useQuery({
    queryKey: ["discord-bot", id], queryFn: () => getDiscordBot(id),
    refetchInterval: (q) => {
      const b = q.state.data?.bot;
      return b && (b.runtimeState === "starting" || (b.desiredState === "stopped") !== (b.runtimeState === "offline")) ? 2500 : 8000;
    },
  });
  const bot = botQ.data?.bot;
  usePrivatePageTitle(bot ? `${bot.name} · Discord` : "Discord");

  const [draft, setDraft] = useState<DiscordBlueprint | null>(null);
  const savedRef = useRef<string>("");
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  // اولین بارگذاریِ بلوپرینت (و بعد از هر ذخیره‌ی موفق، با resetDraft).
  useEffect(() => {
    if (bot?.blueprint && draft === null) {
      setDraft(clone(bot.blueprint));
      savedRef.current = JSON.stringify(bot.blueprint);
    }
  }, [bot?.blueprint, draft]);
  const dirty = draft !== null && JSON.stringify(draft) !== savedRef.current;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const env = useMemo(() => (meta.data ? makeEnv(meta.data.catalog, fa) : null), [meta.data, fa]);
  const refresh = (b: DiscordBotSummary) => { qc.setQueryData(["discord-bot", id], { bot: b }); qc.invalidateQueries({ queryKey: ["discord-bots"] }); };
  const onErr = (title: string) => (e: unknown) => {
    const code = e instanceof DiscordApiError ? e.code : "unknown";
    if (e instanceof DiscordApiError && e.errors?.length) setSaveErrors(e.errors);
    toast({ title, description: discordErrorText(code, fa), variant: "destructive" });
  };

  const save = useMutation({
    mutationFn: () => saveDiscordBlueprint(id, draft!),
    onSuccess: ({ bot: b }) => {
      setSaveErrors([]);
      savedRef.current = JSON.stringify(b.blueprint);
      setDraft(clone(b.blueprint!));
      refresh(b);
      toast({ title: t("ذخیره شد", "Saved"), description: b.desiredState === "running" ? t("تغییرات بدون قطع اتصال روی بات روشن اعمال می‌شود.", "Changes are applied to the running bot without reconnecting.") : undefined });
    },
    onError: onErr(t("ذخیره نشد", "Couldn't save")),
  });
  const control = useMutation({
    mutationFn: (a: "start" | "stop" | "restart") => controlDiscordBot(id, a),
    onSuccess: ({ bot: b }) => refresh(b),
    onError: onErr(t("عملیات انجام نشد", "Action failed")),
  });
  const tokenM = useMutation({
    mutationFn: (tk: string) => setDiscordToken(id, tk),
    onSuccess: ({ bot: b }) => { refresh(b); toast({ title: t("توکن ثبت شد", "Token saved") }); },
    onError: onErr(t("توکن ثبت نشد", "Couldn't save the token")),
  });
  const rename = useMutation({
    mutationFn: (name: string) => patchDiscordBot(id, { name }),
    onSuccess: ({ bot: b }) => { refresh({ ...bot!, ...b }); toast({ title: t("نام تغییر کرد", "Renamed") }); },
    onError: onErr(t("تغییر نام انجام نشد", "Couldn't rename")),
  });
  const del = useMutation({
    mutationFn: () => deleteDiscordBot(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discord-bots"] }); navigate("/discord-bots"); },
    onError: onErr(t("حذف انجام نشد", "Couldn't delete")),
  });

  if (botQ.isLoading || meta.isLoading || !env || !draft || !bot) {
    return botQ.isError ? (
      <div className="mx-auto max-w-xl py-20 text-center text-sm text-muted-foreground">{t("این بات پیدا نشد.", "Bot not found.")} <Link href="/discord-bots" className="text-primary underline">{t("بازگشت", "Back")}</Link></div>
    ) : <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const running = bot.desiredState === "running";
  const intents = neededIntents(draft, env.catalog);
  const busy = control.isPending;
  const moduleCount = Object.values(draft.modules ?? {}).filter((m: any) => m?.enabled).length;
  const section = (SECTIONS.find((x) => x.key === new URLSearchParams(search).get("section"))?.key ?? "overview") as SectionKey;
  const go = (k: SectionKey) => navigate(`/discord-bots/${id}?section=${k}`);
  const active = SECTIONS.find((x) => x.key === section)!;
  const badge = (k: SectionKey) => (k === "modules" ? moduleCount : k === "commands" ? draft.commands.length : k === "events" ? draft.events.length : 0);

  return (
    <div className="space-y-6 pb-20">
      {/* Hero — مثل ورک‌اسپیس بات تلگرام: هویتِ بات، وضعیتِ اجرا و کلیدهای پرکاربرد */}
      <ForgePanel className="p-5 sm:p-7" embers={12}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="-ms-2 shrink-0 text-muted-foreground hover:text-foreground">
              <Link href="/discord-bots" aria-label={t("بات‌های دیسکورد", "Discord bots")}><ArrowLeft className="h-5 w-5 rtl:rotate-180" /></Link>
            </Button>
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/.28),0_14px_28px_-12px_hsl(var(--primary)/.9)]">
              <Gamepad2 className="h-8 w-8" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="truncate text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{bot.name}</h1>
                <BotStatusPill bot={bot} fa={fa} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {bot.botUsername && <span dir="ltr">@{bot.botUsername}</span>}
                <span className="tabular-nums">{bot.guildCount} {t("سرور", "servers")}</span>
                <span className="tabular-nums">{draft.commands.length} {t("دستور", "commands")}</span>
                <span className="tabular-nums">{draft.events.length} {t("رویداد", "events")}</span>
                <span className="tabular-nums">{moduleCount} {t("قابلیت فعال", "active features")}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {bot.inviteUrl && (
              <Button variant="outline" size="sm" asChild className="bg-white/5"><a href={bot.inviteUrl} target="_blank" rel="noreferrer"><ExternalLink className="me-2 h-4 w-4" />{t("دعوت بات به سرور", "Invite to server")}</a></Button>
            )}
            {running ? (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => control.mutate("restart")}><RotateCw className="me-2 size-4" />{t("ری‌استارت", "Restart")}</Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => control.mutate("stop")}><Square className="me-2 size-4" />{t("توقف", "Stop")}</Button>
              </>
            ) : (
              <Button size="sm" disabled={busy || !bot.tokenSet || dirty} title={dirty ? t("اول ذخیره کنید", "Save first") : undefined} onClick={() => control.mutate("start")}>
                {busy ? <Loader2 className="me-2 size-4 animate-spin" /> : <Play className="me-2 size-4" />}{t("روشن‌کردن", "Start")}
              </Button>
            )}
          </div>
        </div>
      </ForgePanel>

      {saveErrors.length > 0 && (
        <Card className="border-destructive/50">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-semibold text-destructive">{discordErrorText("blueprint_invalid", fa)}</p>
            <ul className="list-disc space-y-0.5 ps-5 text-xs" dir="auto">{saveErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-1 flex-col gap-5 md:flex-row md:items-start">
        {/* ریل بخش‌ها: روی دسکتاپ گروه‌بندی‌شده و چسبیده، روی موبایل یک نوار افقی */}
        <nav className="flex shrink-0 flex-col md:sticky md:top-20 md:max-h-[calc(100vh-6.5rem)] md:w-56 md:overflow-y-auto md:pe-1" aria-label={t("بخش‌ها", "Sections")}>
          <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:gap-0 md:overflow-visible md:pb-0">
            {GROUPS.map((g) => (
              <div key={g.key} className="contents md:mb-4 md:block">
                <div className="hidden px-3 pb-1.5 text-[11px] font-semibold text-muted-foreground/70 md:block">{fa ? g.fa : g.en}</div>
                {SECTIONS.filter((x) => x.group === g.key).map((x) => {
                  const on = section === x.key;
                  const n = badge(x.key);
                  return (
                    <button key={x.key} type="button" onClick={() => go(x.key)} aria-current={on ? "page" : undefined} data-testid={`discord-section-${x.key}`}
                      className={cn("relative flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors md:w-full",
                        on ? "bg-primary/10 text-primary before:absolute before:inset-y-2 before:start-0 before:hidden before:w-[3px] before:rounded-full before:bg-primary md:before:block" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
                      <x.icon className="h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">{fa ? x.fa : x.en}</span>
                      {n > 0 && <Badge variant="secondary" className="ms-auto h-5 px-1.5 text-[10px]">{n}</Badge>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1 rounded-3xl border border-border/70 bg-card/70 p-4 shadow-[var(--shadow-card)] sm:p-6">
          <div className="mb-5 flex items-center gap-3 border-b border-border/60 pb-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"><active.icon className="size-5" /></span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold tracking-tight">{fa ? active.fa : active.en}</h2>
              <p className="truncate text-xs text-muted-foreground">{fa ? active.descFa : active.descEn}</p>
            </div>
          </div>
          {section === "overview" && <OverviewTab bot={bot} intents={intents} fa={fa} onToken={(tk) => tokenM.mutate(tk)} tokenBusy={tokenM.isPending} />}
          {section === "modules" && <ModulesSection bp={draft} setBp={setDraft} env={env} />}
          {section === "commands" && <CommandsTab bp={draft} setBp={setDraft} env={env} />}
          {section === "events" && <EventsTab bp={draft} setBp={setDraft} env={env} />}
          {section === "settings" && (
            <SettingsTab bp={draft} setBp={setDraft} bot={bot} env={env} onRename={(n) => rename.mutate(n)}
              onDelete={() => { if (window.confirm(t("بات و همه‌ی داده‌هایش حذف شود؟ این کار برگشت‌پذیر نیست.", "Delete this bot and all its data? This can't be undone."))) del.mutate(); }} />
          )}
          {section === "database" && <KvTab botId={id} fa={fa} />}
          {section === "logs" && <LogsTab botId={id} fa={fa} />}
        </div>
      </div>

      {/* نوار ذخیره: تا وقتی تغییرِ ذخیره‌نشده هست روی همه‌ی بخش‌ها دیده می‌شود (تغییر بخش، پیش‌نویس را دور نمی‌ریزد) */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-12px_hsl(var(--foreground)/.25)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">{t("تغییرات ذخیره‌نشده دارید", "You have unsaved changes")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft(JSON.parse(savedRef.current))}><Undo2 className="me-2 size-4" />{t("بازگردانی", "Discard")}</Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="discord-save">
                {save.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}{t("ذخیره‌ی تغییرات", "Save changes")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
