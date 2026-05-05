import { Module } from '@nestjs/common';
import { CompsModule } from '../comps/comps.module';
import { AiCompCurationController } from './ai-comp-curation.controller';
import { AiCompCurationService } from './ai-comp-curation.service';

@Module({
  imports: [CompsModule],
  controllers: [AiCompCurationController],
  providers: [AiCompCurationService],
  exports: [AiCompCurationService],
})
export class AiCompCurationModule {}
