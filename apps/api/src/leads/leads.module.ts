import { Module, forwardRef } from '@nestjs/common';
import { LeadsController, TasksController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadImportService } from './lead-import.service';
import { ScoringModule } from '../scoring/scoring.module';
import { MessagesModule } from '../messages/messages.module';
import { PhotosModule } from '../photos/photos.module';
import { CompsModule } from '../comps/comps.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DripModule } from '../drip/drip.module';

@Module({
  imports: [ScoringModule, forwardRef(() => MessagesModule), PhotosModule, CompsModule, PipelineModule, forwardRef(() => DripModule)],
  controllers: [LeadsController, TasksController],
  providers: [LeadsService, LeadImportService],
  exports: [LeadsService],
})
export class LeadsModule {}
