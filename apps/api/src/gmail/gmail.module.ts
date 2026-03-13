import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GmailController],
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}
