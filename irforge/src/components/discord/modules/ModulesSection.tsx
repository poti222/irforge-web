import { useMemo, useState } from "react";
import { AlertTriangle, Blocks, ChevronDown, DoorOpen, Gavel, PartyPopper, Plus, ScrollText, ShieldAlert, ShieldCheck, SmilePlus, Trash2, BadgePlus, type LucideIcon } from "lucide-react";

const MODULE_ICONS: Record<string, LucideIcon> = { PartyPopper, DoorOpen, BadgePlus, SmilePlus, ShieldCheck, ScrollText, ShieldAlert, Gavel };
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { DiscordBlueprint } from "@/lib/discord-bots-api";
import { NativeSelect, type EditorEnv } from "../action-editor";
import { LOG_EVENTS, MODULES, MODULE_BY_ID, MOD_COMMANDS, applyModule, newRRPanel, type ModuleDef, type ModuleId, type RRPanel } from "./registry";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── small field helpers ─────────────────────────────────────────────────────
function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** لیستِ آیدی‌ها (کانال/نقش) — هر آیدی یک چیپ؛ Enter یا ویرگول برای افزودن. */
function IdList({ value, onChange, placeholder, max = 5 }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number }) {
  const [draft, setDraft] = useState("");
  const list: string[] = Array.isArray(value) ? value : [];
  const commit = () => {
    const ids = draft.split(/[\s,،]+/).map((x) => x.replace(/[^\d]/g, "")).filter((x) => x.length >= 15);
    if (ids.length) onChange([...new Set([...list, ...ids])].slice(0, max));
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5" dir="ltr">
          {list.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 font-mono text-[11px]">
              {id}
              <button type="button" aria-label="remove" className="text-muted-foreground hover:text-destructive" onClick={() => onChange(list.filter((x) => x !== id))}>×</button>
            </span>
          ))}
        </div>
      )}
      {list.length < max && (
        <Input dir="ltr" inputMode="numeric" placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }} />
      )}
    </div>
  );
}
const IdSingle = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
  <Input dir="ltr" inputMode="numeric" placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} />
);
const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex items-center gap-2 text-sm"><Switch checked={!!checked} onCheckedChange={onChange} />{label}</label>
);

/** پیام (متن ساده یا Embed) — مشترک بین خوش‌آمد و خداحافظی */
function MessageFields({ c, set, fa, vars }: { c: any; set: (p: any) => void; fa: boolean; vars: string }) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-3">
      <Field label={t("قالب پیام", "Message style")}>
        <NativeSelect value={c.mode} onChange={(v) => set({ mode: v })}>
          <option value="embed">{t("کارت (Embed)", "Embed card")}</option>
          <option value="text">{t("متن ساده", "Plain text")}</option>
        </NativeSelect>
      </Field>
      {c.mode === "embed" && <Field label={t("عنوان", "Title")}><Input maxLength={256} value={c.title} onChange={(e) => set({ title: e.target.value })} /></Field>}
      <Field label={t("متن پیام", "Message text")} hint={vars}>
        <Textarea rows={4} maxLength={2000} value={c.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      {c.mode === "embed" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("رنگ", "Color")}><Input dir="ltr" maxLength={7} value={c.color} onChange={(e) => set({ color: e.target.value })} placeholder="#5865F2" /></Field>
          <Field label={t("تصویر بزرگ (URL، اختیاری)", "Large image (URL, optional)")}><Input dir="ltr" value={c.image} onChange={(e) => set({ image: e.target.value })} placeholder="https://…" /></Field>
          <Toggle checked={c.avatar} onChange={(v) => set({ avatar: v })} label={t("آواتار عضو به‌عنوان تصویر کوچک", "Member avatar as thumbnail")} />
        </div>
      )}
    </div>
  );
}

const VARS_MEMBER_FA = "متغیرها: {member.mention} {member.display_name} {guild.name} {guild.member_count}";
const VARS_MEMBER_EN = "Variables: {member.mention} {member.display_name} {guild.name} {guild.member_count}";

// ─── per-module forms ────────────────────────────────────────────────────────
function WelcomeForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <Field label={t("کانال(های) پیام خوش‌آمد", "Welcome channel(s)")} hint={t("تا ۵ کانال. در دیسکورد Developer Mode را روشن کنید → راست‌کلیک روی کانال → Copy ID.", "Up to 5. Enable Developer Mode → right-click a channel → Copy ID.")}>
        <IdList value={c.channels} onChange={(v) => set({ channels: v })} placeholder={t("آیدی کانال را بچسبانید و Enter بزنید", "Paste a channel ID and press Enter")} />
      </Field>
      <MessageFields c={c} set={set} fa={fa} vars={fa ? VARS_MEMBER_FA : VARS_MEMBER_EN} />
      <div className="space-y-2 rounded-lg border p-3">
        <Toggle checked={c.dm} onChange={(v) => set({ dm: v })} label={t("پیام خصوصی (DM) هم بفرست", "Also send a DM")} />
        {c.dm && <Textarea rows={3} maxLength={2000} value={c.dmText} onChange={(e) => set({ dmText: e.target.value })} />}
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <Toggle checked={c.skipBots} onChange={(v) => set({ skipBots: v })} label={t("برای بات‌ها پیام نفرست", "Ignore bots")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("حداقل سنِ حساب (روز) — ۰ = بدون محدودیت", "Minimum account age (days) — 0 = off")}>
            <Input dir="ltr" inputMode="numeric" value={c.minAccountDays} onChange={(e) => set({ minAccountDays: Math.max(0, Math.min(365, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
          </Field>
          {Number(c.minAccountDays) > 0 && (
            <Field label={t("اگر حساب خیلی تازه بود", "If the account is too new")}>
              <NativeSelect value={c.youngAction} onChange={(v) => set({ youngAction: v })}>
                <option value="kick">{t("اخراج (با پیام خصوصی)", "Kick (with a DM)")}</option>
                <option value="skip">{t("فقط پیام خوش‌آمد نفرست", "Only skip the welcome")}</option>
              </NativeSelect>
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

function GoodbyeForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <Field label={t("کانال(های) پیام خداحافظی", "Goodbye channel(s)")}>
        <IdList value={c.channels} onChange={(v) => set({ channels: v })} placeholder={t("آیدی کانال", "Channel ID")} />
      </Field>
      <MessageFields c={c} set={set} fa={fa} vars={fa ? VARS_MEMBER_FA : VARS_MEMBER_EN} />
      <Toggle checked={c.skipBots} onChange={(v) => set({ skipBots: v })} label={t("برای بات‌ها پیام نفرست", "Ignore bots")} />
    </div>
  );
}

function AutoRoleForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <Field label={t("نقش(های) اعضای تازه", "Roles for new members")} hint={t("نقش بات باید بالاتر از این نقش‌ها در لیست نقش‌های سرور باشد.", "The bot's role must sit above these roles in the server's role list.")}>
        <IdList value={c.memberRoles} onChange={(v) => set({ memberRoles: v })} placeholder={t("آیدی نقش", "Role ID")} />
      </Field>
      <Field label={t("نقش(های) بات‌هایی که وارد می‌شوند", "Roles for bots that join")}>
        <IdList value={c.botRoles} onChange={(v) => set({ botRoles: v })} placeholder={t("آیدی نقش", "Role ID")} />
      </Field>
      <Field label={t("تأخیر قبل از دادن نقش (ثانیه، حداکثر ۳۰)", "Delay before giving roles (seconds, max 30)")}>
        <Input dir="ltr" className="max-w-28" inputMode="numeric" value={c.delaySec} onChange={(e) => set({ delaySec: Math.max(0, Math.min(30, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
      </Field>
    </div>
  );
}

function ReactionRolesForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  const panels: RRPanel[] = c.panels ?? [];
  const upd = (i: number, patch: Partial<RRPanel>) => set({ panels: panels.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="space-y-4">
      {panels.map((p, i) => (
        <div key={p.id} className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{t("پنل", "Panel")} {i + 1}</h4>
            <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => set({ panels: panels.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("نوع پیام", "Message")}>
              <NativeSelect value={p.mode} onChange={(v) => upd(i, { mode: v as RRPanel["mode"] })}>
                <option value="post">{t("بات خودش پنل را بفرستد (با دستور اسلش)", "The bot posts the panel (via a slash command)")}</option>
                <option value="existing">{t("روی یک پیامِ موجود (آیدی پیام)", "On an existing message (message ID)")}</option>
              </NativeSelect>
            </Field>
            <Field label={p.mode === "post" ? t("کانالِ ارسال پنل", "Channel to post in") : t("کانالِ آن پیام", "Channel of that message")}>
              <IdSingle value={p.channel} onChange={(v) => upd(i, { channel: v })} placeholder={t("آیدی کانال", "Channel ID")} />
            </Field>
            {p.mode === "existing" && (
              <Field label={t("آیدی پیام", "Message ID")} className="sm:col-span-2" hint={t("راست‌کلیک روی پیام → Copy Message ID", "Right-click the message → Copy Message ID")}>
                <IdSingle value={p.messageId} onChange={(v) => upd(i, { messageId: v })} placeholder={t("آیدی پیام", "Message ID")} />
              </Field>
            )}
          </div>
          {p.mode === "post" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("عنوان پنل", "Panel title")}><Input maxLength={256} value={p.title} onChange={(e) => upd(i, { title: e.target.value })} /></Field>
              <Field label={t("رنگ", "Color")}><Input dir="ltr" maxLength={7} value={p.color} onChange={(e) => upd(i, { color: e.target.value })} /></Field>
              <Field label={t("توضیحات (فهرست ایموجی‌ها خودکار اضافه می‌شود)", "Description (the emoji list is appended automatically)")} className="sm:col-span-2">
                <Textarea rows={3} maxLength={1500} value={p.description} onChange={(e) => upd(i, { description: e.target.value })} />
              </Field>
            </div>
          )}
          <div className="space-y-2">
            <h5 className="text-xs font-semibold">{t("ایموجی ← نقش", "Emoji → role")}</h5>
            {p.pairs.map((x, k) => (
              <div key={k} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2">
                <Input className="text-center text-lg" maxLength={60} placeholder="😀" value={x.emoji} onChange={(e) => upd(i, { pairs: p.pairs.map((y, j) => (j === k ? { ...y, emoji: e.target.value } : y)) })} />
                <IdSingle value={x.role} onChange={(v) => upd(i, { pairs: p.pairs.map((y, j) => (j === k ? { ...y, role: v } : y)) })} placeholder={t("آیدی نقش", "Role ID")} />
                <Button type="button" size="icon" variant="ghost" onClick={() => upd(i, { pairs: p.pairs.filter((_, j) => j !== k) })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            {p.pairs.length < 10 && <Button type="button" size="sm" variant="outline" onClick={() => upd(i, { pairs: [...p.pairs, { emoji: "", role: "" }] })}><Plus className="me-1 size-3.5" />{t("افزودن ایموجی", "Add emoji")}</Button>}
            <p className="text-[11px] text-muted-foreground">{t("ایموجی سفارشی سرور را به شکل <:name:id> بنویسید.", "Write custom server emoji as <:name:id>.")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle checked={p.removeOnUnreact} onChange={(v) => upd(i, { removeOnUnreact: v })} label={t("با برداشتن ری‌اکشن، نقش گرفته شود", "Remove the role when the reaction is removed")} />
            <Toggle checked={p.unique} onChange={(v) => upd(i, { unique: v })} label={t("فقط یک نقش از این پنل (انتخاب تکی)", "Only one role from this panel")} />
            <Toggle checked={p.dm} onChange={(v) => upd(i, { dm: v })} label={t("تأیید با پیام خصوصی", "Confirm with a DM")} />
          </div>
          <p className="rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
            {p.mode === "post"
              ? t(`بعد از ذخیره و روشن‌بودن بات، در سرور دستور /${(p.name || `rr${i + 1}`)}-setup را اجرا کنید تا پنل ساخته شود.`, `After saving with the bot running, run /${(p.name || `rr${i + 1}`)}-setup in your server to post the panel.`)
              : t(`بعد از ذخیره، دستور /${(p.name || `rr${i + 1}`)}-setup ایموجی‌ها را زیر آن پیام می‌گذارد.`, `After saving, /${(p.name || `rr${i + 1}`)}-setup adds the emojis under that message.`)}
          </p>
        </div>
      ))}
      {panels.length < 4 && <Button type="button" variant="outline" onClick={() => set({ panels: [...panels, newRRPanel(fa, panels.length + 1)] })}><Plus className="me-2 size-4" />{t("پنل ری‌اکشن‌رول جدید", "New reaction-role panel")}</Button>}
    </div>
  );
}

function VerificationForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <Field label={t("کانالِ پنل تأیید", "Verification channel")}><IdSingle value={c.channel} onChange={(v) => set({ channel: v })} placeholder={t("آیدی کانال", "Channel ID")} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("نقش(های) تأییدشده — داده می‌شود", "Verified role(s) — given")}><IdList max={3} value={c.giveRoles} onChange={(v) => set({ giveRoles: v })} placeholder={t("آیدی نقش", "Role ID")} /></Field>
        <Field label={t("نقش(های) تأییدنشده — گرفته می‌شود (اختیاری)", "Unverified role(s) — removed (optional)")}><IdList max={3} value={c.removeRoles} onChange={(v) => set({ removeRoles: v })} placeholder={t("آیدی نقش", "Role ID")} /></Field>
        <Field label={t("عنوان", "Title")}><Input maxLength={256} value={c.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label={t("متن دکمه", "Button label")}><Input maxLength={80} value={c.button} onChange={(e) => set({ button: e.target.value })} /></Field>
        <Field label={t("توضیحات", "Description")} className="sm:col-span-2"><Textarea rows={3} maxLength={1500} value={c.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label={t("پیام بعد از تأیید (فقط برای خودش)", "Reply after verifying (only visible to them)")} className="sm:col-span-2"><Input maxLength={300} value={c.done} onChange={(e) => set({ done: e.target.value })} /></Field>
      </div>
      <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">{t("بعد از ذخیره و روشن‌بودن بات، دستور /verify-setup را در سرور اجرا کنید تا پنل ساخته شود.", "After saving with the bot running, run /verify-setup in your server to post the panel.")}</p>
    </div>
  );
}

function LogsForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <Field label={t("کانال لاگ", "Log channel")} hint={t("بهتر است کانالی خصوصی برای مدیران باشد.", "Preferably a private staff channel.")}>
        <IdSingle value={c.channel} onChange={(v) => set({ channel: v })} placeholder={t("آیدی کانال", "Channel ID")} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {LOG_EVENTS.map((e) => <Toggle key={e.on} checked={!!c.on?.[e.on]} onChange={(v) => set({ on: { ...c.on, [e.on]: v } })} label={fa ? e.fa : e.en} />)}
      </div>
    </div>
  );
}

function AutomodForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <Field label={t("کلمات ممنوع (هر خط یا با ویرگول، تا ۱۵ مورد)", "Banned words (one per line or comma-separated, up to 15)")}>
        <Textarea rows={3} value={c.words} onChange={(e) => set({ words: e.target.value })} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle checked={c.blockInvites} onChange={(v) => set({ blockInvites: v })} label={t("حذف لینک دعوتِ دیسکورد", "Delete Discord invite links")} />
        <Toggle checked={c.blockLinks} onChange={(v) => set({ blockLinks: v })} label={t("حذف همه‌ی لینک‌ها", "Delete all links")} />
        <Toggle checked={c.warn} onChange={(v) => set({ warn: v })} label={t("اخطار در همان کانال", "Warn in the same channel")} />
      </div>
      {c.warn && <Field label={t("متن اخطار", "Warning text")}><Input maxLength={300} value={c.warnText} onChange={(e) => set({ warnText: e.target.value })} /></Field>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("تایم‌اوت (دقیقه) — ۰ = ندارد", "Timeout (minutes) — 0 = none")}>
          <Input dir="ltr" inputMode="numeric" className="max-w-28" value={c.timeoutMin} onChange={(e) => set({ timeoutMin: Math.max(0, Math.min(40320, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
        </Field>
        <Field label={t("کانال لاگ (اختیاری)", "Log channel (optional)")}><IdSingle value={c.logChannel} onChange={(v) => set({ logChannel: v })} placeholder={t("آیدی کانال", "Channel ID")} /></Field>
      </div>
      <Field label={t("نقش‌های معاف از بررسی", "Exempt roles")}><IdList value={c.exemptRoles} onChange={(v) => set({ exemptRoles: v })} placeholder={t("آیدی نقش (مثلاً مدیران)", "Role ID (e.g. staff)")} /></Field>
    </div>
  );
}

function ModerationForm({ c, set, fa }: FormProps) {
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MOD_COMMANDS.map((k) => <Toggle key={k} checked={!!c.on?.[k]} onChange={(v) => set({ on: { ...c.on, [k]: v } })} label={`/${k}`} />)}
      </div>
      <Field label={t("کانال لاگ مدیریتی (اختیاری)", "Moderation log channel (optional)")}><IdSingle value={c.logChannel} onChange={(v) => set({ logChannel: v })} placeholder={t("آیدی کانال", "Channel ID")} /></Field>
      <p className="text-[11px] text-muted-foreground">{t("هر دستور دسترسی واقعیِ اجراکننده را (kick/ban/…) و سلسله‌مراتب نقش‌ها را چک می‌کند.", "Each command checks the caller's real permission and the role hierarchy.")}</p>
    </div>
  );
}

interface FormProps { c: any; set: (p: any) => void; fa: boolean }
const FORMS: Record<ModuleId, (p: FormProps) => React.ReactElement> = {
  welcome: WelcomeForm, goodbye: GoodbyeForm, autorole: AutoRoleForm, reaction_roles: ReactionRolesForm,
  verification: VerificationForm, logs: LogsForm, automod: AutomodForm, moderation: ModerationForm,
};

// ─── card ────────────────────────────────────────────────────────────────────
function ModuleCard({ def, bp, setBp, env }: { def: ModuleDef; bp: DiscordBlueprint; setBp: (b: DiscordBlueprint) => void; env: EditorEnv }) {
  const { toast } = useToast();
  const fa = env.fa;
  const t = (a: string, b: string) => (fa ? a : b);
  const stored = bp.modules?.[def.id];
  const [open, setOpen] = useState(false);
  const cfg = useMemo(() => stored ?? def.defaults(fa), [stored, def, fa]);
  const Icon = MODULE_ICONS[def.icon] ?? Blocks;
  const Form = FORMS[def.id];
  const problems = def.problems(cfg, fa);
  const generated = cfg.enabled ? def.generate(cfg, env) : { events: [], commands: [] };

  const commit = (next: any) => {
    const r = applyModule(bp, def.id, next, env);
    if (r.error) {
      toast({ variant: "destructive", title: t("اعمال نشد", "Couldn't apply"), description:
        r.error === "events" ? t("سقف تعداد رویدادها پر شده است.", "The event limit is reached.")
        : r.error === "commands" ? t("سقف تعداد دستورها پر شده است.", "The command limit is reached.")
        : t("نام یکی از دستورهای این ماژول با دستورِ دیگری تکراری است. دستور قبلی را تغییر دهید.", "One of this module's command names clashes with an existing command.") });
      return;
    }
    setBp(r.bp);
  };

  return (
    <Card className={cn("transition", cfg.enabled && "border-primary/40")}>
      <CardContent className="p-0">
        <div className="flex items-start gap-3 p-4">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl ring-1", cfg.enabled ? "bg-primary/10 text-primary ring-primary/20" : "bg-muted text-muted-foreground ring-border")}><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{fa ? def.title[0] : def.title[1]}</h3>
              {cfg.enabled && problems.length === 0 && <Badge variant="secondary" className="text-[10px]">{generated.events.length + generated.commands.length} {t("خودکارسازی", "automations")}</Badge>}
              {cfg.enabled && problems.length > 0 && <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600">{t("نیاز به تنظیم", "Needs setup")}</Badge>}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{fa ? def.desc[0] : def.desc[1]}</p>
          </div>
          <Switch checked={!!cfg.enabled} aria-label={fa ? def.title[0] : def.title[1]} onCheckedChange={(v) => { commit({ ...cfg, enabled: v }); if (v) setOpen(true); }} />
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-primary">
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />{open ? t("بستن تنظیمات", "Hide settings") : t("تنظیمات", "Settings")}
          </button>
          <div className="flex flex-wrap justify-end gap-1">{def.needs.map(([a, b]) => <Badge key={b} variant="outline" className="text-[10px]" dir="ltr">{fa ? a : b}</Badge>)}</div>
        </div>
        {open && (
          <div className="space-y-4 border-t bg-muted/20 p-4">
            {cfg.enabled && problems.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <ul className="space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}
            <Form c={cfg} fa={fa} set={(patch) => commit({ ...cfg, ...patch })} />
            {!cfg.enabled && <p className="text-xs text-muted-foreground">{t("برای اعمال، کلید بالای کارت را روشن کنید.", "Turn on the switch above to apply.")}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ModulesSection({ bp, setBp, env }: { bp: DiscordBlueprint; setBp: (b: DiscordBlueprint) => void; env: EditorEnv }) {
  const fa = env.fa;
  const t = (a: string, b: string) => (fa ? a : b);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("قابلیت‌های آماده را روشن و تنظیم کنید؛ هر کدام خودش رویداد و دستورهای لازم را می‌سازد. نتیجه را می‌توانید در بخش «رویدادها» و «دستورها» ببینید. اگر آن‌جا دستی چیزی را ویرایش کنید، با تغییر بعدیِ فرمِ ماژول دوباره از روی فرم ساخته می‌شود؛ برای شخصی‌سازی بیشتر، یک رویداد/دستور جدید بسازید.",
          "Switch ready-made features on and configure them; each builds the events and commands it needs. You can see the result under Events and Commands. Manual edits to generated items are overwritten the next time the module form changes — for custom behaviour create a new event/command.")}
      </p>
      <div className="grid gap-3 xl:grid-cols-2">
        {MODULES.map((m) => <ModuleCard key={m.id} def={MODULE_BY_ID[m.id]} bp={bp} setBp={setBp} env={env} />)}
      </div>
    </div>
  );
}
