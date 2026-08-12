import { Module } from '@nestjs/common';
import { PhoneNumbersService } from './phone-numbers.service';
import { PhoneNumberSeedService } from './phone-number-seed.service';
import { LeadPhonesService } from './lead-phones.service';

/**
 * Shared by CallsModule (dialer caller ID) and MessagesModule (SMS from), so
 * both channels read one list and one set of rules. LeadPhonesService is the
 * mirror image: the numbers a given seller can be reached on.
 */
@Module({
  providers: [PhoneNumbersService, PhoneNumberSeedService, LeadPhonesService],
  exports: [PhoneNumbersService, LeadPhonesService],
})
export class PhoneNumbersModule {}
