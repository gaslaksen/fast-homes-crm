# Dealcore iOS App — Implementation Plan

Native iOS app (React Native / Expo) for Dealcore that delivers push notifications for
new leads, messages, and calls, plus full Twilio SMS and calling with a native incoming-call
screen (CallKit). Goal: Closer Control / GHL Lead Connector parity, without the bloat.

**Decisions locked in:** React Native (Expo) · iOS only (v1) · full scope (calls + SMS + notifications).

---

## 1. Why this is mostly a frontend + push job

The backend already does the hard parts. The mobile app reuses them 1:1:

| Capability | Existing backend | Mobile reuse |
| --- | --- | --- |
| Auth | JWT (30d) via `POST /auth/login`, Bearer header | Same — store token in iOS Keychain |
| Voice token | `POST /calls/twilio/token`, identity = `userId` | Same endpoint; add `pushCredentialSid` for mobile |
| Outbound call | TwiML App → `generateDialTwiml()` → `<Dial><Number>` | No change |
| Inbound call | `generateIncomingTwiml()` → `<Dial><Client><Identity>{userId}` | **No change** — phone registers under same `userId` and rings via push |
| SMS send/receive | `sms.provider.ts` + inbound webhooks → `handleInboundMessage()` | Reuse REST endpoints for thread list / send |
| Call recording/transcript | status + recording callbacks | Reuse; display in app |

The single architectural insight: **inbound calls already target `<Client><Identity>{userId}</Identity>`.**
Twilio delivers a call for that identity to *every* registered endpoint under it — browser softphone
*and* the mobile Voice SDK. So the phone rings through the exact path the browser uses today. We add a
Push Credential so Twilio can wake a backgrounded/killed app via PushKit (VoIP push) → CallKit.

What's genuinely new:
1. The Expo app itself (screens: inbox, lead detail, dialer, settings).
2. Device-token registration + a push-sending service in the API.
3. A Twilio Push Credential (APNs VoIP) so inbound calls reach a closed app.
4. Standard APNs notifications for new leads / new messages.

---

## 2. Backend work (apps/api)

### 2.1 Device registration

New Prisma model (needs a migration — `@@map` to snake_case, per project rule):

```prisma
model PushDevice {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform     String   // "ios"
  apnsToken    String?  // standard APNs device token (alerts)
  voipToken    String?  // PushKit VoIP token (incoming calls)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([userId, apnsToken])
  @@index([userId])
  @@map("push_devices")
}
```

New module `apps/api/src/push/`:
- `POST /push/devices` — body `{ platform, apnsToken, voipToken }`, auth via JWT (decode `userId` like `calls.controller.ts` does). Upsert.
- `DELETE /push/devices/:token` — unregister on logout.
- `PushService.notifyUser(userId, { title, body, data })` — looks up the user's APNs tokens and sends via `node-apn` (or `@parse/node-apn`) using an APNs **auth key (.p8)** — simpler than certs, one key for all of it.

### 2.2 Fire notifications from existing events

These are the only call sites; both already exist:
- **New lead** → in `leads.service.ts` `createLead()` (same place that schedules initial outreach). `notifyUser(ownerId, { title: 'New lead', body: address, data: { leadId } })`.
- **New inbound message** → in `messages.service.ts` `handleInboundMessage()` after persisting the inbound row. `notifyUser(..., { data: { leadId, threadId } })`.

(Inbound *calls* do **not** need an APNs alert from us — Twilio's VoIP push handles the ring. We can still log/badge.)

### 2.3 Twilio Voice token: add the Push Credential for mobile

In `twilio-voice.service.ts` `generateToken()`, accept an optional `platform` and attach the
VoIP push credential when minting for the app:

```ts
new VoiceGrant({
  outgoingApplicationSid: twimlAppSid,
  incomingAllow: true,
  pushCredentialSid: this.config.get('TWILIO_APN_PUSH_CREDENTIAL_SID'), // mobile only
})
```

Controller: extend `POST /calls/twilio/token` to read `?platform=ios` (or a body field) and pass it
through. Browser path stays exactly as-is (no push credential).

### 2.4 New env vars

```
APNS_AUTH_KEY_P8=        # base64 of the .p8 (alerts)
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=com.dealcore.app
APNS_PRODUCTION=false
TWILIO_APN_PUSH_CREDENTIAL_SID=  # from Twilio Console, backed by APNs VoIP key
```

---

## 3. Twilio + Apple setup (one-time, mostly console work)

1. Apple Developer Program account ($99/yr). Create App ID `com.dealcore.app` with **Push Notifications** capability.
2. Create an **APNs Auth Key (.p8)** → used for both standard alerts (our `PushService`) and, in Twilio, for VoIP.
3. In **Twilio Console → Voice → Push Credentials**, create a credential from the APNs key. Note the
   `Credential SID` → `TWILIO_APN_PUSH_CREDENTIAL_SID`.
4. Confirm the TwiML App's Voice URL still points at `…/calls/twilio/voice` and the number's inbound at
   `…/calls/twilio/incoming` (already configured).

---

## 4. The Expo app (new package: `apps/mobile`)

Stack: Expo (dev client, **not** Expo Go — native modules required), `expo-router`, TanStack Query,
`expo-secure-store` (Keychain), `expo-notifications` (alerts), `@twilio/voice-react-native-sdk` (calls +
CallKit + PushKit), config plugins for the Twilio SDK + VoIP push entitlement. Build via **EAS Build**.

### Screens (v1)
- **Login** — email/password → `POST /auth/login`, token to SecureStore.
- **Inbox** — message threads (reuse existing messages list endpoints); unread badges.
- **Thread / Lead detail** — conversation, send SMS, CAMP insights, call button, recording/transcript playback.
- **Dialer** — keypad + Recents (`GET /calls/twilio/recents`); outbound via Voice SDK.
- **Incoming call** — handled by **CallKit** (system UI), backed by the Voice SDK's VoIP push handler.
- **Settings** — notification prefs, logout (unregister device).

### Voice integration (the careful part)
- On login: `POST /calls/twilio/token?platform=ios` → `voice.register(token, voipDeviceToken)`.
- Register VoIP token from `react-native-voip-push-notification` (or the SDK's helper) → send to
  `POST /push/devices` as `voipToken`.
- Incoming: PushKit wakes the app → SDK emits `callInvite` → present CallKit. Accept bridges audio.
  This is why a killed app still rings — the whole reason a PWA can't compete.
- Outbound: `voice.connect(token, { To: leadPhone, leadId })` → hits the same TwiML App as the browser.

### Notifications (alerts)
- Register APNs token via `expo-notifications` → `POST /push/devices` as `apnsToken`.
- Tap handler deep-links: lead push → lead detail; message push → thread (via `expo-router`).

---

## 5. Phasing

| Phase | Deliverable | Rough effort |
| --- | --- | --- |
| 0 | Apple account, APNs key, Twilio Push Credential, EAS project | 0.5 wk (mostly waiting on Apple) |
| 1 | API: `PushDevice` model + migration, `/push/devices`, `PushService`, wire lead/message events | 0.5 wk |
| 2 | Expo app skeleton: login, SecureStore auth, API client, inbox + thread + send SMS | 1 wk |
| 3 | APNs alerts end-to-end (new lead / new message → tap → deep link) | 0.5 wk |
| 4 | Voice SDK: outbound dialer + Recents | 0.5–1 wk |
| 5 | Inbound calls: VoIP push + CallKit (token push credential, register voipToken) | 1 wk |
| 6 | Polish, TestFlight, internal dogfood | 0.5–1 wk |

**~4–5 weeks** to a TestFlight build with full parity. Phases 1–3 alone (notifications + messaging)
are usable in ~2 weeks if you want testers in early.

## 6. Risks / watch-items
- VoIP push + CallKit is the highest-risk integration; budget buffer in Phase 5. Test on a real device early (PushKit doesn't work in the simulator).
- Apple now requires apps using PushKit VoIP to actually report to CallKit on every push, or iOS kills the app. The Twilio SDK does this correctly if wired per their docs — follow their RN example app.
- Keep the browser softphone live in parallel; the mobile app registering under the same `userId` means both ring, which is the desired behavior during rollout.
- `apps/mobile` should stay out of the Turborepo web/api build path (or have its own pipeline) so EAS builds don't entangle with Railway/Vercel.
