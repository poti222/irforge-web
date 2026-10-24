#!/usr/bin/env node
/**
 * run-discord-phases.mjs — اجرای خودکار و بدون‌نظارتِ فازهای «بات‌ساز دیسکورد» با Claude Code.
 *
 *   node run-discord-phases.mjs --from P01 --to P10 --web ../irforge-web --app ../irforge-app
 *
 * کار می‌کند:  هر فاز ← یک نشستِ تازه‌ی `claude -p` با پرامپتِ خودکفایِ همان فاز (از JSON) ←
 *   بررسیِ مستقلِ نتیجه (کامیت‌ها، build، تستِ فایل‌هایِ تغییرکرده) ← اگر خراب بود، تا N بار «رفعِ خطا» روی
 *   همان نشست ← اگر سالم بود، ادغام در برنچِ `discord/integration` و رفتن سراغِ فازِ بعد.
 *   اگر فازی به تصمیمِ انسان نیاز داشت (BLOCKED) یا ریسکی بود، می‌ایستد و دلیل را می‌گوید.
 *
 * امنیت:  هرگز روی `main` کار یا پوش نمی‌کند؛ فقط `discord/integration` و `discord/<فاز>`.
 *   دیتابیسِ production را رد می‌کند (مگر --yes-prod-db). allowlistِ ابزارها «سندباکس» نیست؛
 *   برای اجرای واقعاً بی‌خطر آن را روی یک کامپیوتر/کانتینرِ جدا، با Postgres محلیِ موقت و بدونِ secretِ production اجرا کن.
 *
 * نیازمندی: Node ≥ 18، git، Claude Code (`claude`) لاگین‌شده، pnpm، (برای irforge-app) python/pytest.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ───────────────────────────── args ─────────────────────────────
const HELP = `
Usage: node run-discord-phases.mjs [options]

  --from <Pxx>           first phase (default: first not-done phase)
  --to <Pxx>             last phase (default: same as --from)
  --web <dir>            irforge-web checkout        (default ../irforge-web)
  --app <dir>            irforge-app checkout        (default ../irforge-app)
  --plan <file>          phases JSON                 (default <web>/docs/discord/discord-bot-builder-phases.json)
  --model <name>         claude model alias/name     (default: your Claude Code default)
  --budget <usd>         max spend per attempt       (default 20)
  --retries <n>          fix-up attempts after a failed verification (default 2)
  --timeout <min>        per attempt                 (default 120)
  --allow-risky <ids>    comma list of risky phases allowed to run (e.g. P24,P26)
  --unsafe               bypassPermissions (NO allowlist) — only inside a disposable sandbox
  --push                 push discord/integration + phase branches to origin (never main)
  --yes-prod-db          allow DATABASE_URL/BUSINESS_DATABASE_URL that look like production
  --claude-bin <path>    claude executable           (default: claude)
  --dry-run              checks + plan only, run nothing
  --help
Exit codes: 0 done | 1 failed | 2 blocked / needs a human | 3 preflight problem
`;

function parseArgs(argv) {
  const o = { budget: 20, retries: 2, timeout: 120, claudeBin: "claude", web: "../irforge-web", app: "../irforge-app", risky: [] };
  const take = () => argv[++i];
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") o.from = take();
    else if (a === "--to") o.to = take();
    else if (a === "--web") o.web = take();
    else if (a === "--app") o.app = take();
    else if (a === "--plan") o.plan = take();
    else if (a === "--model") o.model = take();
    else if (a === "--budget") o.budget = Number(take());
    else if (a === "--retries") o.retries = Number(take());
    else if (a === "--timeout") o.timeout = Number(take());
    else if (a === "--allow-risky") o.risky = take().split(",").map((s) => s.trim());
    else if (a === "--unsafe") o.unsafe = true;
    else if (a === "--push") o.push = true;
    else if (a === "--yes-prod-db") o.prodDb = true;
    else if (a === "--claude-bin") o.claudeBin = take();
    else if (a === "--dry-run") o.dry = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
    else { console.error(`Unknown option: ${a}\n${HELP}`); process.exit(3); }
  }
  return o;
}

const opt = parseArgs(process.argv.slice(2));
const REPO = { "irforge-web": path.resolve(opt.web), "irforge-app": path.resolve(opt.app) };
const INTEGRATION = "discord/integration";
const STATE_DIR = path.join(REPO["irforge-web"], ".phase-runner");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_DIR = path.join(STATE_DIR, "logs");

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const die = (code, msg) => { console.error(`\n✖ ${msg}\n`); process.exit(code); };

// ───────────────────────────── git helpers ─────────────────────────────
function git(repo, ...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function gitOk(repo, ...args) {
  try { git(repo, ...args); return true; } catch { return false; }
}
const branchExists = (repo, b) => gitOk(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`);
const isDirty = (repo) => git(repo, "status", "--porcelain").length > 0;
const aheadCount = (repo, b) => Number(git(repo, "rev-list", "--count", `${INTEGRATION}..${b}`));

function excludeRunnerDir(repo) {
  try {
    const ex = path.join(git(repo, "rev-parse", "--git-dir"), "info", "exclude");
    const abs = path.isAbsolute(ex) ? ex : path.join(repo, ex);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const cur = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    if (!cur.includes(".phase-runner/")) fs.appendFileSync(abs, "\n.phase-runner/\n");
  } catch { /* best effort */ }
}

function ensureIntegration(repo) {
  gitOk(repo, "fetch", "origin");
  if (!branchExists(repo, INTEGRATION)) {
    const base = gitOk(repo, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main") ? "origin/main" : "main";
    git(repo, "checkout", "-B", INTEGRATION, base);
  } else {
    git(repo, "checkout", INTEGRATION);
  }
}

// ───────────────────────────── state ─────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { phases: {} }; }
}
function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function report(line) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(path.join(STATE_DIR, "REPORT.md"), line + "\n");
}

// ───────────────────────────── claude ─────────────────────────────
const ALLOWED = [
  "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch",
  "Bash(git *)", "Bash(pnpm *)", "Bash(npm *)", "Bash(npx *)", "Bash(node *)", "Bash(python *)", "Bash(python3 *)",
  "Bash(pip *)", "Bash(pytest *)", "Bash(ls *)", "Bash(cat *)", "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)",
  "Bash(grep *)", "Bash(find *)", "Bash(sed *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(psql *)",
];
const DENIED = [
  "Bash(git push *)", "Bash(git checkout main*)", "Bash(git switch *)", "Bash(git reset --hard *)", "Bash(git branch -D *)",
  "Bash(rm -rf *)", "Bash(sudo *)", "Bash(curl *)", "Bash(wget *)", "Bash(railway *)",
];

const SUFFIX = (phase, primary, others) => `

──────── RUNNER RULES (unattended run — no human can answer) ────────
- Your working directory is the ${primary} repo, already on its phase branch. ${others.length ? `Other repos you may need (already on their phase branches): ${others.join(", ")}.` : ""}
- Do not ask questions. Make the most reasonable assumption and record it in docs/discord/ASSUMPTIONS.md (append a short bullet under "${phase.id}").
- Commit your work with git in EVERY repo you changed, on the CURRENT branch. Never push, never switch branches, never touch main, never reset/force anything.
- Tests that need a database must use the local throwaway database given by DATABASE_URL / BUSINESS_DATABASE_URL in the environment — never anything else.
- If you hit a REAL blocker that needs a human decision (credentials, legal/payment decision, missing prerequisite phase), stop and say so.
- Your FINAL message must be a short summary (files changed, tests run + results, assumptions) and end with exactly ONE last line:
  PHASE_RESULT: SUCCESS
  or
  PHASE_RESULT: BLOCKED - <one-line reason>`;

function runClaude({ cwd, addDirs, prompt, resumeId, label }) {
  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "json"];
    if (opt.unsafe) args.push("--permission-mode", "bypassPermissions");
    else args.push("--permission-mode", "dontAsk", "--allowedTools", ALLOWED.join(","), "--disallowedTools", DENIED.join(","));
    if (opt.model) args.push("--model", opt.model);
    if (opt.budget) args.push("--max-budget-usd", String(opt.budget));
    if (addDirs.length) args.push("--add-dir", ...addDirs);
    if (resumeId) args.push("--resume", resumeId);

    const child = spawn(opt.claudeBin, args, { cwd, shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let out = "", err = "";
    const timer = setTimeout(() => {
      log(`⏱ timeout after ${opt.timeout} min — killing claude`);
      try { process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]) : child.kill("SIGKILL"); } catch { /* */ }
    }, opt.timeout * 60 * 1000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(path.join(LOG_DIR, `${label}.json`), out);
      if (err.trim()) fs.writeFileSync(path.join(LOG_DIR, `${label}.stderr.txt`), err);
      resolve({ code, out, err });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseResult(out) {
  try {
    const j = JSON.parse(out.trim().split("\n").filter(Boolean).pop());
    return { ok: true, j, text: String(j.result ?? ""), sessionId: j.session_id, cost: j.total_cost_usd ?? 0, isError: !!j.is_error };
  } catch {
    return { ok: false, j: null, text: out.slice(-2000), sessionId: null, cost: 0, isError: true };
  }
}

function phaseMarker(text) {
  const all = [...text.matchAll(/PHASE_RESULT:\s*(SUCCESS|BLOCKED)(?:\s*[-–:]\s*(.*))?/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return { status: m[1], reason: (m[2] ?? "").trim() };
}

// ───────────────────────────── verification ─────────────────────────────
function sh(cmd, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", env: { ...process.env, ...extraEnv }, timeout: 20 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function verifyRepo(name, branch) {
  const repo = REPO[name];
  const problems = [];
  if (isDirty(repo)) {
    // Claude forgot to commit something: keep it rather than lose it.
    git(repo, "add", "-A");
    gitOk(repo, "-c", "user.name=phase-runner", "-c", "user.email=phase-runner@localhost", "commit", "-m", `${branch}: uncommitted leftovers`);
  }
  const ahead = aheadCount(repo, branch);
  const changed = git(repo, "diff", "--name-only", `${INTEGRATION}...${branch}`).split("\n").filter(Boolean);
  // یک ریپو ممکن است در این فاز واقعاً تغییری نخواهد؛ «هیچ ریپویی تغییر نکرد» در حلقه‌ی اصلی خطا حساب می‌شود.
  if (ahead === 0 || changed.length === 0) return { problems, changed: [] };

  if (name === "irforge-web") {
    const api = sh("node build.mjs", path.join(repo, "api-server"));
    if (!api.ok) problems.push(`[web] api-server build failed:\n${api.out.slice(-2500)}`);
    if (changed.some((f) => f.startsWith("irforge/"))) {
      const ui = sh("pnpm --filter @workspace/irforge run build", repo);
      if (!ui.ok) problems.push(`[web] irforge build failed:\n${ui.out.slice(-2500)}`);
    }
    const tests = changed.filter((f) => /\/test\/.+\.test\.mjs$/.test(f));
    for (const t of tests) {
      const dir = t.startsWith("irforge/") ? "irforge" : "api-server";
      const r = sh(`node --import tsx/esm --test ${t.slice(dir.length + 1)}`, path.join(repo, dir), { DATABASE_URL: process.env.DATABASE_URL ?? "postgres://t:t@127.0.0.1:5432/t" });
      if (!r.ok) problems.push(`[web] test failed: ${t}\n${r.out.slice(-2000)}`);
    }
  } else {
    const py = changed.filter((f) => f.endsWith(".py"));
    if (py.length) {
      const c = sh(`python -m py_compile ${py.map((f) => `"${f}"`).join(" ")}`, repo);
      if (!c.ok) problems.push(`[app] python syntax error:\n${c.out.slice(-2000)}`);
    }
    const tests = changed.filter((f) => /(^|\/)tests?\/.*test_.*\.py$/.test(f) || /(^|\/)test_.*\.py$/.test(f));
    if (tests.length) {
      const r = sh(`python -m pytest -q -p no:cacheprovider ${tests.map((f) => `"${f}"`).join(" ")}`, repo);
      if (!r.ok) problems.push(`[app] pytest failed:\n${r.out.slice(-2500)}`);
    }
  }
  return { problems, changed };
}

// ───────────────────────────── main ─────────────────────────────
function preflight() {
  if (!opt.dry) {
    const v = spawnSync(opt.claudeBin, ["--version"], { shell: process.platform === "win32", encoding: "utf8" });
    if (v.status !== 0) die(3, `Claude Code not found (${opt.claudeBin}). Install it and run 'claude' once to log in.`);
    log(`claude: ${String(v.stdout).trim()}`);
  }
  for (const k of ["DATABASE_URL", "BUSINESS_DATABASE_URL"]) {
    const val = process.env[k];
    if (val && /rlwy\.net|railway\.(app|internal)|proxy\.rlwy/i.test(val) && !opt.prodDb) {
      die(3, `${k} looks like a PRODUCTION (Railway) database. Point it at a local throwaway Postgres, or pass --yes-prod-db if you are sure.`);
    }
    if (!val) log(`note: ${k} is not set — phases whose tests need a database will use a dummy URL / skip.`);
  }
  if (opt.unsafe) log("⚠ --unsafe: permission checks are OFF. Use only in a disposable sandbox.");
}

async function main() {
  preflight();
  for (const [n, p] of Object.entries(REPO)) if (!fs.existsSync(path.join(p, ".git"))) log(`note: ${n} not found at ${p} (only needed if a selected phase uses it)`);
  if (!fs.existsSync(path.join(REPO["irforge-web"], ".git"))) die(3, `irforge-web not found at ${REPO["irforge-web"]} (use --web)`);

  excludeRunnerDir(REPO["irforge-web"]);
  if (isDirty(REPO["irforge-web"])) die(3, "irforge-web has uncommitted changes — commit or stash them first.");
  ensureIntegration(REPO["irforge-web"]);

  const planPath = opt.plan ?? path.join(REPO["irforge-web"], "docs/discord/discord-bot-builder-phases.json");
  if (!fs.existsSync(planPath)) die(3, `Plan not found: ${planPath}`);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const ids = plan.phases.map((p) => p.id);
  const state = loadState();

  const first = opt.from ?? ids.find((id) => state.phases[id]?.status !== "done");
  if (!first) { log("Everything in the plan is already done 🎉"); return 0; }
  const last = opt.to ?? first;
  if (!ids.includes(first) || !ids.includes(last)) die(3, `Unknown phase (known: ${ids[0]}…${ids.at(-1)})`);
  const range = plan.phases.slice(ids.indexOf(first), ids.indexOf(last) + 1);

  log(`Plan: ${range.map((p) => p.id).join(" → ")}  (integration branch: ${INTEGRATION})`);
  for (const ph of range) {
    const miss = ph.depends_on.filter((d) => state.phases[d]?.status !== "done" && !range.some((r) => r.id === d && ids.indexOf(r.id) < ids.indexOf(ph.id)));
    if (miss.length) die(3, `${ph.id} depends on ${miss.join(", ")} which is not done yet. Run those first (--from ${miss[0]}).`);
    if (ph.risk && !opt.risky.includes(ph.id)) die(2, `${ph.id} is flagged risky (${ph.risk}). Decide first, then re-run with --allow-risky ${ph.id}.`);
    for (const r of ph.repos) {
      if (!fs.existsSync(path.join(REPO[r], ".git"))) die(3, `${ph.id} needs ${r} but it is not at ${REPO[r]} (use --${r === "irforge-app" ? "app" : "web"}).`);
    }
  }
  if (opt.dry) { for (const ph of range) log(`${ph.id} [${ph.size}] ${ph.title} — repos: ${ph.repos.join(", ")} — prompt ${ph.prompt.length} chars`); log("dry-run: nothing executed."); return 0; }

  for (const ph of range) {
    const st = (state.phases[ph.id] ??= { status: "pending", attempts: 0, cost: 0 });
    if (st.status === "done") { log(`${ph.id} already done — skipping`); continue; }
    const branch = `discord/${ph.id}`;
    const startedAt = Date.now();
    log(`\n━━━━━━━━ ${ph.id} · ${ph.title} ━━━━━━━━`);

    for (const r of ph.repos) {
      excludeRunnerDir(REPO[r]);
      if (isDirty(REPO[r])) die(3, `${r} has uncommitted changes.`);
      ensureIntegration(REPO[r]);
      if (branchExists(REPO[r], branch) && st.attempts > 0) git(REPO[r], "checkout", branch);
      else git(REPO[r], "checkout", "-B", branch, INTEGRATION);
    }

    const primary = ph.repos[0];
    const others = ph.repos.slice(1);
    const addDirs = others.map((r) => REPO[r]);
    let prompt = ph.prompt + SUFFIX(ph, primary, others);
    let sessionId = st.sessionId ?? null;
    let outcome = null;

    for (let attempt = 0; attempt <= opt.retries; attempt++) {
      st.attempts++; st.status = "running"; saveState(state);
      log(`${ph.id} attempt ${attempt + 1}/${opt.retries + 1}${sessionId ? " (resuming session)" : ""}…`);
      const res = await runClaude({ cwd: REPO[primary], addDirs, prompt, resumeId: attempt > 0 ? sessionId : null, label: `${ph.id}.attempt${st.attempts}` });
      const p = parseResult(res.out);
      st.cost += p.cost; st.sessionId = sessionId = p.sessionId ?? sessionId;
      if (/not logged in/i.test(p.text)) die(3, "Claude Code is not logged in. Run `claude` once and /login.");
      if (!p.ok || p.isError) {
        log(`claude error: ${p.text.slice(0, 300)}`);
        if (attempt < opt.retries) { prompt = `The previous run ended with an error. Continue the phase from where you stopped, finish it, commit, and end with the PHASE_RESULT line.`; continue; }
        outcome = { kind: "failed", why: `claude error: ${p.text.slice(0, 300)}` }; break;
      }
      const marker = phaseMarker(p.text);
      st.summary = p.text.replace(/PHASE_RESULT:.*$/s, "").trim().slice(-1500);
      if (marker?.status === "BLOCKED") { outcome = { kind: "blocked", why: marker.reason || "blocked" }; break; }
      if (!marker) {
        if (attempt < opt.retries) { prompt = "You did not finish with the required last line. Finish any remaining work, commit, and end your final message with exactly one line `PHASE_RESULT: SUCCESS` or `PHASE_RESULT: BLOCKED - <reason>`."; continue; }
        outcome = { kind: "failed", why: "no PHASE_RESULT marker" }; break;
      }
      // SUCCESS claimed → verify independently
      const problems = [];
      let touched = 0;
      for (const r of ph.repos) { const v = verifyRepo(r, branch); problems.push(...v.problems); touched += v.changed.length; }
      if (touched === 0) problems.push(`No repo has any change on ${branch} compared with ${INTEGRATION}. The phase must produce committed changes.`);
      if (problems.length === 0) { outcome = { kind: "done" }; break; }
      log(`verification failed (${problems.length}) — ${problems[0].split("\n")[0]}`);
      if (attempt < opt.retries) { prompt = `The runner's independent verification failed. Fix every problem below, commit, and end with the PHASE_RESULT line.\n\n${problems.join("\n\n").slice(0, 7000)}`; continue; }
      outcome = { kind: "failed", why: problems.join("\n").slice(0, 600) };
    }

    const mins = Math.round((Date.now() - startedAt) / 60000);
    if (outcome.kind === "done") {
      for (const r of ph.repos) {
        git(REPO[r], "checkout", INTEGRATION);
        try { git(REPO[r], "merge", "--ff-only", branch); }
        catch { git(REPO[r], "-c", "user.name=phase-runner", "-c", "user.email=phase-runner@localhost", "merge", "--no-ff", "-m", `merge ${branch}`, branch); }
        if (opt.push) { gitOk(REPO[r], "push", "-u", "origin", INTEGRATION); gitOk(REPO[r], "push", "-u", "origin", branch); }
      }
      st.status = "done"; saveState(state);
      log(`✔ ${ph.id} done in ${mins} min · $${st.cost.toFixed(2)}`);
      report(`- ✔ **${ph.id}** ${ph.title} — ${mins} min, $${st.cost.toFixed(2)}, attempts ${st.attempts}`);
      continue;
    }
    st.status = outcome.kind; st.reason = outcome.why; saveState(state);
    report(`- ${outcome.kind === "blocked" ? "⛔" : "✖"} **${ph.id}** ${ph.title} — ${outcome.kind}: ${outcome.why}`);
    log(`${outcome.kind === "blocked" ? "⛔ BLOCKED" : "✖ FAILED"} ${ph.id}: ${outcome.why}`);
    log(`Work is kept on branch ${branch}. Logs: ${LOG_DIR}. Fix/decide, then re-run with --from ${ph.id}.`);
    return outcome.kind === "blocked" ? 2 : 1;
  }

  log(`\n✔ All selected phases done. Review: git log ${INTEGRATION}  (report: ${path.join(STATE_DIR, "REPORT.md")})`);
  log(`Next: run the new migrations on a COPY of your database, test, then open a PR ${INTEGRATION} → main yourself.`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
