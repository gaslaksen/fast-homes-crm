import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { GhlWebhookGuard } from './ghl-webhook.guard';
import { GhlClient, GhlMessage } from './ghl.client';
import { ExternalConversationsService } from './external-conversations.service';

// The partner key used to scope external_conversations rows for all GHL
// (Closercontrol) traffic. We're a single-partner integration today.
const GHL_PARTNER_KEY = 'closercontrol';

// Tag we add to the GHL contact when CAMP qualification completes, so
// Closercontrol's workflow can trigger handoff to a human.
const QUALIFIED_TAG = 'dealcore:qualified';

// Debounce window for replying after an inbound. Sellers often send their
// thought across multiple texts in quick succession ("around 70k" → "no rush"
// → "place is rough"). Waiting 2 minutes after the LAST inbound before
// replying lets us see the full thought and respond once with full context.
// Every new inbound during this window cancels the pending reply and restarts
// the clock. Mirrors the Dealcore-native pendingResponseTimers pattern.
const REPLY_DEBOUNCE_MS = 120_000; // 2 minutes

/**
 * Webhook receiver for GoHighLevel message events.
 *
 * Flow on every inbound SMS:
 *   1. GHL fires a webhook to /external/ghl/webhook
 *   2. We validate the shared-secret header (GhlWebhookGuard)
 *   3. We return 200 immediately and process the rest fire-and-forget
 *   4. Filter to direction=inbound only (ignore outbound, including our own
 *      replies coming back to us as webhook events)
 *   5. Fetch the recent conversation history from GHL
 *   6. Fetch the contact from GHL (for sellerFirstName, sellerPhone)
 *   7. Call ExternalConversationsService.draftReply() — same persona,
 *      same extraction, same scoring as the partner-supplied path
 *   8. POST the generated reply back to GHL via Conversations API
 *
 * Errors anywhere in steps 4-8 are logged and swallowed. We never throw
 * after returning 200 - GHL retries are not useful here, the next seller
 * reply will trigger us again.
 */
@Controller('external/ghl')
@UseGuards(GhlWebhookGuard)
export class GhlWebhookController {
  private readonly logger = new Logger(GhlWebhookController.name);

  // Map of conversationId → pending setTimeout handle. When a new inbound
  // arrives for a conversation that already has a pending reply, we cancel
  // the existing timer and schedule a fresh 2-minute one. Only the LAST
  // inbound in a burst triggers the actual reply, and the AI sees all the
  // seller's messages because we fetch fresh history at fire time.
  //
  // In-memory only — timers do NOT survive a service restart. Acceptable
  // for v1: a Railway redeploy mid-window means the seller gets no AI
  // reply for that turn. Their next message will trigger fresh.
  private pendingReplies = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private ghl: GhlClient,
    private conversations: ExternalConversationsService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() raw: any): Promise<{ ok: true }> {
    // Process asynchronously so GHL gets a fast 200 even though our work
    // takes 5-10s (two Claude calls + GHL round-trips).
    setImmediate(() => {
      this.handle(raw).catch((err) =>
        this.logger.error(`GHL webhook handler failed: ${err?.message || err}`),
      );
    });
    return { ok: true };
  }

  private async handle(raw: any): Promise<void> {
    const event = this.extractEventBody(raw);
    if (!event) {
      this.logger.warn(`GHL webhook: could not parse event body, ignoring. Payload: ${this.snippet(raw)}`);
      return;
    }

    // ── Human-takeover detection on outbound webhooks ─────────────────────
    // Outbound messages SENT BY A USER in Closercontrol's UI carry a `userId`
    // field. Our API-sent messages (authenticated via the Private Integration
    // token) do NOT have userId. So if we see an outbound with userId set,
    // a human stepped in - mark the conversation as human-taken-over and
    // cancel any pending AI reply timer.
    if (event.direction === 'outbound' && event.userId && event.conversationId) {
      try {
        const newlyMarked = await this.conversations.markHumanTakeover(
          GHL_PARTNER_KEY,
          event.conversationId,
          event.userId,
        );
        if (newlyMarked) {
          const pending = this.pendingReplies.get(event.conversationId);
          if (pending) {
            clearTimeout(pending);
            this.pendingReplies.delete(event.conversationId);
            this.logger.log(`🤚 Human took over conv=${event.conversationId} - cancelled pending AI reply`);
          } else {
            this.logger.log(`🤚 Human took over conv=${event.conversationId}`);
          }
        }
        // Already-marked repeats (status updates on the same human message)
        // are silently swallowed - no log spam.
      } catch (err: any) {
        this.logger.error(`Failed to record human takeover for conv=${event.conversationId}: ${err?.message || err}`);
      }
      return;
    }

    // ── Filter to inbound only ─────────────────────────────────────────────
    // We only act when the seller texts us. Outbound events (including the
    // reply we ourselves generated and sent, which GHL will fire back at us
    // as another webhook) get ignored. Without this filter we'd loop.
    if (event.direction !== 'inbound') {
      // Outbound echoes of our own messages are the common case - quiet debug.
      // Anything else (no direction, unknown direction, unexpected event type)
      // gets the full raw payload so we can see what GHL is sending us.
      if (event.direction === 'outbound') {
        this.logger.debug(`GHL webhook: ignoring outbound echo (no userId) type=${event.type || '?'}`);
      } else {
        this.logger.warn(`GHL webhook: ignoring unexpected direction=${event.direction} type=${event.type || event.eventType || '?'}. Payload: ${this.snippet(raw)}`);
      }
      return;
    }

    // Only SMS for now. Email, voicemail, etc. are out of scope.
    const msgType = (event.messageType || event.messageTypeString || '').toString().toUpperCase();
    if (msgType && !msgType.includes('SMS')) {
      this.logger.debug(`GHL webhook: ignoring messageType=${msgType}`);
      return;
    }

    const conversationId = event.conversationId;
    const contactId = event.contactId;
    const locationId = event.locationId;
    if (!conversationId || !contactId) {
      const eventKeys = event && typeof event === 'object' ? Object.keys(event).slice(0, 30).join(',') : '<not-object>';
      this.logger.warn(`GHL webhook: inbound missing conversationId or contactId. Keys: ${eventKeys}. Payload: ${this.snippet(raw)}`);
      return;
    }

    // ── Skip if a human at the partner has taken over this conversation ───
    // Once Closercontrol's staff sends a manual message in their UI, we mark
    // the conversation as human-taken-over and never auto-respond again.
    try {
      if (await this.conversations.isHumanTakeover(GHL_PARTNER_KEY, conversationId)) {
        this.logger.log(`🤚 Skipping inbound for conv=${conversationId} - human is handling this conversation`);
        return;
      }
    } catch (err: any) {
      // If the takeover check fails, default to NOT replying — safer to miss
      // a reply than to AI-text someone the team is talking to.
      this.logger.error(`Takeover check failed for conv=${conversationId}: ${err?.message || err} - skipping reply to be safe`);
      return;
    }

    // ── Debounce: schedule the reply for 2 minutes from now ──────────────
    // If another inbound arrives for this conversation before the timer
    // fires, we cancel and restart. Lets us batch multi-text bursts from
    // the seller into a single coherent reply.
    const existing = this.pendingReplies.get(conversationId);
    if (existing) {
      clearTimeout(existing);
      this.logger.log(`⏱️  Cancelled pending reply for conv=${conversationId} - new inbound arrived, restarting 2min clock`);
    }

    this.logger.log(`📥 GHL inbound: conversation=${conversationId} contact=${contactId} - reply scheduled in ${Math.round(REPLY_DEBOUNCE_MS / 1000)}s`);

    const timer = setTimeout(() => {
      this.pendingReplies.delete(conversationId);
      this.generateAndSend(conversationId, contactId, locationId).catch((err) =>
        this.logger.error(`Deferred reply failed for conv=${conversationId}: ${err?.message || err}`),
      );
    }, REPLY_DEBOUNCE_MS);

    this.pendingReplies.set(conversationId, timer);
  }

  /**
   * Runs after the 2-minute debounce window expires. Fetches fresh history
   * from GHL (which now includes every inbound the seller sent during the
   * window) and dispatches the reply.
   */
  private async generateAndSend(
    conversationId: string,
    contactId: string,
    locationId?: string,
  ): Promise<void> {
    this.logger.log(`🕒 Debounce window expired for conv=${conversationId} - fetching history and generating reply`);

    // Race guard: a human may have taken over between when this timer was
    // scheduled and when it fired. Re-check before doing any work.
    try {
      if (await this.conversations.isHumanTakeover(GHL_PARTNER_KEY, conversationId)) {
        this.logger.log(`🤚 Skipping deferred reply for conv=${conversationId} - human took over during debounce window`);
        return;
      }
    } catch (err: any) {
      this.logger.error(`Takeover check failed for conv=${conversationId}: ${err?.message || err} - skipping reply to be safe`);
      return;
    }

    // ── Fetch conversation history + contact in parallel ──────────────────
    let messages: GhlMessage[];
    let contact: { firstName?: string; phone?: string };
    try {
      [messages, contact] = await Promise.all([
        this.ghl.getConversationMessages(conversationId, 30),
        this.ghl.getContact(contactId),
      ]);
    } catch (err: any) {
      this.logger.error(`GHL fetch failed for conv=${conversationId}: ${err?.message || err}`);
      return;
    }

    // ── Look-back takeover detection ──────────────────────────────────────
    // Catches conversations a human at the partner managed BEFORE our
    // realtime takeover detection deployed, or where the webhook for the
    // human's send was missed for any reason. If ANY outbound message in
    // the fetched history carries a userId, a human was involved at some
    // point - mark takeover and skip the AI reply.
    const humanSentOutbound = messages.find(
      (m) => m.direction === 'outbound' && typeof m.userId === 'string' && m.userId.length > 0,
    );
    if (humanSentOutbound) {
      try {
        const newlyMarked = await this.conversations.markHumanTakeover(
          GHL_PARTNER_KEY,
          conversationId,
          humanSentOutbound.userId!,
        );
        if (newlyMarked) {
          this.logger.log(`🤚 Look-back: human (user=${humanSentOutbound.userId}) was managing conv=${conversationId} - marking takeover, skipping AI reply`);
        } else {
          this.logger.log(`🤚 Skipping AI reply for conv=${conversationId} - human already on file`);
        }
      } catch (err: any) {
        this.logger.error(`Look-back takeover record failed for conv=${conversationId}: ${err?.message || err}`);
      }
      return;
    }

    const history = messages
      .filter((m) => typeof m.body === 'string' && m.body.trim().length > 0)
      .map((m) => ({
        direction: (m.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND') as 'INBOUND' | 'OUTBOUND',
        body: m.body!,
        sentAt: m.dateAdded,
      }));

    if (history.length === 0) {
      this.logger.warn(`No history found for conv=${conversationId} after debounce - ignoring`);
      return;
    }

    // ── Generate the AI response ──────────────────────────────────────────
    let result;
    try {
      result = await this.conversations.draftReply({
        partnerKey: GHL_PARTNER_KEY,
        externalId: conversationId,
        sellerFirstName: contact?.firstName,
        sellerPhone: contact?.phone,
        conversationHistory: history,
      });
    } catch (err: any) {
      this.logger.error(`draftReply failed for conv=${conversationId}: ${err?.message || err}`);
      return;
    }

    if (result.signals.optOutDetected) {
      this.logger.log(`🚫 Opt-out detected for conv=${conversationId} - not sending. Closercontrol should mark DNC.`);
      return;
    }

    if (!result.message) {
      this.logger.log(`No reply generated for conv=${conversationId}`);
      return;
    }

    // ── Send via GHL Conversations API ────────────────────────────────────
    try {
      await this.ghl.sendSms({
        contactId,
        conversationId,
        locationId,
        body: result.message,
      });
      this.logger.log(`📤 Sent reply to conv=${conversationId} (campComplete=${result.signals.campComplete}): "${result.message.slice(0, 80)}"`);
    } catch (err: any) {
      this.logger.error(`GHL sendSms failed for conv=${conversationId}: ${err?.message || err}`);
      return;  // don't tag if send failed — partner won't see the closing message
    }

    // ── Tag the contact as qualified once CAMP is complete ────────────────
    // Closercontrol's GHL workflow watches for this tag to trigger handoff.
    // The tag endpoint is idempotent so we don't track whether we've already
    // tagged — if CAMP stays complete across multiple turns, re-tagging is
    // a no-op on GHL's side.
    if (result.signals.campComplete) {
      try {
        await this.ghl.addContactTags(contactId, [QUALIFIED_TAG]);
        this.logger.log(`🏷️  Tagged contact=${contactId} with "${QUALIFIED_TAG}"`);
      } catch (err: any) {
        // Most likely cause: token missing contacts.write scope (403). Log
        // and continue — the reply already went out, the tag is a nice-to-have.
        this.logger.error(`GHL tag add failed for contact=${contactId}: ${err?.message || err}`);
      }
    }
  }

  /**
   * Serialize a raw value to a bounded JSON snippet for log lines. Used when
   * we hit a parse / shape error and want enough context to debug.
   */
  private snippet(value: any, max = 800): string {
    try {
      const s = JSON.stringify(value);
      return s.length > max ? s.slice(0, max) + '…(truncated)' : s;
    } catch {
      return '<unserializable>';
    }
  }

  /**
   * GHL may post the event in two shapes:
   *   (a) raw object: { conversationId, contactId, body, direction, ... }
   *   (b) n8n-wrapped array: [{ body: { ... }, headers, query, params }]
   * Handle both defensively.
   */
  private extractEventBody(raw: any): any | null {
    if (!raw) return null;
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (first?.body && typeof first.body === 'object') return first.body;
      return first ?? null;
    }
    // Some senders wrap the GHL payload in { body: {...} } too
    if (raw.body && typeof raw.body === 'object' && raw.body.conversationId) return raw.body;
    return raw;
  }
}
