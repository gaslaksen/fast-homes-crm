import { Module } from '@nestjs/common';
import { LeadsController, TasksController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [ScoringModule],
  controllers: [LeadsController, TasksController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
