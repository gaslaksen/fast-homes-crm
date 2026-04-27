import { Module } from '@nestjs/common';
import { DispositionController } from './disposition.controller';
import { DispositionService } from './disposition.service';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [LeadsModule],
  controllers: [DispositionController],
  providers: [DispositionService],
  exports: [DispositionService],
})
export class DispositionModule {}
