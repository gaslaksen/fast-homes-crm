import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ScoringModule } from '../scoring/scoring.module';
import { DripModule } from '../drip/drip.module';

@Module({
  imports: [ScoringModule, forwardRef(() => DripModule)],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
