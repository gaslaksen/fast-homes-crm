import { Module } from '@nestjs/common';
import { AiArvCalculationController } from './ai-arv-calculation.controller';
import { AiArvCalculationService } from './ai-arv-calculation.service';
import { ArvValidationController } from './validation/arv-validation.controller';
import { ArvValidationService } from './validation/arv-validation.service';

@Module({
  controllers: [AiArvCalculationController, ArvValidationController],
  providers: [AiArvCalculationService, ArvValidationService],
  exports: [AiArvCalculationService],
})
export class AiArvCalculationModule {}
