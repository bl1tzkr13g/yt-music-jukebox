# YT Music Jukebox

Unraid Docker music-request jukebox (v0.2.0 development build).

## Quick start

Set a long random `ADMIN_TOKEN` in your Docker environment (at least 16 characters), then:

```bash
docker compose up --build -d
```

Open `http://YOUR-UNRAID-IP:3000/player` on the TV and `http://YOUR-UNRAID-IP:3000/join` on guest phones.

## Configuration

- Defaults: `config/default.yaml` (version-controlled template).
- Persistent settings: `/mnt/user/appdata/yt-music-jukebox/config.yaml` on Unraid, mounted at `/data/config.yaml`.
- Web editor: `/settings` using the admin token.
- Starter profanity list: `config/profanity-words.txt`; add custom words in `chat.profanity.extra_words`, or exceptions in `allow_words`.
- `chat.profanity.action`: `mask` or `reject`. Profanity matching is best-effort and does not cover all obfuscations.
- `chat.mode`: `live`, `song`, or `both`; `chat.enabled` toggles chat.
- `player.theme`, `sidebar_percent`, `show_queue`, `show_qr_code`, `show_comments` customize the TV layout.

## Current implementation

The player layout follows the two-column TV mockup, including video region, now-playing details, guest queue, chat and locally generated QR code. Guests can submit links and chat messages. Admins can advance the saved queue, clear chat and edit settings. Queue and messages persist across restarts.

**Important limitations:** Video metadata is not verified yet, so guest requests are saved as *unverified*. The host must not treat this build as having working explicit-content or genre filtering. YouTube playback currently uses an embedded iframe and does not yet automatically advance at the end of a video. Default playlist playback, Google OAuth, YouTube Music integration, song search, full host moderation and rate-limit hardening are not implemented. Do not expose this development build to untrusted networks.

LAN-only access is a deployment/network requirement, not a security guarantee from the web server. Restrict port 3000 using your network firewall, and do not forward it to the internet. The guest page has no authentication.

## Next steps

1. YouTube metadata lookup and robust request filtering before queue admission.
2. YouTube IFrame Player API end-of-song progression and default playlist fallback.
3. Proper host login/session management and improved guest abuse protection.
4. Tests, automated Docker builds and Fire TV browser testing.
