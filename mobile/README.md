# DealNector News — Mobile (Expo / React Native)

A Flipboard-style companion app for the DealNector platform. Picks
industry channels, pulls a summarised news feed from the parent
Next.js app (`/api/mobile/news/feed`), and renders one card at a time
with a tap-to-flip animation and a tap-to-open-in-browser action.

Ships as an Expo managed app — one codebase produces both the Android
APK (or AAB) and the iOS IPA via Expo Application Services (EAS).

---

## What's included

| File | Purpose |
|---|---|
| `App.tsx` | Navigation root — stacks IndustryPicker → NewsFeed |
| `src/screens/IndustryPicker.tsx` | Initial screen. Loads the channel catalogue from `/api/mobile/news/feed` (OPTIONS), shows chips, persists picks |
| `src/screens/NewsFeed.tsx` | Feed screen. Fetches cards for the selected channels, renders a FlatList of FlipCards with pull-to-refresh |
| `src/components/FlipCard.tsx` | 3D flip-card. Front = headline + source + time + channel chip. Back = summary + all matching chips + "Open source ↗" button |
| `src/lib/api.ts` | Typed fetch wrapper for the DealNector endpoint |
| `src/lib/storage.ts` | AsyncStorage helpers — persists picks + API base URL |
| `src/lib/config.ts` | Reads `EXPO_PUBLIC_API_BASE` / `EXPO_PUBLIC_API_KEY` at build time |
| `src/lib/time.ts` | Relative-time formatter |

Server-side counterpart lives in the parent repo at:
- `src/app/api/mobile/news/feed/route.ts` — unified feed endpoint
- `src/lib/news/channels.ts` — shared channel catalogue

---

## Prerequisites

- **Node 18+** (Expo 51 requirement)
- **npm** or **pnpm**
- **Expo CLI + EAS CLI**: `npm i -g eas-cli`
- An **Expo account** (free): https://expo.dev/signup
- For iOS builds: an Apple Developer account (paid) — not required for Android
- A running DealNector Next.js host reachable over HTTPS (the app needs it)

---

## 1. Install

```bash
cd mobile
npm install
```

> If you don't need iOS support right away, skip `pod install` — Expo managed workflow handles native projects during `eas build`.

---

## 2. Configure the API target

Two ways:

### Option A — Bake into the build

Set these **before** running `eas build`:

```bash
# Linux / macOS
export EXPO_PUBLIC_API_BASE="https://dealnector.yourcompany.com"
export EXPO_PUBLIC_API_KEY=""    # leave blank if server is open

# Windows PowerShell
$env:EXPO_PUBLIC_API_BASE = "https://dealnector.yourcompany.com"
$env:EXPO_PUBLIC_API_KEY = ""
```

Or edit `eas.json` and put them under the `preview.env` / `production.env` blocks — this is the cleanest path since the values travel with the build profile.

### Option B — Change inside the app

Tap the **⚙** icon on the Industry Picker screen; type the base URL and key; tap **Save + refresh**. The value persists via AsyncStorage so the next launch picks it up.

### Server-side key (optional)

On the Next.js host, set `DEALNECTOR_MOBILE_API_KEY=your-secret`. The mobile endpoint will then reject requests without a matching `?key=` or `x-dn-key` header. Leave the env var unset to keep the endpoint open — same trust level as the public RSS feeds it proxies.

---

## 3. Develop locally

```bash
npm run start       # starts Metro + Expo Dev Tools
npm run android     # launches on connected device / emulator
npm run ios         # launches on iOS simulator (macOS only)
npm run typecheck
```

For on-device testing, install the **Expo Go** app on your phone, scan the QR code from the terminal. Note: the API must be reachable from the phone — use your LAN IP for `EXPO_PUBLIC_API_BASE` (e.g. `http://192.168.1.x:3200`), not `localhost`.

---

## 4. Produce the Android APK

```bash
eas login                          # one-time
eas init                           # generates the EAS project ID, updates app.json
eas build -p android --profile preview
```

`preview` builds an `.apk` (installable directly on any Android device — enable "Install from unknown sources"). `production` builds an `.aab` (for Play Store upload).

The build runs on Expo's cloud. When it finishes, the terminal prints a download link. You can also find the build under **https://expo.dev → your project → Builds**.

**Distribution**: download the `.apk`, share via Drive / WhatsApp / MDM. Users install with one tap.

---

## 5. Produce the iOS IPA

```bash
eas build -p ios --profile preview
```

This requires:
- An Apple Developer account (EAS will prompt for credentials)
- `ios.simulator: false` in `eas.json` (already set) if you want a device build
- Provisioning handled automatically by EAS; you can also upload your own certificates

The resulting `.ipa` can be distributed through:
- **TestFlight** (recommended for internal testing): `eas submit -p ios --latest`
- **Ad-hoc distribution**: share the `.ipa` to devices listed on your Apple dev profile
- **Enterprise distribution**: if you hold an Apple Enterprise Program membership

---

## 6. Assets to replace

Expo needs three icon files in `mobile/assets/`:

- `icon.png` — 1024×1024 square, no transparency
- `adaptive-icon.png` — 1024×1024 foreground (Android adaptive)
- `splash.png` — at least 1242×2436, preferably SVG-exported
- `favicon.png` — 48×48 (web only)

Drop any DealNector-branded PNGs into `mobile/assets/` matching those filenames. Until you do, `eas build` will use Expo's default placeholders (a diamond logo), which is fine for internal testing.

---

## 7. Architecture notes

- **No LLM calls** in either the mobile app or the backend endpoint. Summaries are the first 280 characters of the RSS `<description>` with HTML stripped. This keeps the app fast, deterministic, and free.
- **Offline behaviour**: the app does not currently cache responses on-device. A refresh requires connectivity. AsyncStorage only persists settings + channel picks.
- **Card flip**: `react-native-reanimated` drives a 420ms rotateY with perspective 1200. `backfaceVisibility: 'hidden'` on each face gives the clean Flipboard flip.
- **External browser handoff**: uses `Linking.openURL()` which routes to the OS default browser — iOS Safari, Android Chrome, etc. No in-app browser.
- **Pull-to-refresh** hits the endpoint with `?fresh=1` to bypass the 5-minute server cache.
- **Deduplication**: articles appearing in multiple channels are merged — their union of channels shows as multiple chips on the card back.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach DealNector" | API base URL wrong; tap ⚙ and re-enter |
| Empty feed | Selected channels have no recent matching items. Try different picks or `?fresh=1`. |
| "Invalid or missing API key" | Server has `DEALNECTOR_MOBILE_API_KEY` set; enter the matching value in ⚙ |
| APK won't install on Android | Enable "Install from unknown sources" in device settings |
| Reanimated worklet errors | Ensure `react-native-reanimated/plugin` is last in `babel.config.js` (already configured) |
| Build fails with "Invalid EAS project ID" | Run `eas init` once to provision the project, then rebuild |

---

## 9. License

Internal use within DealNector. Not for redistribution.
