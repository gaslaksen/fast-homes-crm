import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagesModule } from '../messages/messages.module';
import { LeadsModule } from '../leads/leads.module';
import { GmailModule } from '../gmail/gmail.module';
import { CampaignsService } from './campaigns.service';
import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { CampaignAiService } from './campaign-ai.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => MessagesModule),
    forwardRef(() => LeadsModule),
    forwardRef(() => GmailModule),
  ],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    CampaignEnrollmentService,
    CampaignExecutionService,
    CampaignAiService,
  ],
  exports: [CampaignEnrollmentService],
})
export class CampaignsModule {}
