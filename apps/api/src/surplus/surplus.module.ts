import { Module } from '@nestjs/common';
import { SurplusController } from './surplus.controller';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusPollService } from './surplus-poll.service';
import { DuvalTaxDeedAdapter } from './duval-taxdeed.adapter';

@Module({
  controllers: [SurplusController],
  providers: [
    SurplusService,
    SurplusImportService,
    SurplusIngestService,
    SurplusPollService,
    DuvalTaxDeedAdapter,
  ],
  exports: [SurplusService, SurplusImportService, SurplusIngestService],
})
export class SurplusModule {}
