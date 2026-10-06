#!/usr/bin/env bash
# یک‌بار اجرا کنید: اسکلتِ Flutter (android/ و ios/) را می‌سازد و کدِ native این پروژه را رویش می‌گذارد.
#   پیش‌نیاز: Flutter SDK (>=3.22)، و برای iOS یک Mac با Xcode.
set -euo pipefail
cd "$(dirname "$0")"

flutter create --org ir.irforge --project-name irforge_pay --platforms=android,ios .
# flutter create ممکن است lib/main.dart و test/ را با نمونه‌ی خودش عوض کند؛ نسخه‌ی خودمان را برگردان.
git checkout -- lib test 2>/dev/null || true
# تستِ نمونه‌ی flutter create به MyApp اشاره می‌کند و analyze را می‌شکند.
rm -f test/widget_test.dart

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
            s += '\ndependencies {\n    implementation("androidx.work:work-runtime-ktx:2.10.0")\n    implementation("com.squareup.okhttp3:okhttp:4.12.0")\n    implementation("androidx.core:core-ktx:1.13.1")\n}\n'
        else:
            s += "\ndependencies {\n    implementation 'androidx.work:work-runtime-ktx:2.10.0'\n    implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n    implementation 'androidx.core:core-ktx:1.13.1'\n}\n"
    p.write_text(s)
    print("patched", name)
PY

# اگر namespace/applicationId عوض نشده باشد، اپ هنگامِ اجرا ClassNotFound می‌دهد؛ همین‌جا بشکن.
grep -rq 'ir.irforge.payagent' android/app/build.gradle* || { echo "❌ namespace patch نشد"; exit 1; }
grep -q 'namespace = "ir.irforge.payagent"\|namespace "ir.irforge.payagent"' android/app/build.gradle* || { echo "❌ namespace نادرست"; exit 1; }

# امضای release با keystore ثابت (فقط اگر android/key.properties موجود باشد — CI آن را از secrets می‌سازد).
# بدونِ آن، بیلد با کلیدِ debug امضا می‌شود و آپدیتِ داخلِ اپ روی نصب‌های قبلی کار نمی‌کند.
python3 - <<'PY'
import pathlib
kts = pathlib.Path("android/app/build.gradle.kts")
groovy = pathlib.Path("android/app/build.gradle")
if kts.exists() and "key.properties" not in kts.read_text():
    # توجه: داخلِ build.gradle.kts کلمه‌ی «java» به extensionِ جاوای Gradle اشاره می‌کند، پس java.util.Properties
    # را نمی‌شود با نامِ کامل نوشت؛ import باید اولِ فایل باشد.
    kts.write_text("import java.util.Properties\n" + kts.read_text() + """
val ksFile = rootProject.file("key.properties")
if (ksFile.exists()) {
    val ks = Properties().apply { ksFile.inputStream().use { load(it) } }
    android {
        signingConfigs {
            create("release") {
                keyAlias = ks.getProperty("keyAlias")
                keyPassword = ks.getProperty("keyPassword")
                storeFile = file(ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword")
            }
        }
        buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } }
    }
}
""")
    print("signing patched (kts)")
elif groovy.exists() and "key.properties" not in groovy.read_text():
    groovy.write_text(groovy.read_text() + """
def ksFile = rootProject.file("key.properties")
if (ksFile.exists()) {
    def ks = new Properties()
    ksFile.withInputStream { ks.load(it) }
    android {
        signingConfigs {
            release {
                keyAlias ks["keyAlias"]
                keyPassword ks["keyPassword"]
                storeFile file(ks["storeFile"])
                storePassword ks["storePassword"]
            }
        }
        buildTypes { release { signingConfig signingConfigs.release } }
    }
}
""")
    print("signing patched (groovy)")
PY

# قانون‌های R8 (بدونِ آن‌ها WorkManager در release کرش می‌کند) + اتصال به buildType release
cp overlay/android/app/proguard-rules.pro android/app/proguard-rules.pro
python3 - <<'PY'
import pathlib
kts = pathlib.Path("android/app/build.gradle.kts")
groovy = pathlib.Path("android/app/build.gradle")
if kts.exists() and "proguard-rules.pro" not in kts.read_text():
    kts.write_text(kts.read_text() + '''
android {
    buildTypes {
        getByName("release") {
            proguardFiles("proguard-rules.pro")
        }
    }
}
''')
    print("proguard wired (kts)")
elif groovy.exists() and "proguard-rules.pro" not in groovy.read_text():
    groovy.write_text(groovy.read_text() + '''
android {
    buildTypes {
        release {
            proguardFiles 'proguard-rules.pro'
        }
    }
}
''')
    print("proguard wired (groovy)")
PY
grep -q 'proguard-rules.pro' android/app/build.gradle* || { echo "❌ proguard wiring نشد"; exit 1; }

# جایگزینی کدِ Kotlin و manifest
rm -rf android/app/src/main/kotlin
cp -R overlay/android/app/src/main/kotlin android/app/src/main/kotlin
cp overlay/android/app/src/main/AndroidManifest.xml android/app/src/main/AndroidManifest.xml
cp -R overlay/android/app/src/main/res/xml android/app/src/main/res/

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
dart run flutter_launcher_icons
echo "✅ آماده. اجرا:  flutter run   |  APK:  flutter build apk --release   |  iOS:  flutter build ipa"
