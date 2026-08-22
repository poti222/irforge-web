/**
 * middleware/sanitizeBody.ts — IRFORGE_PROMPT_V3 Phase 4.5
 *
 * `express.json()` happily parses `{"__proto__": {"isAdmin": true}}` and
 * assigns straight onto `Object.prototype` the moment anything does
 * `Object.assign(target, req.body)` or a plain `{ ...existing, ...req.body }`
 * spread — polluting every object in the process, not just the one request.
 * There are no `__proto__`/`constructor`/`prototype` guards anywhere in this
 * codebase today.
 *
 * `routes/botSettings.ts` is already safe because it merges through an
 * explicit `PATCHABLE_FIELDS` allow-list rather than spreading the body —
 * that remains the better fix wherever it's practical. This middleware is
 * the blanket backstop for every route, allow-list or not: it strips the
 * three dangerous keys from the parsed body (at every nesting level) before
 * any handler sees it, so a route that *does* do an unbounded merge
 * (`botObjects.ts`, `botWorkflows.ts`, `botRelations.ts`,
 * `botPluginData.ts` — all of which accept an operator-defined, open-ended
 * JSON shape by design) can't be turned into a prototype-pollution vector by
 * a crafted request body.
 */
import type { Request, Response, NextFunction } from "express";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function stripDangerousKeys(value: unknown, seen = new Set<unknown>()): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripDangerousKeys(v, seen));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) return value; // circular reference guard
  seen.add(value);

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = stripDangerousKeys((value as Record<string, unknown>)[key], seen);
  }
  return out;
}

/** Mounted globally, after express.json(). Rebuilds req.body with
 * __proto__/constructor/prototype keys removed at every level. A body that
 * isn't a plain object/array (or is absent) passes through untouched. */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object") {
    req.body = stripDangerousKeys(req.body);
  }
  next();
}
