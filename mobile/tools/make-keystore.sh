#!/usr/bin/env bash
# یک‌بار اجرا کنید (نیازمندِ Java/keytool). کلیدِ امضای اپ را می‌سازد.
# ⚠️ این فایل را گم نکنید: بدونِ همین کلید هیچ آپدیتی روی نصب‌های قبلی قبول نمی‌شود. در git هم نگذارید.
set -euo pipefail
OUT="${1:-irforge-pay-release.jks}"
read -rsp "یک رمزِ قوی برای keystore بنویسید: " PASS; echo
keytool -genkeypair -v -keystore "$OUT" -alias upload -keyalg RSA -keysize 2048 -validity 36500 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=IrForge Pay Agent, O=IrForge, C=IR"
echo
echo "حالا در گیت‌هاب: Settings ← Secrets and variables ← Actions ← New repository secret — سه تا بسازید:"
echo "  ANDROID_KEYSTORE_BASE64  = (خروجیِ خطِ زیر)"
base64 -w0 "$OUT" 2>/dev/null || base64 "$OUT" | tr -d '\n'
echo
echo "  ANDROID_KEYSTORE_PASSWORD = $PASS"
echo "  ANDROID_KEY_ALIAS         = upload"
echo "و فایلِ $OUT را جایِ امن (مثلاً password manager) نگه دارید."
