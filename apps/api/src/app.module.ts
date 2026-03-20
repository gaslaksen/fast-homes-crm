import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { LeadsModule } from './leads/leads.module';
import { MessagesModule } from './messages/messages.module';
import { CompsModule } from './comps/comps.module';
import { ScoringModule } from './scoring/scoring.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DripModule } from './drip/drip.module';
import { SettingsModule } from './settings/settings.module';
import { PhotosModule } from './photos/photos.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { VapiModule } from './vapi/vapi.module';
import { CallsModule } from './calls/calls.module';
import { GmailModule } from './gmail/gmail.module';
import { BoldSignModule } from './boldsign/boldsign.module';
import { CampaignsModule } from './campaigns/campaigns.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    LeadsModule,
    MessagesModule,
    CompsModule,
    ScoringModule,
    WebhooksModule,
    DashboardModule,
    DripModule,
    SettingsModule,
    PhotosModule,
    PipelineModule,
    VapiModule,
    CallsModule,
    GmailModule,
    BoldSignModule,
    CampaignsModule,
  ],
})
export class AppModule {}
