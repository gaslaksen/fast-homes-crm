import { Module } from '@nestjs/common';
import { TouchModule } from '../leads/touch.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { TwilioVoiceService } from './twilio-voice.service';
import { VapiModule } from '../vapi/vapi.module';
import { ScoringModule } from '../scoring/scoring.module';
import { PhoneNumbersModule } from '../phone-numbers/phone-numbers.module';
import { PushModule } from '../push/push.module';
import { MailerModule } from '../mailer/mailer.module';
import { VoicemailService } from './voicemail.service';
import { SurplusProgressModule } from '../surplus/surplus-progress.module';

@Module({
  imports: [VapiModule, ScoringModule, PhoneNumbersModule, TouchModule, PushModule, MailerModule, SurplusProgressModule],
  controllers: [CallsController],
  providers: [CallsService, TwilioVoiceService, VoicemailService],
  exports: [CallsService],
})
export class CallsModule {}
