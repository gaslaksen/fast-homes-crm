import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MailerModule } from '../mailer/mailer.module';
import { RemindersService } from './reminders.service';

@Module({
  imports: [ScheduleModule.forRoot(), MailerModule],
  providers: [RemindersService],
})
export class RemindersModule {}
