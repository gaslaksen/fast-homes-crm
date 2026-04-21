import { Module } from '@nestjs/common';
import { MailerModule } from '../mailer/mailer.module';
import { RemindersService } from './reminders.service';

@Module({
  imports: [MailerModule],
  providers: [RemindersService],
})
export class RemindersModule {}
