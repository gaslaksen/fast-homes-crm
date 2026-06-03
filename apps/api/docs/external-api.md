# External Conversations API (v1)

Stateless AI-messaging service for external partners (e.g. Closercontrol).
The partner drives the SMS conversation; Dealcore generates the next reply
and extracts CAMP-qualification fields from what the seller has said.

Dealcore does **not** send messages, schedule drips, mark opt-outs, or touch
any pipeline state. Those remain the partner's responsibility.

## Auth

Every request must include a Bearer token:

```
Authorization: Bearer <secret>
```

Valid tokens are configured in the API's `EXTERNAL_API_KEYS` env var as a
comma-separated list of `partnerKey:secret` pairs, e.g.:

```
EXTERNAL_API_KEYS=closercontrol:abc123...,otherpartner:def456...
```

The matched `partnerKey` is used to scope conversation records.

## POST /external/conversations/draft-reply

Generate the next outbound SMS for a conversation.

### Request

```json
{
  "externalId": "closercontrol-lead-abc123",
  "sellerFirstName": "Jane",
  "sellerPhone": "+15551234567",
  "conversationHistory": [
    { "direction": "OUTBOUND", "body": "Hi Jane, this is Dax...", "sentAt": "2026-06-03T15:01:00Z" },
    { "direction": "INBOUND",  "body": "around 70k, no rush",     "sentAt": "2026-06-03T15:14:00Z" }
  ],
  "knownFields": {
    "timeline": 365,
    "askingPrice": 70000,
    "conditionLevel": null,
    "ownershipStatus": null
  }
}
```

| Field                  | Type                | Required | Notes |
|------------------------|---------------------|----------|-------|
| `externalId`           | string              | yes      | Partner's own conversation/lead ID. Used as the idempotency key for the conversation record. |
| `sellerFirstName`      | string              | no       | Used in greetings and acknowledgments. Falls back to "there" if absent. |
| `sellerPhone`          | string              | no       | Stored for debugging only. The partner is the source of truth. |
| `conversationHistory`  | message[]           | yes      | Full history, oldest first. Send every time - Dealcore deduplicates by `(direction, body, sentAt)`. |
| `knownFields`          | object              | no       | Partner-cached CAMP values. If passed, they override whatever Dealcore has extracted. Use to keep both sides in sync. |

Message shape: `{ direction: "INBOUND" | "OUTBOUND", body: string, sentAt?: ISO-8601 string }`

### Response

```json
{
  "message": "Got it, around $70k and no rush on timing. How's the place holding up? Anything major going on with it?",
  "extractedFields": {
    "timeline": 365,
    "askingPrice": 70000,
    "askingPriceHigh": null,
    "askingPriceRaw": "70k",
    "conditionLevel": null,
    "ownershipStatus": null,
    "distressSignals": [],
    "sellerMotivation": null
  },
  "campScore": { "total": 5, "band": "TEPID" },
  "signals": {
    "campComplete": false,
    "shouldHandoff": false,
    "optOutDetected": false,
    "missingFields": ["conditionLevel", "ownershipStatus"]
  }
}
```

| Field                       | Notes |
|-----------------------------|-------|
| `message`                   | The SMS text to send. `null` if Dealcore declines to respond (currently only on opt-out detection). |
| `extractedFields`           | Running merge of everything Dealcore has extracted across the conversation. Use to keep your own state in sync. Any field absent from the latest call but present in earlier calls is preserved. |
| `campScore.total`           | 0-12. Pure math on the four CAMP fields. `arv` is not available in this path, so the money score is the unknown-default (1). |
| `campScore.band`            | One of `DEAD_COLD` \| `TEPID` \| `HOT` \| `STRIKE_ZONE`. |
| `signals.campComplete`      | All four CAMP fields are known. `message` will be a closing/handoff message. |
| `signals.shouldHandoff`     | Currently mirrors `campComplete`. Take this as the cue to route the lead to a human. |
| `signals.optOutDetected`    | The last inbound message contained a STOP-style keyword. `message` is `null`. Mark the contact opted-out on your side. |
| `signals.missingFields`     | CAMP fields not yet known: subset of `timeline`, `askingPrice`, `conditionLevel`, `ownershipStatus`. |

### Status codes

| Code | Meaning |
|------|---------|
| 200  | Success. Use `message` (if non-null) as the outbound SMS body. |
| 400  | Missing/invalid `externalId` or `conversationHistory`. |
| 401  | Missing or invalid Bearer token. |
| 500  | Dealcore internal error. Safe to retry. |

## Conventions and gotchas

- **Always send the full conversation history.** Dealcore re-extracts from
  the whole thread to keep state simple and self-healing. The internal store
  deduplicates messages by `(direction, body, sentAt)`, so resending old
  messages is a no-op.
- **`sentAt` is recommended on every message.** Without it we use "now" as
  the timestamp on insert, which weakens our dedupe. Pass the partner's
  authoritative send time when you have it.
- **Send latency: ~3-6s typical.** Two Claude calls per request (Haiku for
  extraction, Sonnet for the reply). Keep your HTTP client timeout >= 30s.
- **Opt-outs.** When `signals.optOutDetected` is true, do not send `message`
  (it's `null`). Mark the contact opted-out on your side and stop further
  outreach. We do not message the seller from here.
- **What we do NOT do.** Send SMS, schedule follow-ups, fetch property data
  (ARV, mortgage, ATTOM facts), score against ARV, manage pipeline status,
  enroll in campaigns, or persist anything Closercontrol can derive from
  the conversation. All of that stays on your side.
- **What we DO persist.** A lightweight `external_conversations` record
  keyed by `(partnerKey, externalId)` plus a copy of each message we see.
  This is for analytics, debugging, and token-cost optimization. It never
  feeds back into Dealcore's native lead automation.

## Example: end-to-end flow

1. Seller texts your Twilio number. Closercontrol records the inbound message.
2. Closercontrol POSTs to `/external/conversations/draft-reply` with the
   full thread (one inbound at this point).
3. Dealcore returns `message: "Hi Jane, this is Dax..."` plus an empty
   `extractedFields` and `campScore.total: 0`.
4. Closercontrol sends that SMS via its Twilio account.
5. Seller replies. Closercontrol POSTs again with the now 3-message thread.
6. Dealcore extracts `askingPrice: 70000`, generates the next reply,
   returns `signals.missingFields: ["timeline", "conditionLevel", "ownershipStatus"]`.
7. Loop until `signals.campComplete: true`. Closercontrol then hands the
   lead to a human (or its own pipeline logic) to take over the deal-math
   conversation.
