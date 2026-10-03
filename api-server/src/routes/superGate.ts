/**
 * routes/superGate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `POST /api/super-gate/unlock` — عاملِ دومِ صفحه‌ی `/super`.
 *
 * `requireSuperAdmin` همین‌جا هم اعمال می‌شود: یعنی حتی رسیدن به این
 * اندپوینت یک نشستِ واقعیِ super_admin لازم دارد (کاربری که لاگینِ عادی
 * نکرده، یا super_admin نیست، همینجا ۴۰۱/۴۰۳ می‌گیرد — پیامِ روشن، نه فقط
 * شکستِ ساکت، طبقِ خواستِ کاربر). رمزِ گیت یک لایه‌ی *اضافه* رویِ همان
 * نشست است، نه جایگزینش.
 */
import { Router } from "express";
import crypto from "crypto";
import { requireSuperAdmin } from "./auth";
import { requireSuperGate, SUPER_GATE_COOKIE, issueSuperGateCookieValue } from "../middleware/superGate";
import { logger } from "../lib/logger";

const router = Router();

// هرگز به کلاینت فرستاده نمی‌شود — فقط سمتِ سرور خوانده می‌شود، هیچ‌جا لاگ نمی‌شود.
const SUPER_GATE_PASSWORD = process.env.SUPER_GATE_PASSWORD || "2007105";

function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/super-gate/unlock — رمزِ گیت را چک می‌کند، درست بود کوکیِ گیت را ست می‌کند.
router.post("/super-gate/unlock", requireSuperAdmin, async (req: any, res) => {
  try {
    const password = String(req.body?.password ?? "");
    if (!password || !secretEquals(password, SUPER_GATE_PASSWORD)) {
      // تأخیرِ عمدی، همان الگویِ routes/superAdmin.ts — جلوگیری از brute force.
      await new Promise((r) => setTimeout(r, 500));
      res.status(401).json({ error: "رمز نادرست است", code: "invalid_super_gate_password" });
      return;
    }
    const { value, maxAge } = issueSuperGateCookieValue();
    res.cookie(SUPER_GATE_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge,
      path: "/",
    });
    logger.warn({ userId: req.userId }, "/super gate unlocked");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "super-gate unlock error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/super-gate/status — آیا کوکیِ گیت الان معتبر است؟ (برای صفحه‌ی
// /super بفهمد باید فرمِ رمز را نشان بدهد یا مستقیم داشبورد را.)
router.get("/super-gate/status", requireSuperAdmin, requireSuperGate, async (_req, res) => {
  res.json({ unlocked: true });
});

export default router;
