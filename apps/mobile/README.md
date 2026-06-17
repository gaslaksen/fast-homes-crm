# Dealcore Mobile (Expo / iOS)

Native iOS app for Dealcore: lead inbox, SMS conversations, and push notifications
for new leads and messages. Calling (Twilio Voice + CallKit) lands in a later phase.
See [`docs/mobile-app-plan.md`](../../docs/mobile-app-plan.md) for the full roadmap.

This is a **standalone Expo project**. It is intentionally excluded from the root
pnpm workspace (`pnpm-workspace.yaml` has `!apps/mobile`) so its React Native
dependency tree never destabilizes the api/web install. It has its own
`node_modules` and lockfile.

## Prerequisites

- Node 18+, an Expo account (`npx expo login`), and the EAS CLI (`npm i -g eas-cli`).
- An Apple Developer account and the Phase 0 credentials (see below) for push to work.
- A physical iPhone for testing push (the simulator cannot receive APNs tokens).

## Install & run

```bash
cd apps/mobile
npm install                 # NOT pnpm from the repo root; this app installs on its own
npx expo install --fix      # align dependency versions to the installed Expo SDK

# Point the app at your API (Railway URL). Either set this env var:
export EXPO_PUBLIC_API_URL="https://<your-railway-api-domain>"
# ...or edit `extra.apiUrl` in app.json and the `env` blocks in eas.json.

# Push needs native modules, so use a dev client (not Expo Go):
eas build --profile development --platform ios   # first time, builds a dev client
npx expo start --dev-client                      # then run the JS
```

For pure UI work without push you can run `npx expo start` in Expo Go, but
notification registration will no-op there.

## What's implemented (Phase 2)

- **Auth** — email/password against `POST /auth/login`; JWT stored in the iOS
  Keychain via `expo-secure-store`; auto-restore on launch; 401 anywhere signs out.
- **API client** — `src/lib/api.ts`, axios with bearer injection.
- **Inbox** — `GET /inbox/threads`, pull-to-refresh, unread indicators.
- **Conversation** — `GET /leads/:id/messages`, send via `POST /leads/:id/messages/send`,
  marks read on open, polls for new inbound messages.
- **Push registration** — requests permission, reads the APNs device token, and
  registers it with `POST /push/devices` (the Phase 1 backend). Notification taps
  deep-link into the relevant conversation. A "Send test notification" button in
  Settings hits `POST /push/test`.
- **Dialer** — placeholder; real Twilio Voice + CallKit is Phases 4-5.

## Project layout

```
app/                       expo-router routes
  _layout.tsx              providers + auth gate + push hooks
  login.tsx
  (tabs)/                  Inbox · Dialer · Settings
  lead/[id].tsx            conversation thread
src/
  lib/                     api, auth, config, queryClient
  features/inbox/          thread + message hooks and types
  features/push/           APNs registration + notification routing
```

## Phase 0 wiring (do this once for push to work)

These are manual console steps; the values flow into the **API** environment
(Railway), not this app. The app only needs `EXPO_PUBLIC_API_URL`.

1. **Apple Developer** > Identifiers: create App ID `com.dealcore.app` with the
   **Push Notifications** capability enabled.
2. **Keys**: create an **APNs Auth Key (.p8)**. Note the **Key ID** and your
   **Team ID**. `base64 -i AuthKey_XXXX.p8` and set these in Railway:
   - `APNS_AUTH_KEY_P8` = the base64 string
   - `APNS_KEY_ID`, `APNS_TEAM_ID`
   - `APNS_BUNDLE_ID=com.dealcore.app`
   - `APNS_PRODUCTION=true` once shipping via TestFlight
3. **Twilio Console** > Voice > Push Credentials: create a credential from the same
   APNs key (used in Phase 5 for incoming-call VoIP push). Set its SID as
   `TWILIO_APN_PUSH_CREDENTIAL_SID` in Railway.

Until the `APNS_*` vars are set, the API's push service stays dormant and device
registration is a harmless no-op.
