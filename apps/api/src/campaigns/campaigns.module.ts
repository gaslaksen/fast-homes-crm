import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagesModule } from '../messages/messages.module';
import { CampaignsService } from './campaigns.service';
import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { CampaignAiService } from './campaign-ai.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    forwardRef(() => MessagesModule),
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
