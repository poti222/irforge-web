#!/usr/bin/env bash
# تستِ دودی روی شبیه‌ساز اندروید (در CI): نصب، اجرا، گرفتنِ لاگِ کرش و اسکرین‌شات.
# خروجی: 0 = اپ بعد از ۲۰ ثانیه زنده است و کرشی نیست؛ 1 = غیر از این (لاگ‌ها چاپ می‌شوند).
set -u
PKG=ir.irforge.payagent
APK="${1:-dist/irforge-pay-agent.apk}"
mkdir -p smoke-out

echo "== install"; adb install -r "$APK" || { echo "INSTALL FAILED"; exit 1; }
adb shell pm grant "$PKG" android.permission.RECEIVE_SMS 2>&1 || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>&1 || true
adb logcat -c
echo "== start"; adb shell am start -W -n "$PKG/$PKG.MainActivity" 2>&1
sleep 20
adb exec-out screencap -p > smoke-out/screen.png || true
PID="$(adb shell pidof "$PKG" | tr -d '\r')"
adb logcat -d > smoke-out/logcat.txt
echo "== pid: ${PID:-<none>}"
echo "== FATAL / crash buffer"; adb logcat -d -b crash | tail -80
echo "== relevant logcat"; grep -E "AndroidRuntime|FATAL|ClassNotFound|NoClassDef|flutter|ir\.irforge|WorkManager|Process .* died" smoke-out/logcat.txt | tail -120
if [ -z "$PID" ] || grep -q "FATAL EXCEPTION" smoke-out/logcat.txt; then echo "❌ SMOKE FAILED"; exit 1; fi
echo "✅ SMOKE OK"
