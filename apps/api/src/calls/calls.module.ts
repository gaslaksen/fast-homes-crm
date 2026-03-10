import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { VapiModule } from '../vapi/vapi.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [VapiModule, ScoringModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
