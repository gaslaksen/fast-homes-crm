import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../mailer/mailer.module';
import { DigestService } from './digest.service';
import { DigestNewsService } from './digest-news.service';
import { DigestRenderService } from './digest-render.service';
import { DigestController } from './digest.controller';

@Module({
  imports: [PrismaModule, MailerModule],
  controllers: [DigestController],
  providers: [DigestService, DigestRenderService, DigestNewsService],
  exports: [DigestService, DigestRenderService],
})
export class DigestModule {}
