import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ScoringModule } from '../scoring/scoring.module';
import { DripModule } from '../drip/drip.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [ScoringModule, forwardRef(() => DripModule), forwardRef(() => CampaignsModule), forwardRef(() => LeadsModule)],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
