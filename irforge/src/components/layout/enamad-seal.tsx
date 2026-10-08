import { useState } from "react";

/**
 * نماد اعتماد الکترونیکی (اینماد). تصویر مستقیم از سرورهای اینماد با شناسه و
 * کدِ ثبت‌شده‌ی سایت لود می‌شود — این مقادیر را تغییر ندهید وگرنه نماد
 * اعتبارسنجی نمی‌شود.
 */
export function EnamadSeal({ className = "" }: { className?: string }) {
  // اگر سرورِ اینماد در دسترس نبود (یا مسدود شد) تصویرِ شکسته با alt نمایش داده نشود.
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className={`flex justify-center ${className}`} data-testid="enamad-seal">
      <a
        referrerPolicy="origin"
        target="_blank"
        rel="noopener noreferrer"
        href="https://trustseal.enamad.ir/?id=7510632&Code=BwMRxuRefk1bEHHCVLxUEkfRcXhTcf4j"
      >
        <img
          referrerPolicy="origin"
          src="https://trustseal.enamad.ir/logo.aspx?id=7510632&Code=BwMRxuRefk1bEHHCVLxUEkfRcXhTcf4j"
          alt="نماد اعتماد الکترونیکی"
          style={{ cursor: "pointer" }}
          onError={() => setFailed(true)}
          {...{ code: "BwMRxuRefk1bEHHCVLxUEkfRcXhTcf4j" }}
        />
      </a>
    </div>
  );
}
