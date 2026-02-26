import { Module, forwardRef } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { DripModule } from '../drip/drip.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [forwardRef(() => DripModule), ScoringModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
