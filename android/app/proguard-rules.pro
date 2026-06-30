# Keep Capacitor bridge so JS↔Java calls survive shrinking
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep class com.bsmotors.shop.** { *; }

# Keep Custom Tabs (used for Google auth popup)
-keep class androidx.browser.** { *; }

# Keep WebView JS interface if any
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Remove unused logging in release
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int i(...);
    public static int w(...);
    public static int d(...);
}

# Standard Android keep rules
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
