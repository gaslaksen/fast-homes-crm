import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../mailer/mailer.module';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { DealPackageService } from './deal-package.service';
import { DealShareService } from './deal-share.service';

@Module({
  imports: [PrismaModule, MailerModule],
  controllers: [PartnersController],
  providers: [PartnersService, DealPackageService, DealShareService],
  exports: [PartnersService, DealShareService],
})
export class PartnersModule {}
