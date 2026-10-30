# YT Music Jukebox — Fire TV Player

A single-purpose Fire TV Android application. On first launch enter the LAN server IP and port (e.g. `10.0.0.40:3035`). The address is saved in Android private preferences. Later launches open `http://IP:PORT/player` full screen.

The Fire TV remote Menu button opens the server address setup again; Back is ignored in player mode. The app requires access to the jukebox over the same LAN. It has no guest request or administration screens.

## Build APK

Open `fire-tv-player` in Android Studio and build the debug APK, or run `gradle :app:assembleDebug` using Gradle 8.9 and Android SDK 35. Output: `app/build/outputs/apk/debug/app-debug.apk`.

Install the APK on Fire TV via ADB or a trusted sideloading method. Android WebView's embedded YouTube playback may vary by Fire OS/WebView version and YouTube embed policy; verify autoplay and video playback on the target device before relying on it.
