import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ComplianceService } from './compliance.service';
import { ScoringModule } from '../scoring/scoring.module';
import { DripModule } from '../drip/drip.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { LeadsModule } from '../leads/leads.module';
import { MailerModule } from '../mailer/mailer.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [ScoringModule, forwardRef(() => DripModule), forwardRef(() => CampaignsModule), forwardRef(() => LeadsModule), MailerModule, PushModule],
  controllers: [MessagesController],
  providers: [MessagesService, ComplianceService],
  exports: [MessagesService, ComplianceService],
})
export class MessagesModule {}
