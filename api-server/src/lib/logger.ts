import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  // ONLC live incident (2026-09-15): every logger.error() call already
  // carried full detail (err/spreadsheetId/correlationId/...) but showed
  // up as Railway severity "info" -- an error-level log search silently
  // missed it, twice now (see PROGRESS.md). Root cause, confirmed by
  // running pino locally: pino's DEFAULT `level` field is a raw NUMBER
  // (30 for info, 50 for error, ...), and Railway's log ingestion only
  // reliably classifies severity from a STRING label -- it fell back to
  // "info" for every numeric level it couldn't confidently read, for
  // every log line regardless of call site. formatters.level below is
  // pino's own documented mechanism for exactly this: it makes the
  // `level` field a string ("info"/"warn"/"error"/...) instead of a
  // number, without changing anything else about the log shape.
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
