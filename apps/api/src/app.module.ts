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
  ],
})
export class AppModule {}
