import { Module } from '@nestjs/common';
import { DealSearchController } from './deal-search.controller';
import { DealSearchService } from './deal-search.service';
import { CompsModule } from '../comps/comps.module';

@Module({
  imports: [CompsModule],
  controllers: [DealSearchController],
  providers: [DealSearchService],
  exports: [DealSearchService],
})
export class DealSearchModule {}
