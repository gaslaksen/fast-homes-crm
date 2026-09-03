import { Module } from '@nestjs/common';
import { SurplusController } from './surplus.controller';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusPollService } from './surplus-poll.service';
import { DuvalTaxDeedAdapter } from './duval-taxdeed.adapter';
import { LeeRealTdmAdapter } from './realtdm.adapter';
import { SurplusSkiptraceService } from './surplus-skiptrace.service';
import { SurplusNoticeService } from './surplus-notice.service';

@Module({
  controllers: [SurplusController],
  providers: [
    SurplusService,
    SurplusImportService,
    SurplusIngestService,
    SurplusPollService,
    DuvalTaxDeedAdapter,
    LeeRealTdmAdapter,
    SurplusSkiptraceService,
    SurplusNoticeService,
  ],
  exports: [SurplusService, SurplusImportService, SurplusIngestService, SurplusSkiptraceService],
})
export class SurplusModule {}
