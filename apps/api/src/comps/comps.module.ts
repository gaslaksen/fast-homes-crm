import { Module } from '@nestjs/common';
import { CompsController } from './comps.controller';
import { CompsService } from './comps.service';
import { RentCastService } from './rentcast.service';
import { CompAnalysisController } from './comp-analysis.controller';
import { CompAnalysisService } from './comp-analysis.service';

@Module({
  controllers: [CompsController, CompAnalysisController],
  providers: [CompsService, RentCastService, CompAnalysisService],
  exports: [CompsService, RentCastService, CompAnalysisService],
})
export class CompsModule {}
