import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { SlackLeadService } from './slack-lead.service';
import { InvestorFuseService } from './investorfuse.service';
import { LeadsModule } from '../leads/leads.module';
import { MessagesModule } from '../messages/messages.module';
import { DripModule } from '../drip/drip.module';
import { CompsModule } from '../comps/comps.module';

@Module({
  imports: [LeadsModule, MessagesModule, DripModule, CompsModule],
  controllers: [WebhooksController],
  providers: [SlackLeadService, InvestorFuseService],  // SlackLeadService kept for /webhooks/slack-lead endpoint
})
export class WebhooksModule {}
