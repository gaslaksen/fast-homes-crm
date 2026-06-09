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
    // TEMP: log a snippet of the raw payload on every webhook so we can see
    // what GHL is actually sending while we shake out the integration.
    // Remove once flow is stable to keep logs quiet.
    try {
      const rawSnippet = JSON.stringify(raw).slice(0, 800);
      this.logger.log(`🔬 GHL raw payload: ${rawSnippet}`);
    } catch {
      this.logger.log(`🔬 GHL raw payload: <unserializable>`);
    }

    const event = this.extractEventBody(raw);
    if (!event) {
      this.logger.warn(`GHL webhook: could not parse event body, ignoring`);
      return;
    }

    // Log the top-level keys so we can quickly see the event shape even if
    // direction/conversationId/contactId aren't where we expect them.
    const eventKeys = event && typeof event === 'object' ? Object.keys(event).slice(0, 30).join(',') : '<not-object>';
    this.logger.debug(`GHL webhook event keys: ${eventKeys}`);

    // ── Filter to inbound only ─────────────────────────────────────────────
    // We only act when the seller texts us. Outbound events (including the
    // reply we ourselves generated and sent, which GHL will fire back at us
    // as another webhook) get ignored. Without this filter we'd loop.
    if (event.direction !== 'inbound') {
      this.logger.debug(`GHL webhook: ignoring direction=${event.direction} type=${event.type || event.eventType || '?'}`);
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
      this.logger.warn(`GHL webhook: missing conversationId or contactId, ignoring. event keys: ${eventKeys}`);
      return;
    }

    this.logger.log(`📥 GHL inbound: conversation=${conversationId} contact=${contactId}`);

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

    // ── Build conversation history in our service's expected shape ────────
    // Note: GHL's most-recent event may not yet be returned by the messages
    // endpoint when the webhook fires (eventual consistency). If we don't
    // see the inbound body in the fetched history, append it manually so
    // the AI sees the seller's latest message.
    const history = messages
      .filter((m) => typeof m.body === 'string' && m.body.trim().length > 0)
      .map((m) => ({
        direction: (m.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND') as 'INBOUND' | 'OUTBOUND',
        body: m.body!,
        sentAt: m.dateAdded,
      }));

    const eventBody = (event.body || '').trim();
    const alreadyIncluded = eventBody && history.some(
      (h) => h.direction === 'INBOUND' && h.body.trim() === eventBody,
    );
    if (eventBody && !alreadyIncluded) {
      history.push({
        direction: 'INBOUND',
        body: eventBody,
        sentAt: event.dateAdded || event.timestamp,
      });
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
