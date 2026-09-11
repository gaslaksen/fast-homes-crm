import { Module } from '@nestjs/common';
import { SurplusController } from './surplus.controller';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusPollService } from './surplus-poll.service';
import { DuvalTaxDeedAdapter } from './duval-taxdeed.adapter';
import { LeeRealTdmAdapter, PolkRealTdmAdapter } from './realtdm.adapter';
import { SurplusSkiptraceService } from './surplus-skiptrace.service';
import { SurplusNoticeService } from './surplus-notice.service';
import { SurplusProbateService } from './surplus-probate.service';
import { SurplusHeirsService } from './surplus-heirs.service';
import { SurplusTemplatesService } from './surplus-templates.service';
import { SurplusCredibilityService } from './surplus-credibility.service';
import { SurplusCountiesService } from './surplus-counties.service';
import { SurplusDocumentsService } from './surplus-documents.service';
import { SurplusCadenceService } from './surplus-cadence.service';
import { StorageModule } from '../storage/storage.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  // MessagesModule for the credibility packet, which goes out over the same
  // SMS and email paths as a hand-typed message so it lands on the timeline
  // and sends as Dig Deeper.
  imports: [MessagesModule, StorageModule],
  controllers: [SurplusController],
  providers: [
    SurplusService,
    SurplusTemplatesService,
    SurplusCredibilityService,
    SurplusCountiesService,
    SurplusDocumentsService,
    SurplusCadenceService,
    SurplusImportService,
    SurplusIngestService,
    SurplusPollService,
    DuvalTaxDeedAdapter,
    LeeRealTdmAdapter,
    PolkRealTdmAdapter,
    SurplusSkiptraceService,
    SurplusNoticeService,
    SurplusProbateService,
    SurplusHeirsService,
  ],
  exports: [
    SurplusService,
    SurplusImportService,
    SurplusIngestService,
    SurplusSkiptraceService,
    SurplusHeirsService,
  ],
})
export class SurplusModule {}
