import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { TwilioVoiceService } from './twilio-voice.service';
import { VapiModule } from '../vapi/vapi.module';
import { ScoringModule } from '../scoring/scoring.module';
import { PhoneNumbersModule } from '../phone-numbers/phone-numbers.module';

@Module({
  imports: [VapiModule, ScoringModule, PhoneNumbersModule],
  controllers: [CallsController],
  providers: [CallsService, TwilioVoiceService],
  exports: [CallsService],
})
export class CallsModule {}
