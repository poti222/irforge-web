/**
 * routes/agentUpdate.ts — `GET /api/agent/latest`
 *
 * مانیفستِ آخرین نسخه‌ی اپِ «IrForge Pay Agent» (mobile/). اپ خودش دوره‌ای این آدرس را (از روی origin وبهوکِ
 * کانال) می‌خواند و اگر versionCode بزرگ‌تر از نسخه‌ی نصب‌شده بود، در خودِ اپ + نوتیفیکیشن خبر می‌دهد و
 * APK را دانلود/نصب می‌کند. عمومی است (بدونِ احرازِ هویت) و هیچ رازی ندارد.
 *
 * انتشارِ نسخه‌ی جدید = فقط تنظیمِ این env‌ها روی سرور (بدونِ deploy مجدد کد):
 *   AGENT_VERSION_CODE   عددِ صحیحِ افزایشی (همان build number؛ CI از github.run_number می‌گذارد)
 *   AGENT_VERSION_NAME   مثلاً 1.0.7
 *   AGENT_APK_URL        لینکِ مستقیمِ https به فایلِ APK
 *   AGENT_APK_SHA256     هشِ SHA-256 فایل (اپ قبل از نصب چک می‌کند؛ اجباری برای امنیت)
 *   AGENT_NOTES          (اختیاری) توضیحِ تغییرات
 *   AGENT_MANDATORY      (اختیاری) "1" = اپ تا آپدیت نشود کار نمی‌کند (فقط نمایش داده می‌شود)
 * اگر هر کدام از چهار مقدارِ اول نباشد، پاسخ `{ available: false }` است.
 */
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/agent/latest", (_req, res) => {
  const code = Number.parseInt(process.env.AGENT_VERSION_CODE ?? "", 10);
  const name = (process.env.AGENT_VERSION_NAME ?? "").trim();
  const apkUrl = (process.env.AGENT_APK_URL ?? "").trim();
  const sha256 = (process.env.AGENT_APK_SHA256 ?? "").trim().toLowerCase();
  res.setHeader("Cache-Control", "public, max-age=300");
  if (!Number.isInteger(code) || code <= 0 || !name || !/^https:\/\//.test(apkUrl) || !/^[0-9a-f]{64}$/.test(sha256)) {
    res.json({ available: false });
    return;
  }
  res.json({
    available: true,
    versionCode: code,
    versionName: name,
    apkUrl,
    sha256,
    notes: (process.env.AGENT_NOTES ?? "").slice(0, 1000),
    mandatory: process.env.AGENT_MANDATORY === "1",
  });
});

export default router;
