import { Module } from '@nestjs/common';
import { PhoneNumbersService } from './phone-numbers.service';
import { PhoneNumberSeedService } from './phone-number-seed.service';

/**
 * Shared by CallsModule (dialer caller ID) and MessagesModule (SMS from), so
 * both channels read one list and one set of rules.
 */
@Module({
  providers: [PhoneNumbersService, PhoneNumberSeedService],
  exports: [PhoneNumbersService],
})
export class PhoneNumbersModule {}
