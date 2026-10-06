#!/usr/bin/env bash
# یک‌بار اجرا کنید: اسکلتِ Flutter (android/ و ios/) را می‌سازد و کدِ native این پروژه را رویش می‌گذارد.
#   پیش‌نیاز: Flutter SDK (>=3.22)، و برای iOS یک Mac با Xcode.
set -euo pipefail
cd "$(dirname "$0")"

flutter create --org ir.irforge --project-name irforge_pay --platforms=android,ios .
# flutter create ممکن است lib/main.dart و test/ را با نمونه‌ی خودش عوض کند؛ نسخه‌ی خودمان را برگردان.
git checkout -- lib test 2>/dev/null || true

# applicationId ثابت (با namespace کدِ Kotlin یکی باشد)
python3 - <<'PY'
import re, pathlib
for name in ("android/app/build.gradle.kts", "android/app/build.gradle"):
    p = pathlib.Path(name)
    if not p.exists():
        continue
    s = p.read_text()
    s = re.sub(r'(applicationId\s*=?\s*)"[^"]+"', r'\1"ir.irforge.payagent"', s)
    s = re.sub(r'(namespace\s*=?\s*)"[^"]+"', r'\1"ir.irforge.payagent"', s)
    if "work-runtime-ktx" not in s:
        if name.endswith(".kts"):
            s += '\ndependencies {\n    implementation("androidx.work:work-runtime-ktx:2.9.1")\n    implementation("com.squareup.okhttp3:okhttp:4.12.0")\n    implementation("androidx.core:core-ktx:1.13.1")\n}\n'
        else:
            s += "\ndependencies {\n    implementation 'androidx.work:work-runtime-ktx:2.9.1'\n    implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n    implementation 'androidx.core:core-ktx:1.13.1'\n}\n"
    p.write_text(s)
    print("patched", name)
PY

# جایگزینی کدِ Kotlin و manifest
rm -rf android/app/src/main/kotlin
cp -R overlay/android/app/src/main/kotlin android/app/src/main/kotlin
cp overlay/android/app/src/main/AndroidManifest.xml android/app/src/main/AndroidManifest.xml

# iOS: توضیحِ دسترسیِ دوربین (اسکنِ QR)
PLIST=ios/Runner/Info.plist
if [ -f "$PLIST" ] && ! grep -q NSCameraUsageDescription "$PLIST"; then
  python3 - <<'PY'
import pathlib
p = pathlib.Path("ios/Runner/Info.plist")
s = p.read_text()
s = s.replace("</dict>\n</plist>", "\t<key>NSCameraUsageDescription</key>\n\t<string>برای اسکن QR اتصال از دوربین استفاده می‌شود.</string>\n</dict>\n</plist>")
p.write_text(s)
PY
fi

flutter pub get
echo "✅ آماده. اجرا:  flutter run   |  APK:  flutter build apk --release   |  iOS:  flutter build ipa"
