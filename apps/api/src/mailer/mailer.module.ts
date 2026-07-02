import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';

@Module({
  controllers: [EmailUnsubscribeController],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
