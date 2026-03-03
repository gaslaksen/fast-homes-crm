import { Module } from '@nestjs/common';
import { VapiService } from './vapi.service';

@Module({
  providers: [VapiService],
  exports: [VapiService],
})
export class VapiModule {}
