import { Module, forwardRef } from '@nestjs/common';
import { LeadsController, TasksController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ScoringModule } from '../scoring/scoring.module';
import { MessagesModule } from '../messages/messages.module';
import { PhotosModule } from '../photos/photos.module';
import { CompsModule } from '../comps/comps.module';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [ScoringModule, forwardRef(() => MessagesModule), PhotosModule, CompsModule, PipelineModule],
  controllers: [LeadsController, TasksController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
