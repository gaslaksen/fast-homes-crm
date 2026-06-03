import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { ExternalConversationsController } from './external-conversations.controller';
import { ExternalConversationsService } from './external-conversations.service';
import { ExternalApiKeyGuard } from './external-api-key.guard';

/**
 * Isolated module for external-partner (e.g. Closercontrol) integration.
 *
 * Intentionally does NOT import LeadsModule, MessagesModule, DripModule, or
 * CampaignsModule. The whole point of this module is that Dealcore's lead
 * automation never touches partner conversations - the partner owns sending,
 * scheduling, opt-outs, pipeline state, and everything else. Dealcore only
 * generates the next message and extracts CAMP data.
 */
@Module({
  imports: [ScoringModule],
  controllers: [ExternalConversationsController],
  providers: [ExternalConversationsService, ExternalApiKeyGuard],
})
export class ExternalConversationsModule {}
