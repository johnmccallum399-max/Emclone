# LCDR — personal device assistant (Android)

A private, sideloaded Android client for the assistant backend in `../backend`.
LCDR chats, talks, and acts on the phone itself: texts, contacts, calendar,
files, alarms, camera, clipboard, notifications and app usage — all driven by
LLM tool calls. It is built for one owner and never goes through the Play Store.

- **Kotlin 2.2 · AGP 8.11 · Compose Material 3 · Hilt · Room · Retrofit/OkHttp SSE · WorkManager**
- **minSdk 26 / targetSdk 35.** No Google Play Services dependency; location uses
  the platform `LocationManager`, and reverse geocoding degrades gracefully on
  ROMs without a Geocoder backend.
- **No API keys on the device.** All model, speech and search calls go through
  the backend; the Realtime voice mode uses a short-lived key minted by the backend.

## Build and install

Requirements: JDK 17 and the Android SDK (Android Studio installs both).

```bash
cd android
./gradlew assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Every push that touches `android/` also runs the **Android** GitHub Actions
workflow, which runs the unit tests and uploads `lcdr-debug-apk` as a build
artifact — download it from the run page and sideload it.

### Backend URL

Defaults to `https://ai-assistant-backend-dhi6.onrender.com`. Override it:

| Where | How |
| --- | --- |
| Build time (Gradle property) | `./gradlew assembleDebug -PLCDR_BACKEND_URL=https://my-backend.example.com` |
| Build time (environment) | `LCDR_BACKEND_URL=https://… ./gradlew assembleDebug` |
| Runtime | Login screen → **Server**, or Settings → Account → Backend URL |

Sign in with the backend's `APP_USERNAME` / `APP_PASSWORD`. The JWT is stored in
`EncryptedSharedPreferences` (AES-256-GCM values, Keystore-backed master key).

## How device tools work

The backend runs the model. The app sends its device tool definitions
(`clientTools`) with each chat message, plus the persona prompt and a block of
live device context. When the model calls a device tool, the backend stream
emits `client_tool_call` events and pauses (`awaiting_client_tools`). The app
runs each tool through `ToolDispatcher` and posts the results to
`POST /api/chat/conversations/:id/tool-results`, which resumes the stream.
Server tools (`web_search`, `remember`, `recall`, `forget`, `calculator`) still
run on the backend.

`ToolDispatcher` runs every call through the same steps:

1. **Enabled?** Each tool can be switched off in Settings → Device tools.
2. **Permission.** Runtime permissions are requested at first use, after a
   plain-language explanation. Settings-page access (all-files, usage access)
   opens the system page.
3. **Confirmation.** Destructive tools (`send_sms`, `delete_event`, overwriting
   with `write_file`) show an on-device confirmation dialog. If you decline,
   the model is told you declined.
4. **Action log.** Every write/send is recorded in Room with a timestamp and
   outcome. See Settings → Action history.

To add a tool, implement `DeviceTool` and bind it in `di/ToolModule.kt`.

| Group | Tools |
| --- | --- |
| Communications | `read_sms`, `send_sms`, `read_contacts`, `write_contact` |
| Calendar | `list_events`, `create_event`, `delete_event` |
| Files | `list_files`, `read_file`, `write_file`, `open_file` |
| System | `get_battery`, `get_location`, `set_alarm`, `set_timer`, `take_photo`, `get_clipboard`, `set_clipboard`, `send_notification`, `get_running_apps` |
| Hub | `hub_list_agents`, `hub_create_session`, `hub_run_session` |

## The system prompt

It is built from three layers:

1. **Base identity.** The built-in LCDR prompt (`core/Persona.kt`), or your
   override from Settings → Persona.
2. **Long-term memory.** Appended by the backend from `/api/memory`. The Memory
   tab shows and edits the same entries, and caches them offline.
3. **Live device context.** Rebuilt for every message: time, battery, last
   known location, last app used, and today's events. Each item can be
   switched off in Settings → Device context. This layer only uses permissions
   you've already granted and never prompts for new ones.

## Voice modes

| Mode | Speech-to-text | Reply | Device tools |
| --- | --- | --- | --- |
| On-device | Android `SpeechRecognizer` (on-device recognizer on API 31+) | Android `TextToSpeech` | ✓ via chat |
| Pipeline | Backend Whisper (`/api/voice/transcribe`) | Backend OpenAI TTS (`/api/voice/speak`) | ✓ via chat |
| Realtime | OpenAI Realtime over WebRTC | Realtime audio | ✓ via the data channel |

While a voice session runs, a foreground service shows a persistent
notification with a Stop action.

## Entry points

- **Quick Settings tile "Ask LCDR".** Edit your Quick Settings panel, drag the
  tile in, and tap it to open straight into voice.
- **Daily briefing.** Settings → Daily briefing. At the time you choose,
  WorkManager asks LCDR for a briefing: today's calendar, the weather (via
  `web_search`), relevant memory, and unread texts. It's posted as an
  expandable notification, and tapping it opens the briefing conversation.
  "Send a briefing now" runs it once, immediately.
- **Biometric lock.** Settings → Security. The app locks on open and again
  after more than a minute in the background.

## Permissions, and why

| Permission | Used for |
| --- | --- |
| `READ_SMS`, `SEND_SMS` | Reading threads you ask about; sending texts you've confirmed |
| `READ_CONTACTS`, `WRITE_CONTACTS` | Resolving names to numbers; adding or updating contacts |
| `READ_CALENDAR`, `WRITE_CALENDAR` | Listing, creating and deleting events |
| `MANAGE_EXTERNAL_STORAGE` (API 30+) / storage (≤ 29) | File tools anywhere in shared storage |
| `ACCESS_FINE/COARSE_LOCATION` | `get_location` and the optional location context |
| `CAMERA` | `take_photo` (required because the app declares camera use) |
| `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` | Voice sessions |
| `POST_NOTIFICATIONS` | Briefings and `send_notification` |
| `PACKAGE_USAGE_STATS` | `get_running_apps` and the active-app context (granted in system settings) |
| `QUERY_ALL_PACKAGES` | Showing app names instead of package ids |
| `SET_ALARM` | Alarms and timers through the clock app |
| `USE_BIOMETRIC` | The optional app lock |
| `RECEIVE_BOOT_COMPLETED` | Re-anchoring the briefing schedule after a reboot |

`MANAGE_EXTERNAL_STORAGE`, `READ_SMS`/`SEND_SMS` and `QUERY_ALL_PACKAGES`
would be restricted on Google Play. That's acceptable only because this is a
personal, sideloaded build.

## Layout

```
app/src/main/java/com/lcdr/assistant/
├── core/        persona prompt, notifications, intent actions
├── data/        auth (encrypted JWT), prefs, remote (Retrofit + SSE), local (Room), repo
├── device/      live device context and the dashboard snapshot
├── tools/       DeviceTool framework, dispatcher, UI broker, and every tool
├── voice/       on-device STT/TTS, Whisper/TTS pipeline, Realtime WebRTC, foreground service
├── briefing/    daily briefing worker and scheduler
├── tile/        "Ask LCDR" Quick Settings tile
└── ui/          Compose screens: login, chat, voice, hub, memory, settings, device
```
