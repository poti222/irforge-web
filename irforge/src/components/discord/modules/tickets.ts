import { newId } from "../ids";
import { cmd, cond, idList, mk, opt, rule, type ModuleDef } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * سیستم تیکت: پنل (دکمه یا منوی دسته‌ها) ← کانال خصوصی ← پیام خوش‌آمد با دکمه‌های «بستن» و «برداشتن» ← بستن با تأیید،
 * رونوشت گفتگو (HTML/متن) در کانال لاگ و/یا DM، حذف کانال. دستورهای /ticket-* هم فقط داخل تیکت و برای پشتیبان‌ها کار می‌کنند.
 * عمق تودرتوی بلوپرینت ۵ است؛ ساختار این‌جا طوری چیده شده که حتی با فرمِ «دلیل» (مودال) از آن رد نشود.
 */

export interface TicketCategory { id: string; label: string; emoji: string; description: string; prefix: string; discordCategory: string; staffRoles: string[]; welcome: string }
export const newTicketCategory = (fa: boolean, n: number): TicketCategory => ({
  id: `cat${n}`, label: fa ? "پشتیبانی" : "Support", emoji: "🎫", description: fa ? "سؤال یا مشکل خود را مطرح کنید" : "Ask a question or report a problem",
  prefix: "ticket", discordCategory: "", staffRoles: [], welcome: "",
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ticket";

export const tickets: ModuleDef = {
  id: "tickets", icon: "Ticket",
  title: ["تیکت", "Tickets"],
  desc: ["پنل تیکت با دسته‌ها، کانال خصوصی برای هر درخواست، فرم دلیل، برداشتن توسط پشتیبان، بستن با تأیید، رونوشت گفتگو و لاگ.", "A ticket panel with categories, a private channel per request, a reason form, staff claiming, close with confirmation, transcripts and logs."],
  needs: [["Manage Channels", "Manage Channels"], ["Manage Roles", "Manage Roles"], ["Attach Files", "Attach Files"], ["Read Message History", "Read Message History"]],
  defaults: (fa) => ({
    enabled: false, panelChannel: "", panelTitle: fa ? "🎫 پشتیبانی" : "🎫 Support", panelDescription: fa ? "برای ساخت تیکت، از گزینه‌های زیر استفاده کنید. فقط شما و تیم پشتیبانی تیکت را می‌بینید." : "Use the option below to open a ticket. Only you and the support team can see it.",
    panelColor: "#5865F2", panelImage: "", categories: [newTicketCategory(fa, 1)], askReason: true, reasonLabel: fa ? "مشکل خود را توضیح دهید" : "Describe your problem",
    maxPerUser: 1, staffRoles: [], welcomeTitle: fa ? "🎫 تیکت {tk_label}" : "🎫 {tk_label} ticket",
    welcomeText: fa ? "سلام {author.mention}! لطفاً مشکلتان را کامل بنویسید؛ یکی از اعضای تیم به‌زودی پاسخ می‌دهد." : "Hi {author.mention}! Please describe your problem in detail — a team member will reply soon.",
    pingStaff: false, logChannel: "", transcript: true, transcriptFormat: "html", dmTranscript: false, closeConfirm: true, closeDelay: 5, closeOnlyStaff: false, claim: true,
    commands: { add: true, remove: true, rename: true, close: true, transcript: true },
  }),
  problems: (c, fa) => {
    const out: string[] = [];
    if (!String(c.panelChannel).trim()) out.push(fa ? "کانالِ پنل تیکت خالی است" : "panel channel is empty");
    if (!(c.categories ?? []).length) out.push(fa ? "حداقل یک دسته لازم است" : "add at least one category");
    if ((c.categories ?? []).some((x: TicketCategory) => !x.label.trim())) out.push(fa ? "هر دسته به نام نیاز دارد" : "every category needs a label");
    const ids = (c.categories ?? []).map((x: TicketCategory) => x.id);
    if (new Set(ids).size !== ids.length) out.push(fa ? "شناسه‌ی دسته‌ها تکراری است" : "category IDs must be unique");
    const staffAny = idList(c.staffRoles).length + (c.categories ?? []).reduce((n: number, x: TicketCategory) => n + idList(x.staffRoles).length, 0);
    if (staffAny === 0) out.push(fa ? "هیچ نقش پشتیبانی تعریف نشده؛ فقط صاحب تیکت و مدیران کانال آن را می‌بینند" : "no support role set — only the opener and channel managers will see tickets");
    return out;
  },
  generate: (c, env) => {
    const fa = env.fa;
    const t = (a: string, b: string) => (fa ? a : b);
    const cats: TicketCategory[] = (c.categories ?? []).filter((x: TicketCategory) => x.label.trim()).slice(0, 10);
    if (!cats.length || !String(c.panelChannel).trim()) return { events: [], commands: [] };
    const globalStaff = idList(c.staffRoles);
    const allStaff = [...new Set([...globalStaff, ...cats.flatMap((x) => idList(x.staffRoles))])];
    const log = String(c.logChannel).trim();
    const single = cats.length === 1;
    const withReason = single && !!c.askReason;
    const delay = Math.max(0, Math.min(30, Number(c.closeDelay) || 0));
    const max = Math.max(1, Math.min(5, Number(c.maxPerUser) || 1));

    // ── who may do what ───────────────────────────────────────────────────────
    const isStaff = allStaff.length ? { or: allStaff.map((r) => rule("{author.roles}", "has_role", r)) } : null;
    const notStaffGuard = (msg: string) => (isStaff ? [cond(env, { not: isStaff }, [mk(env, "reply", { content: msg, ephemeral: true }), mk(env, "stop")])] : []);
    const closeAllowed = isStaff
      ? (c.closeOnlyStaff ? isStaff : { or: [rule("{author.id}", "==", "{ticket_owner}"), ...allStaff.map((r) => rule("{author.roles}", "has_role", r))] })
      : rule("{author.id}", "==", "{ticket_owner}");
    const notTicket = cond(env, rule("{is_ticket}", "!=", "true"), [mk(env, "reply", { content: t("این کانال یک تیکت نیست.", "This channel isn't a ticket."), ephemeral: true }), mk(env, "stop")]);
    const noPermMsg = t("⛔ فقط تیم پشتیبانی می‌تواند این کار را انجام دهد.", "⛔ Only the support team can do that.");

    // ── closing ───────────────────────────────────────────────────────────────
    const closeActions = (): any[] => [
      mk(env, "ticket_info"),
      mk(env, "send_message", { channel: "{channel.id}", content: t(`🔒 تیکت توسط {author.mention} بسته شد؛ تا ${delay} ثانیه‌ی دیگر حذف می‌شود.`, `🔒 Ticket closed by {author.mention}. This channel will be deleted in ${delay}s.`) }),
      ...(c.transcript && (log || c.dmTranscript) ? [mk(env, "ticket_transcript", { send_to: log, dm_owner: !!c.dmTranscript, format: c.transcriptFormat === "txt" ? "txt" : "html", limit: 1000 })] : []),
      ...(log ? [mk(env, "send_embed", { channel: log, title: t("🔒 تیکت بسته شد", "🔒 Ticket closed"), color: "#ED4245", timestamp: true,
        description: t("**کانال:** #{channel.name}\n**صاحب:** {ticket_owner_mention}\n**بسته‌شده توسط:** {author.mention}", "**Channel:** #{channel.name}\n**Owner:** {ticket_owner_mention}\n**Closed by:** {author.mention}") })] : []),
      mk(env, "ticket_delete", { delay }),
    ];
    const closeButtonActions = (): any[] => [
      mk(env, "ticket_info"),
      cond(env, { or: [rule("{is_ticket}", "!=", "true"), { not: closeAllowed }] }, [mk(env, "reply", { content: c.closeOnlyStaff ? noPermMsg : t("⛔ فقط صاحب تیکت یا پشتیبان‌ها می‌توانند آن را ببندند.", "⛔ Only the opener or support staff can close this ticket."), ephemeral: true }), mk(env, "stop")]),
      ...(c.closeConfirm
        ? [mk(env, "reply", { content: t("مطمئنید که می‌خواهید این تیکت را ببندید؟", "Are you sure you want to close this ticket?"), buttons: [
            { id: newId(), label: t("بله، ببند", "Yes, close"), style: "danger", emoji: "🔒", url: "", actions: closeActions() },
            { id: newId(), label: t("انصراف", "Cancel"), style: "secondary", emoji: "", url: "", actions: [mk(env, "delete_message")] },
          ] })]
        : closeActions()),
    ];
    const claimActions = (): any[] => [
      ...notStaffGuard(noPermMsg),
      mk(env, "ticket_info"),
      cond(env, rule("{ticket_claimed_by}", "!=", ""), [mk(env, "reply", { content: t("این تیکت قبلاً توسط <@{ticket_claimed_by}> برداشته شده است.", "This ticket is already claimed by <@{ticket_claimed_by}>."), ephemeral: true }), mk(env, "stop")]),
      mk(env, "ticket_claim"),
      mk(env, "send_message", { channel: "{channel.id}", content: t("🙋 {author.mention} این تیکت را برداشت و پیگیری می‌کند.", "🙋 {author.mention} claimed this ticket.") }),
    ];

    // ── opening ───────────────────────────────────────────────────────────────
    const catVars = (x: TicketCategory): any[] => {
      const roles = [...new Set([...globalStaff, ...idList(x.staffRoles)])].join(",");
      return [
        mk(env, "set_variable", { name: "tk_label", value: x.label }),
        mk(env, "set_variable", { name: "tk_prefix", value: slug(x.prefix || "ticket") }),
        mk(env, "set_variable", { name: "tk_cat", value: String(x.discordCategory).replace(/\D/g, "") }),
        mk(env, "set_variable", { name: "tk_roles", value: roles }),
        mk(env, "set_variable", { name: "tk_welcome", value: x.welcome.trim() || c.welcomeText }),
      ];
    };
    const setVars = single ? catVars(cats[0]) : [...catVars(cats[0]), ...cats.slice(1).map((x) => cond(env, rule("{select.value}", "==", x.id), catVars(x)))];
    const staffPing = c.pingStaff && allStaff.length ? allStaff.map((r) => `<@&${r}>`).join(" ") : "";
    const welcomeButtons: any[] = [{ id: newId(), label: t("بستن تیکت", "Close ticket"), style: "danger", emoji: "🔒", url: "", actions: closeButtonActions() }];
    if (c.claim && isStaff) welcomeButtons.push({ id: newId(), label: t("برداشتن تیکت", "Claim"), style: "success", emoji: "🙋", url: "", actions: claimActions() });

    const openFlow = (): any[] => [
      ...setVars,
      mk(env, "ticket_find", { owner: "{author.id}" }),
      cond(env, rule("{ticket_count}", ">=", String(max)), [mk(env, "reply", { content: t("شما همین حالا یک تیکت باز دارید: <#{ticket_channel}>", "You already have an open ticket: <#{ticket_channel}>"), ephemeral: true }), mk(env, "stop")]),
      mk(env, "database_increment", { key: "tk_counter", amount: 1, store_as: "ticket_number" }),
      mk(env, "ticket_create", { name: "{tk_prefix}-{ticket_number}", category: "{tk_cat}", owner: "{author.id}", staff_roles: "{tk_roles}", topic: "{tk_label} · {author.display_name}", store_as: "ticket_channel" }),
      mk(env, "send_message", { channel: "{ticket_channel}", content: `{author.mention}${staffPing ? ` ${staffPing}` : ""}` }),
      mk(env, "send_embed", { channel: "{ticket_channel}", title: c.welcomeTitle || "🎫", description: `{tk_welcome}${withReason ? `\n\n**${t("دلیل", "Reason")}:**\n{modal.reason}` : ""}`, color: c.panelColor || "#5865F2", timestamp: true, buttons: welcomeButtons }),
      mk(env, "reply", { content: t("✅ تیکت شما ساخته شد: {ticket_mention}", "✅ Your ticket is ready: {ticket_mention}"), ephemeral: true }),
      ...(log ? [mk(env, "send_embed", { channel: log, title: t("🎫 تیکت جدید", "🎫 New ticket"), color: "#57F287", timestamp: true,
        description: t("**دسته:** {tk_label}\n**صاحب:** {author.mention}\n**کانال:** {ticket_mention}", "**Category:** {tk_label}\n**Opener:** {author.mention}\n**Channel:** {ticket_mention}") })] : []),
    ];

    // ── the panel ─────────────────────────────────────────────────────────────
    const panel: any = { channel: String(c.panelChannel).trim(), title: c.panelTitle, description: c.panelDescription, color: c.panelColor || "#5865F2", image: c.panelImage || "" };
    if (single) {
      const x = cats[0];
      const actions = withReason
        ? [mk(env, "show_modal", { id: newId(), title: x.label.slice(0, 45), inputs: [{ id: "reason", label: (c.reasonLabel || t("دلیل", "Reason")).slice(0, 45), style: "paragraph", placeholder: "", required: true, min_length: 0, max_length: 1000 }], actions: openFlow() })]
        : openFlow();
      panel.buttons = [{ id: newId(), label: x.label.slice(0, 80), style: "primary", emoji: x.emoji, url: "", actions }];
    } else {
      panel.selects = [{ id: newId(), placeholder: t("دسته‌ی تیکت را انتخاب کنید…", "Choose a ticket category…"), min_values: 1, max_values: 1,
        options: cats.map((x) => ({ label: x.label.slice(0, 100), value: x.id, description: x.description.slice(0, 100), emoji: x.emoji })), actions: openFlow() }];
    }
    const commands: any[] = [cmd("tickets", "ticket-setup", "Post the ticket panel", [mk(env, "send_embed", panel), mk(env, "reply", { content: t("✅ پنل تیکت ارسال شد", "✅ Ticket panel posted"), ephemeral: true })], { permissions: ["manage_guild"], ephemeral: true })];

    // ── staff commands (only inside ticket channels) ─────────────────────────
    const guarded = (name: string, desc: string, options: any[], body: any[], opts: Record<string, any> = {}) => commands.push(cmd("tickets", name, desc, [
      mk(env, "ticket_info"), notTicket, ...notStaffGuard(noPermMsg), ...body,
    ], { options, ephemeral: true, ...(isStaff ? {} : { permissions: ["manage_channels"] }), ...opts }));
    const k = c.commands ?? {};
    if (k.add) guarded("ticket-add", "Add a member to this ticket", [opt("user", "user", "Member")], [mk(env, "ticket_access", { user: "{options.user}", mode: "grant" }), mk(env, "reply", { content: "➕ {options.user_mention}", ephemeral: false })], { ephemeral: false });
    if (k.remove) guarded("ticket-remove", "Remove a member from this ticket", [opt("user", "user", "Member")], [mk(env, "ticket_access", { user: "{options.user}", mode: "revoke" }), mk(env, "reply", { content: "➖ {options.user_mention}", ephemeral: false })], { ephemeral: false });
    if (k.rename) guarded("ticket-rename", "Rename this ticket", [opt("name", "string", "New name")], [mk(env, "ticket_rename", { name: "{options.name}" }), mk(env, "reply", { content: "✏️ {options.name}" })]);
    if (k.transcript && (log || c.dmTranscript)) guarded("ticket-transcript", "Save a transcript of this ticket", [], [mk(env, "ticket_transcript", { send_to: log, dm_owner: false, format: c.transcriptFormat === "txt" ? "txt" : "html", limit: 1000 }), mk(env, "reply", { content: t("📄 رونوشت ارسال شد ({transcript_count} پیام)", "📄 Transcript sent ({transcript_count} messages)") })]);
    if (k.close) commands.push(cmd("tickets", "ticket-close", "Close this ticket", [
      mk(env, "ticket_info"),
      cond(env, { or: [rule("{is_ticket}", "!=", "true"), { not: closeAllowed }] }, [mk(env, "reply", { content: t("⛔ این کار برای شما یا در این کانال مجاز نیست.", "⛔ Not allowed here or for you."), ephemeral: true }), mk(env, "stop")]),
      mk(env, "reply", { content: t("🔒 در حال بستن تیکت…", "🔒 Closing the ticket…") }),
      ...closeActions().slice(1),  // ticket_info already ran above
    ], {}));
    return { events: [], commands };
  },
};
