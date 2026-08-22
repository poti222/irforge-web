/**
 * test/secretScan.test.mjs — IRFORGE_PROMPT_V3 Phase 6.5
 *
 * There's no CI pipeline in this repo yet (no .github/workflows) to hang a
 * secret-scanning step off of, so this is the pragmatic equivalent: a test
 * that runs every time `pnpm test` does, scanning every file git actually
 * tracks (so it can't miss something committed outside api-server/) for a
 * handful of unmistakable, well-known credential formats. Deliberately
 * narrow and format-based rather than entropy-based — a generic
 * "long random-looking string" heuristic would flag this repo's own CSP
 * hashes (lib/csp.ts) and test fixtures as false positives.
 *
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const SECRET_PATTERNS = [
  { name: "GitHub personal access token", re: /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: "AWS access key ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // Requires an actual base64 body line after the header, not just the
  // header itself — .env.example deliberately documents the PEM *shape*
  // for GOOGLE_SERVICE_ACCOUNT_KEY with a "...\n" placeholder body, which
  // this must not flag, while a real accidentally-committed key (whose
  // body is exactly this) still gets caught, .env.example included.
  { name: "PEM private key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[^\n]*\n[A-Za-z0-9+/]{40,}/ },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

// Binary/lockfile/build-output noise — nothing here is a place a secret
// would be hand-committed, and lockfiles can contain package-name
// substrings that coincidentally look like a token prefix. `.env.example`
// is deliberately NOT excluded: pasting a real secret into it by mistake
// is a real, common way for one to leak.
const SKIP_RE = /\.(png|jpg|jpeg|ico|woff2?|ttf|eot|pdf)$|pnpm-lock\.yaml$|package-lock\.json$|\/dist\//;

test("no tracked file contains a well-known secret format", () => {
  const offenders = [];
  for (const rel of trackedFiles()) {
    if (SKIP_RE.test(rel)) continue;
    const full = path.join(REPO_ROOT, rel);
    let content;
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue; // not readable as text (binary, or a broken symlink) — skip
    }
    for (const { name, re } of SECRET_PATTERNS) {
      const m = content.match(re);
      if (m) offenders.push(`${rel}: looks like a ${name} (${m[0].slice(0, 12)}...)`);
    }
  }
  assert.deepEqual(offenders, []);
});
