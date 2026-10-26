import { newAction, type EditorEnv } from "../action-editor";
import { newId } from "../ids";
import type { DiscordBlueprint } from "@/lib/discord-bots-api";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ماژول‌ها = قابلیت‌های آماده‌ی بات دیسکورد با یک فرمِ ساده.
 * هر ماژول از روی تنظیماتش «رویداد/دستور» عادیِ بلوپرینت می‌سازد (با برچسب `module`) و تنظیمات خام را در
 * `blueprint.modules[id]` نگه می‌دارد تا هر وقت فرم عوض شد، همان رویدادها دوباره ساخته شوند.
 * هر چیزی که این‌جا ساخته می‌شود را می‌توان در تب «رویدادها / دستورها» هم دید و دستی ویرایش کرد (با دوباره‌سازی از فرم بازنویسی می‌شود).
 */

export type ModuleId = "welcome" | "goodbye" | "autorole" | "reaction_roles" | "verification" | "logs" | "automod" | "moderation";

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
const idList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[\s,،]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);

export function mk(env: EditorEnv, type: string, patch: Record<string, any> = {}): any {
  const spec = env.actionByType[type];
  const base = spec ? newAction(spec) : { type };
  return { ...base, ...patch };
}
const cond = (env: EditorEnv, ifc: any, then: any[], els: any[] = []) => mk(env, "condition", { if: ifc, then, else: els });
const rule = (left: string, op: string, right = "") => ({ left, op, right });
const allOf = (rules: any[]) => (rules.length === 0 ? {} : rules.length === 1 ? rules[0] : { and: rules });
const ev = (module: string, on: string, filters: any, actions: any[]) => ({ id: newId(), on, enabled: true, filters, actions, module });
const cmd = (module: string, name: string, description: string, actions: any[], extra: Record<string, any> = {}) => ({
  id: newId(), name, description, type: "slash", enabled: true, ephemeral: false, cooldown: 0, permissions: [], options: [], actions, module, ...extra,
});
const opt = (name: string, type: string, description: string, required = true) => ({ name, type, description, required });

function messageActions(env: EditorEnv, channels: string[], c: { mode: string; text: string; title: string; color: string; image: string; avatar: boolean; footer?: string }) {
  return channels.map((ch) =>
    c.mode === "embed"
      ? mk(env, "send_embed", { channel: ch, title: c.title, description: c.text, color: c.color || "#5865F2", image: c.image, thumbnail: c.avatar ? "{member.avatar}" : "", footer: c.footer ?? "", timestamp: true })
      : mk(env, "send_message", { channel: ch, content: c.text }),
  );
}

// ─── welcome ─────────────────────────────────────────────────────────────────
const welcome: ModuleDef = {
  id: "welcome", icon: "PartyPopper",
  title: ["خوش‌آمدگویی", "Welcome"], desc: ["وقتی عضوی وارد سرور شد: پیام در چند کانال، پیام خصوصی، فیلتر حساب‌های تازه‌ساخته.", "When someone joins: messages in several channels, a DM, and a new-account filter."],
  needs: [["Server Members Intent", "Server Members Intent"]],
  defaults: (fa) => ({
    enabled: false, channels: [], mode: "embed", title: fa ? "خوش آمدی! 🎉" : "Welcome! 🎉",
    text: fa ? "سلام {member.mention}، به **{guild.name}** خوش اومدی!\nتو عضو شماره‌ی {guild.member_count} هستی." : "Hi {member.mention}, welcome to **{guild.name}**!\nYou are member #{guild.member_count}.",
    color: "#5865F2", image: "", avatar: true, dm: false, dmText: fa ? "سلام! به {guild.name} خوش آمدی. قوانین را در کانال قوانین بخوان." : "Hi! Welcome to {guild.name}. Please read the rules channel.",
    skipBots: true, minAccountDays: 0, youngAction: "kick", youngDm: fa ? "حساب شما برای ورود به این سرور خیلی تازه است." : "Your account is too new to join this server.",
  }),
  problems: (c, fa) => (idList(c.channels).length === 0 && !c.dm ? [fa ? "حداقل یک کانال یا پیام خصوصی لازم است" : "Add at least one channel or enable the DM"] : []),
  generate: (c, env) => {
    const channels = idList(c.channels).slice(0, 5);
    const filters = allOf(c.skipBots ? [rule("{member.is_bot}", "==", "false")] : []);
    const acts: any[] = [];
    const days = Number(c.minAccountDays) || 0;
    if (days > 0) {
      const young: any[] = [];
      if (c.youngDm) young.push(mk(env, "dm_user", { target: "{member.id}", content: c.youngDm }));
      if (c.youngAction === "kick") young.push(mk(env, "kick_member", { target: "{member.id}", reason: `account younger than ${days} days` }));
      young.push(mk(env, "stop"));
      acts.push(cond(env, rule("{member.account_age_days}", "<", String(days)), young));
    }
    acts.push(...messageActions(env, channels, c));
    if (c.dm) acts.push(mk(env, "dm_user", { target: "{member.id}", content: c.dmText }));
    return { events: [ev("welcome", "member_join", filters, acts)], commands: [] };
  },
};

// ─── goodbye ─────────────────────────────────────────────────────────────────
const goodbye: ModuleDef = {
  id: "goodbye", icon: "DoorOpen",
  title: ["خداحافظی", "Goodbye"], desc: ["وقتی عضوی از سرور رفت، در کانال(های) مشخص‌شده پیام بگذارد.", "Post a message in chosen channels when someone leaves."],
  needs: [["Server Members Intent", "Server Members Intent"]],
  defaults: (fa) => ({ enabled: false, channels: [], mode: "text", title: fa ? "خداحافظ" : "Goodbye", text: fa ? "**{member.display_name}** از سرور رفت 👋" : "**{member.display_name}** has left 👋", color: "#ED4245", image: "", avatar: false, skipBots: true }),
  problems: (c, fa) => (idList(c.channels).length === 0 ? [fa ? "حداقل یک کانال لازم است" : "Add at least one channel"] : []),
  generate: (c, env) => ({
    events: [ev("goodbye", "member_remove", allOf(c.skipBots ? [rule("{member.is_bot}", "==", "false")] : []), messageActions(env, idList(c.channels).slice(0, 5), c))],
    commands: [],
  }),
};

// ─── auto role ───────────────────────────────────────────────────────────────
const autorole: ModuleDef = {
  id: "autorole", icon: "BadgePlus",
  title: ["نقش خودکار", "Auto roles"], desc: ["به هر عضوِ تازه (و جداگانه به بات‌ها) خودکار نقش بدهد، با تأخیر اختیاری.", "Give roles to new members (and separately to bots) automatically, with an optional delay."],
  needs: [["Server Members Intent", "Server Members Intent"], ["Manage Roles", "Manage Roles"]],
  defaults: () => ({ enabled: false, memberRoles: [], botRoles: [], delaySec: 0 }),
  problems: (c, fa) => (idList(c.memberRoles).length + idList(c.botRoles).length === 0 ? [fa ? "حداقل یک نقش لازم است" : "Add at least one role"] : []),
  generate: (c, env) => {
    const wait = Math.max(0, Math.min(30, Number(c.delaySec) || 0));
    const give = (roles: string[]) => [...(wait ? [mk(env, "wait", { seconds: wait })] : []), ...roles.map((r) => mk(env, "add_role", { target: "{member.id}", role: r, reason: "IrForge auto role" }))];
    const events: any[] = [];
    const m = idList(c.memberRoles).slice(0, 5), b = idList(c.botRoles).slice(0, 5);
    if (m.length) events.push(ev("autorole", "member_join", rule("{member.is_bot}", "==", "false"), give(m)));
    if (b.length) events.push(ev("autorole", "member_join", rule("{member.is_bot}", "==", "true"), give(b)));
    return { events, commands: [] };
  },
};

// ─── reaction roles ──────────────────────────────────────────────────────────
export interface RRPanel { id: string; name: string; mode: "post" | "existing"; channel: string; messageId: string; title: string; description: string; color: string; unique: boolean; removeOnUnreact: boolean; dm: boolean; pairs: { emoji: string; role: string }[] }
export const newRRPanel = (fa: boolean, n: number): RRPanel => ({
  id: newId().slice(0, 8), name: `rr${n}`, mode: "post", channel: "", messageId: "", title: fa ? "انتخاب نقش" : "Pick your roles", color: "#5865F2",
  description: fa ? "با زدن ری‌اکشن زیر نقش بگیرید؛ با برداشتن ری‌اکشن نقش برداشته می‌شود." : "React below to get a role; remove the reaction to lose it.",
  unique: false, removeOnUnreact: true, dm: false, pairs: [{ emoji: "✅", role: "" }],
});
const reactionRoles: ModuleDef = {
  id: "reaction_roles", icon: "SmilePlus",
  title: ["ری‌اکشن رول", "Reaction roles"], desc: ["با ری‌اکشن روی یک پیام نقش بده؛ با برداشتن ری‌اکشن نقش را بگیر. حالت «فقط یکی» هم دارد.", "Give a role when someone reacts, take it back when they remove it. Optional «pick only one» mode."],
  needs: [["Manage Roles", "Manage Roles"], ["Add Reactions", "Add Reactions"]],
  defaults: (fa) => ({ enabled: false, panels: [newRRPanel(fa, 1)] }),
  problems: (c, fa) => {
    const out: string[] = [];
    (c.panels ?? []).forEach((p: RRPanel, i: number) => {
      const n = `${fa ? "پنل" : "Panel"} ${i + 1}`;
      if (!p.channel.trim()) out.push(`${n}: ${fa ? "کانال خالی است" : "channel is empty"}`);
      if (p.mode === "existing" && !p.messageId.trim()) out.push(`${n}: ${fa ? "آیدی پیام خالی است" : "message ID is empty"}`);
      if (p.pairs.some((x) => !x.emoji.trim() || !x.role.trim())) out.push(`${n}: ${fa ? "هر ایموجی باید نقش داشته باشد" : "every emoji needs a role"}`);
    });
    return out;
  },
  generate: (c, env) => {
    const events: any[] = [];
    const commands: any[] = [];
    (c.panels as RRPanel[] ?? []).slice(0, 4).forEach((p, pi) => {
      const pairs = p.pairs.filter((x) => x.emoji.trim() && x.role.trim()).slice(0, 10);
      if (!pairs.length) return;
      const key = `rr_${p.id}`;
      const target = p.mode === "existing" ? p.messageId.trim() : "{rr_msg}";
      const isPanel = (acts: any[]) => (p.mode === "existing"
        ? [cond(env, rule("{message.id}", "==", p.messageId.trim()), acts)]
        : [mk(env, "database_get", { key, store_as: "rr_msg", default: "" }), cond(env, rule("{message.id}", "==", "{rr_msg}"), acts)]);
      const addBranch = pairs.map((x) => cond(env, rule("{reaction.emoji}", "==", x.emoji.trim()), [
        ...(p.unique ? pairs.filter((o) => o !== x).map((o) => mk(env, "remove_role", { target: "{author.id}", role: o.role.trim(), reason: "reaction role (single choice)" })) : []),
        mk(env, "add_role", { target: "{author.id}", role: x.role.trim(), reason: "reaction role" }),
        ...(p.dm ? [mk(env, "dm_user", { target: "{author.id}", content: `✅ <@&${x.role.trim()}>` })] : []),
      ]));
      events.push(ev("reaction_roles", "reaction_add", {}, isPanel(addBranch)));
      if (p.removeOnUnreact) {
        const rmBranch = pairs.map((x) => cond(env, rule("{reaction.emoji}", "==", x.emoji.trim()), [mk(env, "remove_role", { target: "{author.id}", role: x.role.trim(), reason: "reaction role removed" })]));
        events.push(ev("reaction_roles", "reaction_remove", {}, isPanel(rmBranch)));
      }
      const reactAll = pairs.map((x) => mk(env, "add_reaction", { emoji: x.emoji.trim(), channel: p.channel.trim(), message_id: p.mode === "existing" ? target : "{panel_msg}" }));
      const list = pairs.map((x) => `${x.emoji.trim()} → <@&${x.role.trim()}>`).join("\n");
      const setup = p.mode === "existing"
        ? [...reactAll, mk(env, "reply", { content: "✅ ری‌اکشن‌ها اضافه شد / Reactions added", ephemeral: true })]
        : [
            mk(env, "send_embed", { channel: p.channel.trim(), title: p.title, description: `${p.description}\n\n${list}`.slice(0, 4000), color: p.color || "#5865F2", store_as: "panel_msg" }),
            ...reactAll,
            mk(env, "database_set", { key, value: "{panel_msg}" }),
            mk(env, "reply", { content: "✅ پنل ساخته شد / Panel posted: {panel_msg}", ephemeral: true }),
          ];
      commands.push(cmd("reaction_roles", `${(p.name || `rr${pi + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, "") || `rr${pi + 1}`}-setup`.slice(0, 32),
        p.mode === "existing" ? "Add the reaction-role emojis to the message" : "Post the reaction-role panel", setup, { permissions: ["manage_roles"], ephemeral: true }));
    });
    return { events, commands };
  },
};

// ─── verification ────────────────────────────────────────────────────────────
const verification: ModuleDef = {
  id: "verification", icon: "ShieldCheck",
  title: ["تأیید عضویت", "Verification"], desc: ["پنل با دکمه‌ی تأیید؛ با کلیک نقش «تأییدشده» می‌دهد و نقش «تأییدنشده» را می‌گیرد.", "A panel with a verify button: grants the verified role and removes the unverified one."],
  needs: [["Manage Roles", "Manage Roles"]],
  defaults: (fa) => ({
    enabled: false, channel: "", giveRoles: [], removeRoles: [], title: fa ? "تأیید عضویت" : "Verify yourself",
    description: fa ? "برای دسترسی به بقیه‌ی کانال‌ها دکمه‌ی زیر را بزنید." : "Press the button below to unlock the rest of the server.",
    button: fa ? "تأیید می‌کنم" : "Verify me", color: "#57F287", done: fa ? "✅ تأیید شدید! خوش آمدید." : "✅ You're verified! Welcome.",
  }),
  problems: (c, fa) => [...(!String(c.channel).trim() ? [fa ? "کانالِ پنل خالی است" : "panel channel is empty"] : []), ...(idList(c.giveRoles).length === 0 ? [fa ? "نقشِ تأییدشده خالی است" : "verified role is empty"] : [])],
  generate: (c, env) => {
    const give = idList(c.giveRoles).slice(0, 3), rem = idList(c.removeRoles).slice(0, 3);
    const btn = { id: newId(), label: c.button || "Verify", style: "success", emoji: "✅", url: "",
      actions: [...give.map((r) => mk(env, "add_role", { target: "{author.id}", role: r, reason: "verification" })), ...rem.map((r) => mk(env, "remove_role", { target: "{author.id}", role: r, reason: "verification" })), mk(env, "reply", { content: c.done, ephemeral: true })] };
    return { events: [], commands: [cmd("verification", "verify-setup", "Post the verification panel", [
      mk(env, "send_embed", { channel: String(c.channel).trim(), title: c.title, description: c.description, color: c.color || "#57F287", buttons: [btn] }),
      mk(env, "reply", { content: "✅ Panel posted", ephemeral: true }),
    ], { permissions: ["manage_roles"], ephemeral: true })] };
  },
};

// ─── logs ────────────────────────────────────────────────────────────────────
export const LOG_EVENTS: { on: string; fa: string; en: string; color: string; vars: string }[] = [
  { on: "member_join", fa: "ورود عضو", en: "Member joined", color: "#57F287", vars: "{member.mention} ({member.id})" },
  { on: "member_remove", fa: "خروج عضو", en: "Member left", color: "#ED4245", vars: "{member.display_name} ({member.id})" },
  { on: "message_delete", fa: "حذف پیام", en: "Message deleted", color: "#FEE75C", vars: "{channel.mention}\n{message.content}" },
  { on: "message_edit", fa: "ویرایش پیام", en: "Message edited", color: "#FEE75C", vars: "{author.mention} {channel.mention}\n**قبل/Before:** {before.content}\n**بعد/After:** {message.content}" },
  { on: "member_role_add", fa: "گرفتن نقش", en: "Role added", color: "#5865F2", vars: "{member.mention} ← {role.name}" },
  { on: "member_role_remove", fa: "از دست‌دادن نقش", en: "Role removed", color: "#5865F2", vars: "{member.mention} ✕ {role.name}" },
  { on: "member_ban", fa: "بن", en: "Ban", color: "#ED4245", vars: "{member.name} ({member.id})" },
  { on: "member_unban", fa: "آنبن", en: "Unban", color: "#57F287", vars: "{member.name} ({member.id})" },
  { on: "voice_join", fa: "ورود به صوتی", en: "Voice join", color: "#EB459E", vars: "{member.mention} → {voice.channel_name}" },
  { on: "voice_leave", fa: "خروج از صوتی", en: "Voice leave", color: "#EB459E", vars: "{member.mention} ← {voice.channel_name}" },
  { on: "channel_create", fa: "ساخت کانال", en: "Channel created", color: "#57F287", vars: "{channel.name} ({channel.id})" },
  { on: "channel_delete", fa: "حذف کانال", en: "Channel deleted", color: "#ED4245", vars: "{channel.name} ({channel.id})" },
];
const logs: ModuleDef = {
  id: "logs", icon: "ScrollText",
  title: ["لاگ سرور", "Server logs"], desc: ["گزارش اتفاق‌های سرور (ورود/خروج، پیام حذف‌شده، نقش، بن، صوتی …) در یک کانال.", "Report what happens in the server (joins, deleted messages, roles, bans, voice…) to one channel."],
  needs: [["Server Members Intent", "Server Members Intent"], ["Message Content Intent", "Message Content Intent"]],
  defaults: () => ({ enabled: false, channel: "", on: { member_join: true, member_remove: true, message_delete: true, message_edit: false, member_role_add: false, member_role_remove: false, member_ban: true, member_unban: true, voice_join: false, voice_leave: false, channel_create: false, channel_delete: false } }),
  problems: (c, fa) => [...(!String(c.channel).trim() ? [fa ? "کانال لاگ خالی است" : "log channel is empty"] : []), ...(Object.values(c.on ?? {}).some(Boolean) ? [] : [fa ? "حداقل یک رویداد را انتخاب کنید" : "Pick at least one event"])],
  generate: (c, env) => ({
    commands: [],
    events: LOG_EVENTS.filter((e) => c.on?.[e.on]).map((e) => ev("logs", e.on, e.on === "message_delete" || e.on === "message_edit" ? rule("{author.is_bot}", "!=", "true") : {}, [
      mk(env, "send_embed", { channel: String(c.channel).trim(), title: `${e.fa} · ${e.en}`, description: e.vars, color: e.color, timestamp: true, footer: "{guild.name}" }),
    ])),
  }),
};

// ─── automod ─────────────────────────────────────────────────────────────────
const automod: ModuleDef = {
  id: "automod", icon: "ShieldAlert",
  title: ["مدیریت خودکار چت", "Auto-moderation"], desc: ["کلمات ممنوع، لینک و دعوت‌نامه را حذف کند؛ اخطار بدهد یا کاربر را تایم‌اوت کند. نقش‌های معاف قابل تعریف است.", "Delete banned words, links and invites; warn or time out the author. Exempt roles supported."],
  needs: [["Message Content Intent", "Message Content Intent"], ["Manage Messages", "Manage Messages"], ["Moderate Members (برای تایم‌اوت)", "Moderate Members (for timeouts)"]],
  defaults: (fa) => ({ enabled: false, words: "", blockLinks: false, blockInvites: true, warn: true, warnText: fa ? "⚠️ {author.mention} این پیام مجاز نیست و حذف شد." : "⚠️ {author.mention} that message isn't allowed and was removed.", timeoutMin: 0, exemptRoles: [], logChannel: "" }),
  problems: (c, fa) => (!String(c.words).trim() && !c.blockLinks && !c.blockInvites ? [fa ? "حداقل یک قانون (کلمه/لینک/دعوت) را فعال کنید" : "Enable at least one rule (words/links/invites)"] : []),
  generate: (c, env) => {
    const words = String(c.words ?? "").split(/[\n,،]+/).map((w) => w.trim()).filter(Boolean).slice(0, 15);
    const hits: any[] = words.map((w) => rule("{message.content}", "contains", w));
    if (c.blockLinks) hits.push(rule("{message.content}", "contains", "http://"), rule("{message.content}", "contains", "https://"));
    else if (c.blockInvites) hits.push(rule("{message.content}", "contains", "discord.gg/"), rule("{message.content}", "contains", "discord.com/invite/"));
    if (!hits.length) return { events: [], commands: [] };
    const guards: any[] = [rule("{author.is_bot}", "!=", "true"), { or: hits }, ...idList(c.exemptRoles).map((r) => ({ not: rule("{author.roles}", "has_role", r) }))];
    const acts: any[] = [mk(env, "delete_message")];
    if (c.warn) acts.push(mk(env, "send_message", { channel: "{channel.id}", content: c.warnText }));
    if (Number(c.timeoutMin) > 0) acts.push(mk(env, "timeout_member", { target: "{author.id}", duration: Math.min(40320, Number(c.timeoutMin)) * 60, reason: "auto-moderation" }));
    if (String(c.logChannel).trim()) acts.push(mk(env, "send_embed", { channel: String(c.logChannel).trim(), title: "AutoMod", description: "{author.mention} · {channel.mention}\n{message.content}", color: "#ED4245", timestamp: true }));
    return { events: [ev("automod", "message", { and: guards }, acts)], commands: [] };
  },
};

// ─── moderation commands ─────────────────────────────────────────────────────
export const MOD_COMMANDS = ["kick", "ban", "timeout", "untimeout", "clear", "warn", "warnings"] as const;
const moderation: ModuleDef = {
  id: "moderation", icon: "Gavel",
  title: ["دستورهای مدیریتی", "Moderation commands"], desc: ["/kick /ban /timeout /clear /warn … با کنترل دسترسی واقعی و ثبت در کانال لاگ.", "/kick /ban /timeout /clear /warn … with real permission checks and optional log channel."],
  needs: [["Kick / Ban / Moderate Members / Manage Messages", "Kick / Ban / Moderate Members / Manage Messages"]],
  defaults: () => ({ enabled: false, logChannel: "", on: { kick: true, ban: true, timeout: true, untimeout: true, clear: true, warn: true, warnings: true } }),
  problems: (c, fa) => (Object.values(c.on ?? {}).some(Boolean) ? [] : [fa ? "حداقل یک دستور را روشن کنید" : "Turn on at least one command"]),
  generate: (c, env) => {
    const log = (text: string) => (String(c.logChannel).trim() ? [mk(env, "send_embed", { channel: String(c.logChannel).trim(), title: "Moderation", description: text, color: "#FEE75C", timestamp: true })] : []);
    const user = opt("user", "user", "Target member"), reason = opt("reason", "string", "Reason", false);
    const defs: Record<string, any> = {
      kick: cmd("moderation", "kick", "Kick a member", [mk(env, "kick_member", { target: "{options.user}", reason: "{options.reason}" }), mk(env, "reply", { content: "👢 {options.user_mention}" }), ...log("👢 {options.user_mention} ← {author.mention}\n{options.reason}")], { permissions: ["kick_members"], options: [user, reason] }),
      ban: cmd("moderation", "ban", "Ban a member", [mk(env, "ban_member", { target: "{options.user}", reason: "{options.reason}" }), mk(env, "reply", { content: "🔨 {options.user_mention}" }), ...log("🔨 {options.user_mention} ← {author.mention}\n{options.reason}")], { permissions: ["ban_members"], options: [user, reason] }),
      timeout: cmd("moderation", "timeout", "Time a member out (minutes)", [mk(env, "math", { store_as: "secs", left: "{options.minutes}", op: "*", right: "60" }), mk(env, "timeout_member", { target: "{options.user}", duration: "{secs}", reason: "{options.reason}" }), mk(env, "reply", { content: "🔇 {options.user_mention}" }), ...log("🔇 {options.user_mention} ← {author.mention}")], { permissions: ["moderate_members"], options: [user, opt("minutes", "integer", "Minutes"), reason] }),
      untimeout: cmd("moderation", "untimeout", "Remove a timeout", [mk(env, "remove_timeout", { target: "{options.user}" }), mk(env, "reply", { content: "🔊 {options.user_mention}" })], { permissions: ["moderate_members"], options: [user] }),
      clear: cmd("moderation", "clear", "Delete recent messages", [mk(env, "purge", { amount: "{options.amount}" }), mk(env, "reply", { content: "🧹 {options.amount}", ephemeral: true }), ...log("🧹 {options.amount} · {channel.mention} ← {author.mention}")], { permissions: ["manage_messages"], options: [opt("amount", "integer", "How many (1-100)")], ephemeral: true }),
      warn: cmd("moderation", "warn", "Warn a member", [mk(env, "database_increment", { key: "warns:{options.user}", amount: 1, store_as: "warns" }), mk(env, "reply", { content: "⚠️ {options.user_mention} — {warns}" }), ...log("⚠️ {options.user_mention} ({warns}) ← {author.mention}\n{options.reason}")], { permissions: ["moderate_members"], options: [user, reason] }),
      warnings: cmd("moderation", "warnings", "Show a member's warnings", [mk(env, "database_get", { key: "warns:{options.user}", store_as: "warns", default: "0" }), mk(env, "reply", { content: "📋 {options.user_mention}: {warns}", ephemeral: true })], { permissions: ["moderate_members"], options: [user], ephemeral: true }),
    };
    return { events: [], commands: MOD_COMMANDS.filter((k) => c.on?.[k]).map((k) => defs[k]) };
  },
};

export const MODULES: ModuleDef[] = [welcome, goodbye, autorole, reactionRoles, verification, logs, automod, moderation];
export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]));

// ─── applying a module to a blueprint ────────────────────────────────────────
export function applyModule(bp: DiscordBlueprint, id: ModuleId, cfg: any, env: EditorEnv): { bp: DiscordBlueprint; error?: "events" | "commands" | "name" } {
  const def = MODULE_BY_ID[id];
  const events = bp.events.filter((e) => e.module !== id);
  const commands = bp.commands.filter((c) => c.module !== id);
  const gen = cfg.enabled ? def.generate(cfg, env) : { events: [], commands: [] };
  if (events.length + gen.events.length > env.catalog.limits.maxEvents) return { bp, error: "events" };
  if (commands.length + gen.commands.length > env.catalog.limits.maxCommands) return { bp, error: "commands" };
  const taken = new Set(commands.map((c) => c.name));
  if (gen.commands.some((c) => taken.has(c.name))) return { bp, error: "name" };
  return { bp: { ...bp, events: [...events, ...gen.events], commands: [...commands, ...gen.commands], modules: { ...(bp.modules ?? {}), [id]: cfg } } };
}
