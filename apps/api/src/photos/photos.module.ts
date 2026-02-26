import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { StreetViewService } from './street-view.service';
import { SerpApiService } from './serpapi.service';
import { RedfinService } from './redfin.service';
import { ZillowService } from './zillow.service';

@Module({
  controllers: [PhotosController],
  providers: [PhotosService, StreetViewService, SerpApiService, RedfinService, ZillowService],
  exports: [PhotosService, StreetViewService, SerpApiService, RedfinService, ZillowService],
})
export class PhotosModule {}
