import { Module, forwardRef } from '@nestjs/common';
import { LeadsController, TasksController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadImportService } from './lead-import.service';
import { AiInsightService } from './ai-insight.service';
import { ScoringModule } from '../scoring/scoring.module';
import { MessagesModule } from '../messages/messages.module';
import { PhotosModule } from '../photos/photos.module';
import { CompsModule } from '../comps/comps.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DripModule } from '../drip/drip.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SellerPortalModule } from '../seller-portal/seller-portal.module';

@Module({
  imports: [ScoringModule, forwardRef(() => MessagesModule), PhotosModule, CompsModule, PipelineModule, forwardRef(() => DripModule), forwardRef(() => CampaignsModule), SellerPortalModule],
  controllers: [LeadsController, TasksController],
  providers: [LeadsService, LeadImportService, AiInsightService],
  exports: [LeadsService, AiInsightService],
})
export class LeadsModule {}
