import { logger } from "../lib/logger";
import { Router } from "express";
import {
  readSheet,
  writeSheet,
  appendSheet,
  clearSheet,
  readSheetAsObjects,
  writeSheetFromObjects,
  getSheetId,
} from "../lib/sheets.js";
import { requireAuth, requireAdmin } from "./auth.js";

const router = Router();

// ─── GET /api/sheets/:name ──────────────────────────────────────────────────
// Read all rows from a named sheet (name maps to SHEETS_<NAME>_ID env var)
// Query params:
//   ?range=Sheet1!A1:Z   (optional, default "Sheet1")
//   ?format=objects       (optional, returns [{col: val, ...}] instead of [][])
router.get("/sheets/:name", requireAuth, async (req: any, res) => {
  try {
    const sheetId = getSheetId(req.params.name);
    const range = (req.query.range as string) || "Sheet1";
    const format = req.query.format as string;

    if (format === "objects") {
      const data = await readSheetAsObjects(sheetId, range);
      res.json({ sheetId, range, rows: data, count: data.length });
    } else {
      const data = await readSheet(sheetId, range);
      res.json({ sheetId, range, rows: data, count: data.length });
    }
  } catch (err: any) {
    if (err.message?.includes("not set")) {
      res.status(404).json({ error: err.message });
    } else {
      logger.error({ err }, "sheets GET error");
      res.status(500).json({ error: "Failed to read sheet" });
    }
  }
});

// ─── PUT /api/sheets/:name ──────────────────────────────────────────────────
// Overwrite sheet with new data
// Body: { range: "Sheet1", values: [[...], [...]] }
// OR:   { range: "Sheet1", objects: [{col: val}, ...] }
router.put("/sheets/:name", requireAuth, async (req: any, res) => {
  try {
    const sheetId = getSheetId(req.params.name);
    const { range = "Sheet1", values, objects } = req.body;

    if (objects) {
      await writeSheetFromObjects(sheetId, range, objects);
    } else if (values) {
      await writeSheet(sheetId, range, values);
    } else {
      res.status(400).json({ error: "Provide either values or objects in body" });
      return;
    }

    res.json({ success: true, sheetId, range });
  } catch (err: any) {
    if (err.message?.includes("not set")) {
      res.status(404).json({ error: err.message });
    } else {
      logger.error({ err }, "sheets PUT error");
      res.status(500).json({ error: "Failed to write sheet" });
    }
  }
});

// ─── POST /api/sheets/:name/append ─────────────────────────────────────────
// Append rows to a sheet
// Body: { range: "Sheet1", values: [[...]] }
// OR:   { range: "Sheet1", objects: [{...}] }  (headers must already exist)
router.post("/sheets/:name/append", requireAuth, async (req: any, res) => {
  try {
    const sheetId = getSheetId(req.params.name);
    const { range = "Sheet1", values, objects } = req.body;

    if (objects) {
      if (!Array.isArray(objects) || objects.length === 0) {
        res.status(400).json({ error: "objects must be a non-empty array" });
        return;
      }
      const headers = Object.keys(objects[0]);
      const rows = objects.map((o: Record<string, unknown>) =>
        headers.map((h) => String(o[h] ?? ""))
      );
      await appendSheet(sheetId, range, rows);
    } else if (values) {
      await appendSheet(sheetId, range, values);
    } else {
      res.status(400).json({ error: "Provide either values or objects in body" });
      return;
    }

    res.json({ success: true, sheetId, range });
  } catch (err: any) {
    if (err.message?.includes("not set")) {
      res.status(404).json({ error: err.message });
    } else {
      logger.error({ err }, "sheets POST error");
      res.status(500).json({ error: "Failed to append to sheet" });
    }
  }
});

// ─── DELETE /api/sheets/:name ───────────────────────────────────────────────
// Clear a range in a sheet (does NOT delete the sheet itself)
// Body: { range: "Sheet1!A2:Z" }
router.delete("/sheets/:name", requireAuth, async (req: any, res) => {
  try {
    const sheetId = getSheetId(req.params.name);
    const { range = "Sheet1" } = req.body;
    await clearSheet(sheetId, range);
    res.json({ success: true, sheetId, range });
  } catch (err: any) {
    if (err.message?.includes("not set")) {
      res.status(404).json({ error: err.message });
    } else {
      logger.error({ err }, "sheets DELETE error");
      res.status(500).json({ error: "Failed to clear sheet" });
    }
  }
});

// ─── GET /api/sheets ────────────────────────────────────────────────────────
// List all configured sheets (from env vars)
router.get("/sheets", requireAuth, (req, res) => {
  const sheets: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith("SHEETS_") && key.endsWith("_ID") && val) {
      const name = key.replace("SHEETS_", "").replace("_ID", "").toLowerCase();
      sheets[name] = val;
    }
  }
  res.json({ sheets });
});

export default router;
