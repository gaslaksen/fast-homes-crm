import { Module } from '@nestjs/common';
import { CompsController } from './comps.controller';
import { CompsService } from './comps.service';

@Module({
  controllers: [CompsController],
  providers: [CompsService],
  exports: [CompsService],
})
export class CompsModule {}
