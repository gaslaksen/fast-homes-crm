import { Module } from '@nestjs/common';
import { SurplusController } from './surplus.controller';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';

@Module({
  controllers: [SurplusController],
  providers: [SurplusService, SurplusImportService],
  exports: [SurplusService, SurplusImportService],
})
export class SurplusModule {}
