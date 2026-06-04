import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { ExternalConversationsController } from './external-conversations.controller';
import { ExternalConversationsService } from './external-conversations.service';
import { ExternalApiKeyGuard } from './external-api-key.guard';
import { GhlClient } from './ghl.client';
import { GhlWebhookGuard } from './ghl-webhook.guard';
import { GhlWebhookController } from './ghl-webhook.controller';

/**
 * Isolated module for external-partner (e.g. Closercontrol) integration.
 *
 * Intentionally does NOT import LeadsModule, MessagesModule, DripModule, or
 * CampaignsModule. The whole point of this module is that Dealcore's lead
 * automation never touches partner conversations - the partner owns sending,
 * scheduling, opt-outs, pipeline state, and everything else. Dealcore only
 * generates the next message and extracts CAMP data.
 *
 * Two entry points:
 *   - POST /external/conversations/draft-reply (Bearer token) - generic
 *     partner-supplied-history path. Useful for testing and partners that
 *     manage conversation state themselves.
 *   - POST /external/ghl/webhook (X-Dealcore-Webhook-Secret) - GHL webhook
 *     receiver. Pulls history + contact from GHL, generates a reply, and
 *     sends it back via the GHL Conversations API.
 */
@Module({
  imports: [ScoringModule],
  controllers: [ExternalConversationsController, GhlWebhookController],
  providers: [
    ExternalConversationsService,
    ExternalApiKeyGuard,
    GhlClient,
    GhlWebhookGuard,
  ],
})
export class ExternalConversationsModule {}
