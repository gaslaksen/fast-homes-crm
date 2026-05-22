import { Module, forwardRef } from '@nestjs/common';
import { PropertyLookupsController } from './property-lookups.controller';
import { PropertyLookupsService } from './property-lookups.service';
import { CompsModule } from '../comps/comps.module';

@Module({
  imports: [forwardRef(() => CompsModule)],
  controllers: [PropertyLookupsController],
  providers: [PropertyLookupsService],
  exports: [PropertyLookupsService],
})
export class PropertyLookupsModule {}
