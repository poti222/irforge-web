/**
 * lib/discordBlueprint.ts — اعتبارسنجی و پاک‌سازیِ بلوپرینتِ بات دیسکورد.
 * ─────────────────────────────────────────────────────────────────────────────
 * قوانین عیناً با `irforge-dis/irforge_discord/blueprint.py` یکی است (سرویس پایتون هنگام اجرا دوباره
 * اعتبارسنجی می‌کند). منبعِ حقیقتِ اکشن‌ها/رویدادها/سقف‌ها `discordCatalog.json` است — کپیِ
 * `irforge-dis/irforge_discord/catalog.json`؛ بعد از هر تغییرِ کاتالوگ در irforge-dis،
 * `node scripts/sync-discord-catalog.mjs <مسیر catalog.json>` را بزنید (تستِ `test_catalog_sync.py` در irforge-dis ناهمگونی را نشان می‌دهد).
 */
import crypto from "node:crypto";
import catalogJson from "./discordCatalog.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const catalog: any = catalogJson;
const LIMITS = catalog.limits as Record<string, number>;
const ACTIONS: Record<string, any> = Object.fromEntries((catalog.actions as any[]).map((a) => [a.type, a]));
const EVENTS: Record<string, any> = Object.fromEntries((catalog.events as any[]).map((e) => [e.id, e]));
const OPERATOR_IDS = new Set<string>((catalog.operators as any[]).map((o) => o.id));

const PY_KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "),
);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const TEMPLATE_RE = /\{[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}\p{N}_]+|\[\d+\])*\}/u;
const BUTTON_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const VAR_NAME_RE = /^[\p{L}\p{N}_]{1,32}$/u;
const INPUT_ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const SLOW_ACTIONS = new Set(["http_request", "wait", "loop", "purge", "ban_member", "kick_member", "timeout_member", "dm_user",
  "database_set", "database_get", "database_increment", "database_delete", "unban_user"]);

export interface DiscordBlueprint {
  prefix: string;
  status: { type: string; text: string };
  settings: { allow_role_mentions: boolean };
  variables: Record<string, string>;
  commands: any[];
  events: any[];
  modules?: Record<string, any>;
}

export function defaultBlueprint(): DiscordBlueprint {
  return { prefix: "!", status: { type: "playing", text: "IrForge" }, settings: { allow_role_mentions: false }, variables: {}, commands: [], events: [] };
}

class State {
  errors: string[] = [];
  totalActions = 0;
  buttonIds = new Set<string>();
  selectIds = new Set<string>();
  modalIds = new Set<string>();
  err(path: string, msg: string) {
    if (this.errors.length < 60) this.errors.push(`${path}: ${msg}`);
  }
}

const str = (v: unknown, limit: number): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).slice(0, limit);
};
const hasTemplate = (s: string) => TEMPLATE_RE.test(s);
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validCommandName(name: string): boolean {
  if (name.length < 1 || name.length > 32 || name !== name.toLowerCase()) return false;
  return /^[\p{L}\p{N}_-]+$/u.test(name);
}
export function validOptionName(name: string): boolean {
  return name.length >= 1 && name.length <= 32 && name === name.toLowerCase() && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)
    && !PY_KEYWORDS.has(name) && name !== "interaction" && !name.startsWith("_");
}

function cleanCondition(raw: any, path: string, st: State, depth = 0): Record<string, any> {
  if (raw === null || raw === undefined || raw === "" || (isObj(raw) && Object.keys(raw).length === 0)) return {};
  if (!isObj(raw)) { st.err(path, "شرط باید یک آبجکت باشد"); return {}; }
  if (depth > 6) { st.err(path, "شرط‌ها بیش از حد تودرتو هستند"); return {}; }
  for (const key of ["and", "or"]) {
    if (key in raw) {
      let items: any[] = Array.isArray(raw[key]) ? raw[key] : [];
      if (items.length > 20) { st.err(path, "حداکثر ۲۰ شرط در هر گروه"); items = items.slice(0, 20); }
      return { [key]: items.map((i, n) => cleanCondition(i, `${path}.${key}[${n}]`, st, depth + 1)).filter((c) => Object.keys(c).length > 0) };
    }
  }
  if ("not" in raw) return { not: cleanCondition(raw.not, `${path}.not`, st, depth + 1) };
  let op = str(raw.op ?? "==", 20);
  if (!OPERATOR_IDS.has(op)) { st.err(path, `عملگر ناشناخته: ${op}`); op = "=="; }
  return { left: str(raw.left, 500), op, right: str(raw.right, 500) };
}

function cleanButtons(raw: any, path: string, st: State, depth: number): any[] {
  if (raw === null || raw === undefined || raw === "") return [];
  if (!Array.isArray(raw)) { st.err(path, "دکمه‌ها باید لیست باشند"); return []; }
  if (raw.length > LIMITS.maxButtonsPerAction) st.err(path, `حداکثر ${LIMITS.maxButtonsPerAction} دکمه برای هر پیام`);
  const out: any[] = [];
  raw.slice(0, LIMITS.maxButtonsPerAction).forEach((b, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(b)) { st.err(p, "دکمه نامعتبر"); return; }
    const label = str(b.label, 80).trim();
    if (!label) st.err(p, "متن دکمه الزامی است");
    let style = str(b.style || "primary", 20);
    if (!(catalog.buttonStyles as string[]).includes(style)) { st.err(p, `استایل نامعتبر: ${style}`); style = "primary"; }
    const btn: any = { label, style, emoji: str(b.emoji, 100) };
    if (style === "link") {
      const url = str(b.url, 500).trim();
      if (!/^https?:\/\//.test(url) && !url.startsWith("{")) st.err(p, "لینک دکمه باید با http:// یا https:// شروع شود");
      btn.url = url;
    } else {
      const bid = str(b.id, 40).trim() || crypto.randomBytes(6).toString("hex");
      if (!BUTTON_ID_RE.test(bid)) st.err(p, "شناسه دکمه فقط حروف انگلیسی، عدد، _ و - (حداکثر ۴۰)");
      else if (st.buttonIds.has(bid)) st.err(p, `شناسه دکمه تکراری است: ${bid}`);
      st.buttonIds.add(bid);
      btn.id = bid;
      btn.actions = cleanActions(b.actions, `${p}.actions`, st, depth + 1);
    }
    out.push(btn);
  });
  return out;
}

const toInt = (v: unknown, d: number): number => {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && /^\s*-?\d+/.test(String(v)) ? n : d;
};

function cleanSelects(raw: any, path: string, st: State, depth: number): any[] {
  if (raw === null || raw === undefined || raw === "") return [];
  if (!Array.isArray(raw)) { st.err(path, "منوها باید لیست باشند"); return []; }
  if (raw.length > LIMITS.maxSelectsPerAction) st.err(path, `حداکثر ${LIMITS.maxSelectsPerAction} منوی انتخاب برای هر پیام`);
  const out: any[] = [];
  raw.slice(0, LIMITS.maxSelectsPerAction).forEach((sel, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(sel)) { st.err(p, "منوی انتخاب نامعتبر"); return; }
    const sid = str(sel.id, 40).trim() || crypto.randomBytes(6).toString("hex");
    if (!BUTTON_ID_RE.test(sid)) st.err(p, "شناسه منو فقط حروف انگلیسی، عدد، _ و - (حداکثر ۴۰)");
    else if (st.selectIds.has(sid)) st.err(p, `شناسه منو تکراری است: ${sid}`);
    st.selectIds.add(sid);
    const optsRaw: any[] = Array.isArray(sel.options) ? sel.options : [];
    const opts: any[] = [];
    const seen = new Set<string>();
    optsRaw.slice(0, LIMITS.maxSelectOptions).forEach((o, n) => {
      if (!isObj(o)) return;
      const label = str(o.label, 100).trim();
      const value = str(o.value, 100).trim() || label;
      if (!label) { st.err(`${p}.options[${n}]`, "متن گزینه الزامی است"); return; }
      if (seen.has(value)) { st.err(`${p}.options[${n}]`, `مقدار گزینه تکراری است: ${value}`); return; }
      seen.add(value);
      opts.push({ label, value, description: str(o.description, 100), emoji: str(o.emoji, 100) });
    });
    if (opts.length === 0) st.err(p, "منو حداقل یک گزینه لازم دارد");
    if (optsRaw.length > LIMITS.maxSelectOptions) st.err(p, `حداکثر ${LIMITS.maxSelectOptions} گزینه در هر منو`);
    let mn = Math.max(0, Math.min(toInt(sel.min_values, 1), 25));
    let mx = Math.max(1, Math.min(toInt(sel.max_values, 1), 25));
    mx = Math.min(mx, Math.max(1, opts.length));
    mn = Math.min(mn, mx);
    out.push({ id: sid, placeholder: str(sel.placeholder, 150), min_values: mn, max_values: mx, options: opts, actions: cleanActions(sel.actions, `${p}.actions`, st, depth + 1) });
  });
  return out;
}

function cleanModalInputs(raw: any, path: string, st: State, required: boolean): any[] {
  let items: any[] = Array.isArray(raw) ? raw : [];
  if (items.length > LIMITS.maxModalInputs) { st.err(path, `حداکثر ${LIMITS.maxModalInputs} فیلد در هر فرم`); items = items.slice(0, LIMITS.maxModalInputs); }
  const out: any[] = [];
  const seen = new Set<string>();
  items.forEach((f, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(f)) { st.err(p, "فیلد نامعتبر"); return; }
    const fid = str(f.id, 32).trim();
    if (!INPUT_ID_RE.test(fid)) { st.err(p, "شناسه فیلد باید با حرف انگلیسی/_ شروع شود و فقط حرف، عدد و _ داشته باشد (حداکثر ۳۲)"); return; }
    if (seen.has(fid)) { st.err(p, `شناسه فیلد تکراری است: ${fid}`); return; }
    seen.add(fid);
    const label = str(f.label, 45).trim();
    if (!label) st.err(p, "عنوان فیلد الزامی است");
    let style = str(f.style || "short", 12);
    if (style !== "short" && style !== "paragraph") { st.err(p, `نوع فیلد نامعتبر: ${style}`); style = "short"; }
    const clamp = (v: unknown, d: number, lo: number, hi: number) => { const n = toInt(v, NaN); return Number.isNaN(n) ? d : Math.max(lo, Math.min(n, hi)); };
    const mn = clamp(f.min_length, 0, 0, 4000);
    const mx = clamp(f.max_length, 400, 1, 4000);
    out.push({ id: fid, label, style, placeholder: str(f.placeholder, 100), required: f.required === undefined ? true : !!f.required, min_length: Math.min(mn, mx), max_length: mx });
  });
  if (required && out.length === 0) st.err(path, "فرم حداقل یک فیلد لازم دارد");
  return out;
}

function cleanField(spec: any, raw: any, path: string, st: State, depth: number): any {
  const t: string = spec.type;
  const p = `${path}.${spec.key}`;
  const required = !!spec.required;
  if (t === "actions") return cleanActions(raw, p, st, depth + 1);
  if (t === "condition") {
    const c = cleanCondition(raw, p, st);
    if (required && Object.keys(c).length === 0) st.err(p, "شرط الزامی است");
    return c;
  }
  if (t === "buttons") return cleanButtons(raw, p, st, depth);
  if (t === "selects") return cleanSelects(raw, p, st, depth);
  if (t === "modal_inputs") return cleanModalInputs(raw, p, st, required);
  if (t === "embed_fields") {
    const items: any[] = Array.isArray(raw) ? raw : [];
    return items.slice(0, LIMITS.maxEmbedFields).filter((f) => isObj(f) && (f.name || f.value))
      .map((f) => ({ name: str(f.name, 256), value: str(f.value, 1024), inline: f.inline === undefined ? true : !!f.inline }));
  }
  if (t === "string_list") {
    const items: any[] = Array.isArray(raw) ? raw : [];
    const out = items.slice(0, Number(spec.max ?? LIMITS.maxStringList)).map((i) => str(i, 500)).filter((s) => s.trim() !== "");
    if (required && out.length === 0) st.err(p, "حداقل یک گزینه لازم است");
    return out;
  }
  if (t === "boolean") {
    if (typeof raw === "string") return ["true", "1", "yes"].includes(raw.trim().toLowerCase());
    return raw === null || raw === undefined ? !!spec.default : !!raw;
  }
  if (t === "number") {
    const def = spec.default ?? null;
    if (raw === null || raw === undefined || raw === "") {
      if (required && def === null) st.err(p, "مقدار عددی الزامی است");
      return def;
    }
    if (typeof raw === "boolean") { st.err(p, "عدد نامعتبر"); return def; }
    let n: number;
    if (typeof raw === "number") n = raw;
    else {
      const s = String(raw).trim();
      if (hasTemplate(s)) return s.slice(0, 200);
      if (!NUMBER_RE.test(s)) { st.err(p, `عدد نامعتبر: ${s.slice(0, 30)}`); return def; }
      n = Number(s);
    }
    if (!Number.isFinite(n)) { st.err(p, "عدد نامعتبر"); return def; }
    if (spec.min !== undefined && n < spec.min) n = spec.min;
    if (spec.max !== undefined && n > spec.max) n = spec.max;
    return n;
  }
  let s = str(raw, Number(spec.max ?? LIMITS.maxStringLen));
  if (s.trim() === "" && spec.default !== undefined && spec.default !== null && spec.default !== "" && ["color", "select", "ident", "user"].includes(t)) s = String(spec.default);
  if (required && s.trim() === "") { st.err(p, "این فیلد الزامی است"); return s; }
  if (s === "") return "";
  if (t === "ident" && !new RegExp(spec.pattern ?? "^\\w+$").test(s)) {
    st.err(p, "نام متغیر باید با حرف انگلیسی/_ شروع شود و فقط شامل حرف، عدد و _ باشد (حداکثر ۳۲)");
  } else if (t === "select" && !(spec.options ?? []).includes(s)) {
    st.err(p, `گزینه نامعتبر: ${s}`);
    s = String(spec.default ?? "");
  } else if (t === "color" && !COLOR_RE.test(s) && !hasTemplate(s)) {
    st.err(p, "رنگ باید مثل #5865F2 باشد");
    s = String(spec.default ?? "#5865F2");
  } else if (t === "url" && s.trim() && !/^https?:\/\//.test(s) && !s.startsWith("{")) {
    st.err(p, "آدرس باید با http:// یا https:// شروع شود");
  }
  return s;
}

function cleanActions(raw: any, path: string, st: State, depth: number): any[] {
  if (raw === null || raw === undefined || raw === "") return [];
  if (!Array.isArray(raw)) { st.err(path, "اکشن‌ها باید لیست باشند"); return []; }
  if (depth > LIMITS.maxDepth) { st.err(path, `حداکثر عمق تودرتو ${LIMITS.maxDepth} است`); return []; }
  let list = raw;
  if (list.length > LIMITS.maxActionsPerList) { st.err(path, `حداکثر ${LIMITS.maxActionsPerList} اکشن در هر لیست`); list = list.slice(0, LIMITS.maxActionsPerList); }
  const out: any[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const p = `${path}[${i}]`;
    if (!isObj(a)) { st.err(p, "اکشن نامعتبر"); continue; }
    const typ = str(a.type, 40);
    const spec = ACTIONS[typ];
    if (!spec) { st.err(p, `نوع اکشن ناشناخته: ${typ}`); continue; }
    st.totalActions += 1;
    if (st.totalActions > LIMITS.maxActionsTotal) { st.err(path, `مجموع اکشن‌ها از ${LIMITS.maxActionsTotal} بیشتر است`); return out; }
    const clean: any = { type: typ };
    for (const f of spec.fields as any[]) {
      const v = cleanField(f, a[f.key], p, st, depth);
      if (v !== null && v !== undefined) clean[f.key] = v;
    }
    if (typ === "send_embed" && !["title", "description", "fields", "image"].some((k) => (Array.isArray(clean[k]) ? clean[k].length : clean[k]))) {
      st.err(p, "Embed باید حداقل عنوان، توضیحات، فیلد یا تصویر داشته باشد");
    }
    if (typ === "show_modal") {
      const mid = str(a.id, 40).trim() || crypto.randomBytes(6).toString("hex");
      if (!BUTTON_ID_RE.test(mid)) st.err(p, "شناسه فرم نامعتبر است");
      else if (st.modalIds.has(mid)) st.err(p, `شناسه فرم تکراری است: ${mid}`);
      st.modalIds.add(mid);
      clean.id = mid;
    }
    if (typ === "loop" && typeof clean.times !== "string") clean.times = Math.min(Number(clean.times || 1), LIMITS.maxLoopTimes);
    out.push(clean);
  }
  return out;
}

function cleanOptions(raw: any, path: string, st: State): any[] {
  let items: any[] = Array.isArray(raw) ? raw : [];
  if (items.length > LIMITS.maxOptionsPerCommand) { st.err(path, `حداکثر ${LIMITS.maxOptionsPerCommand} گزینه برای هر دستور`); items = items.slice(0, LIMITS.maxOptionsPerCommand); }
  const out: any[] = [];
  const seen = new Set<string>();
  items.forEach((o, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(o)) { st.err(p, "گزینه نامعتبر"); return; }
    const name = str(o.name, 32).trim().toLowerCase();
    if (!validOptionName(name)) { st.err(p, `نام گزینه «${name}» نامعتبر است (حروف کوچک/عدد/_ ، بدون فاصله، با حرف شروع شود)`); return; }
    if (seen.has(name)) { st.err(p, `نام گزینه تکراری: ${name}`); return; }
    seen.add(name);
    let typ = str(o.type || "string", 20);
    if (!(catalog.optionTypes as string[]).includes(typ)) { st.err(p, `نوع گزینه نامعتبر: ${typ}`); typ = "string"; }
    const opt: any = { name, type: typ, description: str(o.description, 100).trim() || "—", required: !!o.required };
    if (["string", "integer", "number"].includes(typ) && Array.isArray(o.choices) && o.choices.length) {
      const cl: any[] = [];
      for (const c of o.choices.slice(0, 25)) {
        if (!isObj(c) || c.name === undefined || c.name === null || c.name === "") continue;
        let val: any;
        if (typ === "integer") { val = Number.parseInt(String(c.value), 10); if (!Number.isFinite(val) || !/^-?\d+$/.test(String(c.value).trim())) val = NaN; }
        else if (typ === "number") val = Number(c.value);
        else val = str(c.value, 100);
        if (typeof val === "number" && !Number.isFinite(val)) { st.err(p, "مقدار گزینه‌ی انتخابی با نوع گزینه نمی‌خواند"); continue; }
        cl.push({ name: str(c.name, 100), value: val });
      }
      if (cl.length) opt.choices = cl;
    }
    out.push(opt);
  });
  return [...out.filter((o) => o.required), ...out.filter((o) => !o.required)];
}

const MODULE_RE = /^[a-z0-9_]{1,40}$/;
/** Optional marker saying which site «module» (welcome, reaction roles…) generated this command/event. */
function moduleTag(raw: any): { module?: string } {
  const m = str(raw.module, 40).trim();
  return m && MODULE_RE.test(m) ? { module: m } : {};
}

/** `modules` = the site's friendly per-feature forms (opaque JSON). The runner ignores it; the editor regenerates events from it. */
function cleanModules(raw: any, st: State): Record<string, any> {
  if (raw === undefined || raw === null || raw === "" || (isObj(raw) && Object.keys(raw).length === 0)) return {};
  if (!isObj(raw)) { st.err("modules", "modules باید آبجکت باشد"); return {}; }
  const out: Record<string, any> = {};
  Object.entries(raw).slice(0, 30).forEach(([k, v]) => {
    if (!MODULE_RE.test(k) || !isObj(v)) { st.err("modules", `ماژول «${k.slice(0, 20)}» نامعتبر است`); return; }
    let len = 0;
    try { len = JSON.stringify(v).length; } catch { return; }
    if (len > 30000) { st.err("modules", `تنظیمات ماژول «${k}» بیش از حد بزرگ است`); return; }
    out[k] = v;
  });
  return out;
}

function cleanCommands(raw: any, st: State): any[] {
  let items: any[] = Array.isArray(raw) ? raw : [];
  if (items.length > LIMITS.maxCommands) { st.err("commands", `حداکثر ${LIMITS.maxCommands} دستور`); items = items.slice(0, LIMITS.maxCommands); }
  const out: any[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  items.forEach((c, i) => {
    const p = `commands[${i}]`;
    if (!isObj(c)) { st.err(p, "دستور نامعتبر"); return; }
    const name = str(c.name, 32).trim().toLowerCase();
    if (!validCommandName(name)) { st.err(p, `نام دستور «${name}» نامعتبر است (۱ تا ۳۲ حرف/عدد/_/- ، حروف کوچک، بدون فاصله)`); return; }
    if (names.has(name)) { st.err(p, `نام دستور تکراری: ${name}`); return; }
    names.add(name);
    let cid = str(c.id, 64).trim() || crypto.randomUUID().replace(/-/g, "");
    if (ids.has(cid)) cid = crypto.randomUUID().replace(/-/g, "");
    ids.add(cid);
    let ctype = str(c.type || "slash", 10);
    if (!(catalog.commandTypes as string[]).includes(ctype)) { st.err(p, `نوع دستور نامعتبر: ${ctype}`); ctype = "slash"; }
    const perms: string[] = (Array.isArray(c.permissions) ? c.permissions : []).filter((x: unknown) => typeof x === "string");
    const bad = perms.filter((x) => !(catalog.commandPermissions as string[]).includes(x));
    if (bad.length) st.err(p, `دسترسی نامعتبر: ${bad.join(", ")}`);
    let cooldown = Number(c.cooldown || 0);
    if (!Number.isFinite(cooldown)) cooldown = 0;
    cooldown = Math.max(0, Math.min(cooldown, 3600));
    out.push({
      id: cid, name, description: str(c.description, 100).trim() || "—", type: ctype, enabled: c.enabled === undefined ? true : !!c.enabled,
      ephemeral: !!c.ephemeral, cooldown, permissions: perms.filter((x) => !bad.includes(x)),
      options: cleanOptions(c.options, `${p}.options`, st), actions: cleanActions(c.actions, `${p}.actions`, st, 1),
      ...moduleTag(c),
    });
  });
  return out;
}

function cleanEvents(raw: any, st: State): any[] {
  let items: any[] = Array.isArray(raw) ? raw : [];
  if (items.length > LIMITS.maxEvents) { st.err("events", `حداکثر ${LIMITS.maxEvents} رویداد`); items = items.slice(0, LIMITS.maxEvents); }
  const out: any[] = [];
  items.forEach((e, i) => {
    const p = `events[${i}]`;
    if (!isObj(e)) { st.err(p, "رویداد نامعتبر"); return; }
    const on = str(e.on, 30);
    if (!EVENTS[on]) { st.err(p, `نوع رویداد ناشناخته: ${on}`); return; }
    out.push({
      id: str(e.id, 64).trim() || crypto.randomUUID().replace(/-/g, ""), on, enabled: e.enabled === undefined ? true : !!e.enabled,
      filters: cleanCondition(e.filters, `${p}.filters`, st), actions: cleanActions(e.actions, `${p}.actions`, st, 1),
      ...moduleTag(e),
    });
  });
  return out;
}

export function validateBlueprint(raw: unknown): { blueprint: DiscordBlueprint; errors: string[] } {
  const st = new State();
  if (!isObj(raw)) return { blueprint: defaultBlueprint(), errors: ["بلوپرینت باید یک آبجکت JSON باشد"] };
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { return { blueprint: defaultBlueprint(), errors: ["بلوپرینت قابل ذخیره نیست"] }; }
  if (size > LIMITS.maxBlueprintBytes) return { blueprint: defaultBlueprint(), errors: [`حجم بلوپرینت از ${Math.floor(LIMITS.maxBlueprintBytes / 1000)} کیلوبایت بیشتر است`] };

  let prefix = str(raw.prefix || "!", 5).trim() || "!";
  if (/\s/.test(prefix)) { st.err("prefix", "پیشوند نباید فاصله داشته باشد"); prefix = "!"; }
  const statusRaw = isObj(raw.status) ? raw.status : {};
  let stype = str(statusRaw.type || "playing", 20);
  if (!(catalog.activityTypes as string[]).includes(stype)) { st.err("status.type", `نوع وضعیت نامعتبر: ${stype}`); stype = "playing"; }
  const settingsRaw = isObj(raw.settings) ? raw.settings : {};
  const varsRaw = isObj(raw.variables) ? raw.variables : {};
  const variables: Record<string, string> = {};
  Object.entries(varsRaw).slice(0, LIMITS.maxVariables).forEach(([k, v]) => {
    if (!VAR_NAME_RE.test(k)) { st.err("variables", `نام متغیر «${k.slice(0, 20)}» نامعتبر است`); return; }
    variables[k] = str(v, 500);
  });
  if (Object.keys(varsRaw).length > LIMITS.maxVariables) st.err("variables", `حداکثر ${LIMITS.maxVariables} متغیر`);

  const blueprint: DiscordBlueprint = {
    prefix, status: { type: stype, text: str(statusRaw.text, 128) }, settings: { allow_role_mentions: !!settingsRaw.allow_role_mentions },
    variables, commands: cleanCommands(raw.commands, st), events: cleanEvents(raw.events, st),
  };
  const modules = cleanModules(raw.modules, st);
  if (Object.keys(modules).length) blueprint.modules = modules;
  return { blueprint, errors: st.errors };
}

/** Intents the blueprint needs (privileged ones must be enabled in the Discord developer portal). */
export function requiredIntents(bp: DiscordBlueprint): string[] {
  const need = new Set<string>();
  if (bp.commands.some((c) => c.enabled && (c.type === "prefix" || c.type === "both"))) need.add("message_content");
  for (const e of bp.events) if (e.enabled) for (const i of EVENTS[e.on].needsIntents as string[]) need.add(i);
  return [...need];
}

export const _internal = { SLOW_ACTIONS };
