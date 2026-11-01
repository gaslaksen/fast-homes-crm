import { Module } from '@nestjs/common';
import { SurplusProgressService } from './surplus-progress.service';

/**
 * Deliberately tiny, like TouchModule: the dialer, the inbox and the pull all
 * move a surplus case along, and none of them can import SurplusModule
 * without closing a cycle (SurplusModule imports MessagesModule).
 */
@Module({
  providers: [SurplusProgressService],
  exports: [SurplusProgressService],
})
export class SurplusProgressModule {}
