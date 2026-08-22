/**
 * lib/corsConfig.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 6 — `cors({ origin: process.env.CORS_ORIGIN || true })`
 * used to fall back to `true` (reflect whatever Origin the request sent) any
 * time CORS_ORIGIN was unset — including in production, if the env var was
 * ever missing on deploy. Combined with `credentials: true`, that lets *any*
 * website make cookie/Authorization-bearing requests against the API on a
 * visitor's behalf. Same shape as lib/otp.ts's boot check: a pure function
 * (env passed in, so it's testable without process mutation) returning a
 * description of the problem or null, checked once at module load.
 */

/**
 * Returns a description of the problem if CORS_ORIGIN is unset in production,
 * else null.
 */
export function corsConfigIssue(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === "production" && !env.CORS_ORIGIN?.trim()) {
    return (
      "CORS_ORIGIN is unset in production. Without it, CORS falls back to " +
      "reflecting any request Origin, which — combined with credentials: " +
      "true — lets any website make authenticated requests against this " +
      "API on a visitor's behalf. Set it to the site's real origin(s) " +
      "before boot — see .env.example."
    );
  }
  return null;
}

/**
 * CORS_ORIGIN may be a single origin or a comma-separated list (multiple
 * frontends / a staging + prod domain sharing one API). `cors`'s `origin`
 * option accepts an array for exactly this case. Outside production with
 * nothing set, `true` reflects the request Origin — convenient for local
 * dev, where the port Vite picks isn't worth hardcoding.
 */
export function resolveCorsOrigin(env: NodeJS.ProcessEnv = process.env): string | string[] | boolean {
  const raw = env.CORS_ORIGIN?.trim();
  if (!raw) return true;
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

const _corsIssue = corsConfigIssue();
if (_corsIssue) {
  throw new Error(_corsIssue);
}
