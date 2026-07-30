import { Module } from '@nestjs/common';
import { ForeclosuresController } from './foreclosures.controller';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureImportService } from './foreclosure-import.service';
import { ForeclosureIngestService } from './foreclosure-ingest.service';
import { ForeclosureSkiptraceService } from './foreclosure-skiptrace.service';
import { ForeclosureExtractService } from './foreclosure-extract.service';
import { ForeclosureDocumentService } from './foreclosure-document.service';
import { ForeclosureFilingService } from './foreclosure-filing.service';
import { ForeclosureRulesService } from './foreclosure-rules.service';
import { ForeclosureSignalsService } from './foreclosure-signals.service';
import { ForeclosurePollService } from './foreclosure-poll.service';

@Module({
  controllers: [ForeclosuresController],
  providers: [
    ForeclosuresService,
    ForeclosureImportService,
    ForeclosureIngestService,
    ForeclosureSkiptraceService,
    ForeclosureExtractService,
    ForeclosureDocumentService,
    ForeclosureFilingService,
    ForeclosureRulesService,
    ForeclosureSignalsService,
    ForeclosurePollService,
  ],
  exports: [ForeclosuresService, ForeclosureIngestService],
})
export class ForeclosuresModule {}
