import { Module } from '@nestjs/common';
import { SellerPortalController } from './seller-portal.controller';
import { SellerPortalService } from './seller-portal.service';
import { PhotosModule } from '../photos/photos.module';

@Module({
  imports: [PhotosModule],
  controllers: [SellerPortalController],
  providers: [SellerPortalService],
  exports: [SellerPortalService],
})
export class SellerPortalModule {}
