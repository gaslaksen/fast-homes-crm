import { Module } from '@nestjs/common';
import { ForeclosuresController } from './foreclosures.controller';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureImportService } from './foreclosure-import.service';
import { ForeclosureIngestService } from './foreclosure-ingest.service';
import { ForeclosureSkiptraceService } from './foreclosure-skiptrace.service';
import { ForeclosureExtractService } from './foreclosure-extract.service';
import { ForeclosurePollService } from './foreclosure-poll.service';

@Module({
  controllers: [ForeclosuresController],
  providers: [
    ForeclosuresService,
    ForeclosureImportService,
    ForeclosureIngestService,
    ForeclosureSkiptraceService,
    ForeclosureExtractService,
    ForeclosurePollService,
  ],
  exports: [ForeclosuresService, ForeclosureIngestService],
})
export class ForeclosuresModule {}
