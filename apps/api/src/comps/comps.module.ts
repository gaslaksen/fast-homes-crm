import { Module, forwardRef } from '@nestjs/common';
import { CompsController } from './comps.controller';
import { CompsService } from './comps.service';
import { AttomService } from './attom.service';
import { ReapiService } from './reapi.service';
import { BatchDataService } from './batchdata.service';
import { BatchDataCompService } from './batchdata-comp.service';
import { BatchCompareController } from './batch-compare.controller';
import { CompAnalysisController } from './comp-analysis.controller';
import { CompAnalysisService } from './comp-analysis.service';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [forwardRef(() => LeadsModule)],
  controllers: [CompsController, CompAnalysisController, BatchCompareController],
  providers: [CompsService, AttomService, ReapiService, BatchDataService, BatchDataCompService, CompAnalysisService],
  exports: [CompsService, AttomService, ReapiService, BatchDataService, BatchDataCompService, CompAnalysisService],
})
export class CompsModule {}
