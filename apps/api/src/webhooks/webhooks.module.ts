import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { LeadsModule } from '../leads/leads.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [LeadsModule, MessagesModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
