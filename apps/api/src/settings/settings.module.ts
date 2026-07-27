import { Module, forwardRef } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { PromptSeedService } from './prompt-seed.service';
import { DripModule } from '../drip/drip.module';
import { ScoringModule } from '../scoring/scoring.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [forwardRef(() => DripModule), ScoringModule, forwardRef(() => MessagesModule)],
  controllers: [SettingsController],
  providers: [PromptSeedService],
})
export class SettingsModule {}
