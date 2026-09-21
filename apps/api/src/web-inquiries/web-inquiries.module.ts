import { Module } from '@nestjs/common';
import { MailerModule } from '../mailer/mailer.module';
import { WebInquiriesController } from './web-inquiries.controller';
import { WebInquiriesService } from './web-inquiries.service';

@Module({
  imports: [MailerModule],
  controllers: [WebInquiriesController],
  providers: [WebInquiriesService],
})
export class WebInquiriesModule {}
