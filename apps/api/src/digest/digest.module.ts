import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../mailer/mailer.module';
import { SurplusModule } from '../surplus/surplus.module';
import { DigestService } from './digest.service';
import { DigestNewsService } from './digest-news.service';
import { DigestRenderService } from './digest-render.service';
import { DigestController } from './digest.controller';
import { DigestCronService } from './digest-cron.service';

@Module({
  // SurplusModule for the board's own ranking and the county poll records, so
  // the brief lists the same claimants the board would and reports the feeds.
  imports: [PrismaModule, MailerModule, SurplusModule],
  controllers: [DigestController],
  providers: [DigestService, DigestRenderService, DigestNewsService, DigestCronService],
  exports: [DigestService, DigestRenderService],
})
export class DigestModule {}
