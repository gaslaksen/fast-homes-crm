import { Module } from '@nestjs/common';
import { SurplusProgressService } from './surplus-progress.service';
import { SurplusNumbersService } from './surplus-numbers.service';

/**
 * Deliberately tiny, like TouchModule: the dialer, the inbox and the pull all
 * move a surplus case along, and none of them can import SurplusModule
 * without closing a cycle (SurplusModule imports MessagesModule).
 */
@Module({
  providers: [SurplusProgressService, SurplusNumbersService],
  exports: [SurplusProgressService, SurplusNumbersService],
})
export class SurplusProgressModule {}
