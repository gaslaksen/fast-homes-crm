import { Module } from '@nestjs/common';
import { CompsController } from './comps.controller';
import { CompsService } from './comps.service';
import { AttomService } from './attom.service';
import { ReapiService } from './reapi.service';
import { CompAnalysisController } from './comp-analysis.controller';
import { CompAnalysisService } from './comp-analysis.service';

@Module({
  controllers: [CompsController, CompAnalysisController],
  providers: [CompsService, AttomService, ReapiService, CompAnalysisService],
  exports: [CompsService, AttomService, ReapiService, CompAnalysisService],
})
export class CompsModule {}
