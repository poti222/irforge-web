import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// Works in both the esbuild CJS bundle (where __dirname is defined natively)
// and `tsx` ESM dev mode (where it isn't). `typeof` is safe on an undeclared
// identifier, so this never throws in ESM.
const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

app.use(pinoHttp({ logger }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
// FIX: default express.json() body limit is 100kb, which silently 413s any
// base64 data-URL upload (bot profile photos, wallet deposit receipts) once
// the encoded payload — image bytes * ~1.33 for base64, plus JSON overhead —
// crosses that. Raised to accommodate the largest such upload (bot profile
// photo, capped at 5MB raw server-side in bots.ts) with headroom.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// dist/index.cjs lives at api-server/dist/, frontend is at irforge/dist
const frontendDist = path.join(currentDir, "../../irforge/dist");
app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
