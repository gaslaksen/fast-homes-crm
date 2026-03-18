import { Module } from '@nestjs/common';
import { BoldSignService } from './boldsign.service';
import {
  BoldSignController,
  BoldSignGlobalController,
} from './boldsign.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BoldSignController, BoldSignGlobalController],
  providers: [BoldSignService],
  exports: [BoldSignService],
})
export class BoldSignModule {}
