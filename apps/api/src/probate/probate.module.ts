import { Module } from '@nestjs/common';
import { ProbateController } from './probate.controller';
import { ProbateService } from './probate.service';
import { ProbateImportService } from './probate-import.service';

@Module({
  controllers: [ProbateController],
  providers: [ProbateService, ProbateImportService],
  exports: [ProbateService, ProbateImportService],
})
export class ProbateModule {}
