import { Module } from '@nestjs/common';
import { SurplusController } from './surplus.controller';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusPollService } from './surplus-poll.service';
import { CitrusTaxSmartAdapter, DuvalTaxDeedAdapter, HernandoTaxSmartAdapter } from './pioneer-taxsmart.adapter';
import { CharlotteTaxDeedAdapter } from './charlotte-taxdeed.adapter';
import {
  AlachuaRealTdmAdapter,
  BrevardRealTdmAdapter,
  FlaglerRealTdmAdapter,
  LakeRealTdmAdapter,
  LeeRealTdmAdapter,
  PinellasRealTdmAdapter,
  PolkRealTdmAdapter,
  SantaRosaRealTdmAdapter,
  SarasotaRealTdmAdapter,
} from './realtdm.adapter';
import { SurplusSkiptraceService } from './surplus-skiptrace.service';
import { SurplusNoticeService } from './surplus-notice.service';
import { SurplusEndatoService } from './surplus-endato.service';
import { SurplusProbateService } from './surplus-probate.service';
import { SurplusObituaryService } from './surplus-obituary.service';
import { SurplusSocialService } from './surplus-social.service';
import { SurplusHeirsService } from './surplus-heirs.service';
import { SurplusTemplatesService } from './surplus-templates.service';
import { SurplusCredibilityService } from './surplus-credibility.service';
import { SurplusCountiesService } from './surplus-counties.service';
import { SurplusDocumentsService } from './surplus-documents.service';
import { SurplusCadenceService } from './surplus-cadence.service';
import { SurplusIdiService } from './surplus-idi.service';
import { SurplusOutreachService } from './surplus-outreach.service';
import { StorageModule } from '../storage/storage.module';
import { MessagesModule } from '../messages/messages.module';
import { SurplusProgressModule } from './surplus-progress.module';

@Module({
  // MessagesModule for the credibility packet, which goes out over the same
  // SMS and email paths as a hand-typed message so it lands on the timeline
  // and sends as Dig Deeper.
  imports: [MessagesModule, StorageModule, SurplusProgressModule],
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
    BrevardRealTdmAdapter,
    PinellasRealTdmAdapter,
    SarasotaRealTdmAdapter,
    LakeRealTdmAdapter,
    AlachuaRealTdmAdapter,
    SantaRosaRealTdmAdapter,
    FlaglerRealTdmAdapter,
    CitrusTaxSmartAdapter,
    HernandoTaxSmartAdapter,
    CharlotteTaxDeedAdapter,
    SurplusEndatoService,
    SurplusSkiptraceService,
    SurplusNoticeService,
    SurplusProbateService,
    SurplusObituaryService,
    SurplusSocialService,
    SurplusHeirsService,
    SurplusIdiService,
    SurplusOutreachService,
  ],
  exports: [
    SurplusService,
    SurplusImportService,
    SurplusIngestService,
    SurplusSkiptraceService,
    SurplusHeirsService,
    // The Daily Brief's touches-due line reads the same list the outreach page shows.
    SurplusOutreachService,
  ],
})
export class SurplusModule {}
