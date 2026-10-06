# R8 در بیلد release اسمِ کلاس‌ها را عوض می‌کرد و Room کلاسِ تولیدشده‌ی WorkDatabase_Impl را پیدا نمی‌کرد
# (کرشِ لحظه‌ی اول: "Failed to create an instance of class androidx.work.impl.WorkDatabase").
# Obfuscation خاموش است (shrink باقی می‌ماند) + قانون‌های نگه‌داری برای WorkManager/Room/کدِ خودِ اپ.
-dontobfuscate
-keep class androidx.work.** { *; }
-keep class androidx.room.** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class androidx.startup.** { *; }
-keep class ir.irforge.payagent.** { *; }
