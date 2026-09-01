import { Global, Module } from '@nestjs/common';
import { CronLockService } from './cron-lock.service';

/**
 * Global so any scheduled job can take the lock without each module wiring it
 * up, which is how four of the five crons ended up with no cross-replica guard
 * at all.
 */
@Global()
@Module({
  providers: [CronLockService],
  exports: [CronLockService],
})
export class CronLockModule {}
