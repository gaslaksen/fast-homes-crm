import { Module, forwardRef } from '@nestjs/common';
import { DripService } from './drip.service';
import { DripProcessor } from './drip.processor';
import { MessagesModule } from '../messages/messages.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [forwardRef(() => MessagesModule), ScoringModule],
  providers: [DripService, DripProcessor],
  exports: [DripService],
})
export class DripModule {}
