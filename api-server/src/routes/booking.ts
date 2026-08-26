/**
 * routes/booking.ts — IRFORGE_PROMPT_V3 Phase 17
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin Express wiring over `lib/bookingStore.ts` (auth, plugin gate, param
 * parsing, error mapping) — same split as `routes/botSupportTickets.ts`
 * over its own domain: the actual logic lives in the lib module so it can
 * be unit-tested against the fake `botConfig.sheetLayer` without an HTTP
 * layer in the way.
 *
 * Replaces the old generic `booking-slots`/`booking-reservations` CRUD
 * (`pluginCollections.ts`) — those tabs' new shape (derived slots,
 * customer contact fields, cancel cutoff, tiered reminders) doesn't fit
 * that generic system's plain create/edit/delete form.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveBotSheet, sendBotConfigError, BotConfigError } from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import { sendCsv } from "../lib/csv.js";
import * as bookingStore from "../lib/bookingStore.js";

const router = Router();
const PLUGIN_ID = "booking";

// ── برنامه‌ی کاری ────────────────────────────────────────────────────────

router.get("/bots/:botId/booking/schedule", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ schedule: await bookingStore.getSchedule(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read booking schedule");
  }
});

router.put("/bots/:botId/booking/schedule", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const changes = bookingStore.parseScheduleInput(req.body ?? {});
    res.json({ schedule: await bookingStore.saveSchedule(spreadsheetId, changes) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save booking schedule");
  }
});

// ── استثناها ─────────────────────────────────────────────────────────────

router.get("/bots/:botId/booking/exceptions", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ exceptions: await bookingStore.listExceptions(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list booking exceptions");
  }
});

router.put("/bots/:botId/booking/exceptions/:date", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const exception = await bookingStore.setException(spreadsheetId, req.params.date, req.body ?? {});
    res.json({ exception: { date: req.params.date, ...exception } });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save booking exception");
  }
});

router.delete("/bots/:botId/booking/exceptions/:date", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json({ removed: await bookingStore.deleteException(spreadsheetId, req.params.date) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete booking exception");
  }
});

// ── موجودی مشتق‌شده (برای تقویمِ هفته‌ای) ─────────────────────────────────

router.get("/bots/:botId/booking/availability", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const start = String(req.query.start ?? "");
    const days = Math.min(31, Math.max(1, Number(req.query.days ?? 7) || 7));
    const slots = await bookingStore.availabilityForRange(spreadsheetId, start, days);
    res.json({ start, days, slots });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to compute booking availability");
  }
});

// ── رزروها ───────────────────────────────────────────────────────────────

router.get("/bots/:botId/booking/reservations", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    let reservations = await bookingStore.listReservations(spreadsheetId);

    const status = String(req.query.status ?? "all");
    if (status !== "all") reservations = reservations.filter((r) => r.status === status);

    const search = String(req.query.search ?? "").trim().toLowerCase();
    if (search) {
      reservations = reservations.filter((r) =>
        [r.customer_name, r.customer_phone, r.user_id, r.username]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(search)),
      );
    }
    reservations.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

    if (String(req.query.format ?? "") === "csv") {
      const rows: unknown[][] = [
        ["id", "status", "service_id", "customer_name", "customer_phone", "user_id", "username", "note", "no_show", "created_at"],
        ...reservations.map((r) => [
          r.id, r.status, r.service_id, r.customer_name ?? "", r.customer_phone ?? "",
          r.user_id, r.username ?? "", r.note ?? "", r.no_show ? "yes" : "", r.created_at ?? "",
        ]),
      ];
      sendCsv(res, `booking-reservations-${req.params.botId}.csv`, rows);
      return;
    }

    res.json({ reservations });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list booking reservations");
  }
});

router.patch("/bots/:botId/booking/reservations/:id", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const body = req.body ?? {};

    let reservation;
    if (body.no_show === true) {
      reservation = await bookingStore.markNoShow(spreadsheetId, req.params.id);
    } else if (typeof body.status === "string") {
      reservation = await bookingStore.setReservationStatus(spreadsheetId, req.params.id, body.status);
    } else {
      throw new BotConfigError(400, "چیزی برای تغییر مشخص نشده است.", "no_change");
    }
    res.json({ reservation });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update booking reservation");
  }
});

export default router;
