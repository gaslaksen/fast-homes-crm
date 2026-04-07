import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsModule } from '../leads/leads.module';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => LeadsModule)],
  controllers: [GmailController, EmailUnsubscribeController],
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}
