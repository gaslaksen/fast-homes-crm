import {
  Controller,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PhotosService } from './photos.service';
import { StreetViewService } from './street-view.service';

const UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Only image files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
};

@Controller('leads')
export class PhotosController {
  constructor(
    private photosService: PhotosService,
    private streetViewService: StreetViewService,
  ) {}

  @Post(':id/photos/upload')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async uploadPhoto(
    @Param('id') leadId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    console.log(`📸 Upload received for lead ${leadId}: ${file.originalname} (${file.size} bytes)`);
    return this.photosService.processAndSave(leadId, file.buffer, 'upload');
  }

  @Post(':id/photos/upload-multiple')
  @UseInterceptors(FilesInterceptor('photos', 20, UPLOAD_OPTIONS))
  async uploadMultiplePhotos(
    @Param('id') leadId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('No files provided');
    console.log(`📸 Multi-upload received for lead ${leadId}: ${files.length} files`);

    const results = [];
    for (const file of files) {
      const photo = await this.photosService.processAndSave(leadId, file.buffer, 'upload');
      results.push(photo);
    }

    return { success: true, photoCount: results.length, photos: results };
  }

  @Post(':id/photos/streetview')
  async fetchStreetView(@Param('id') leadId: string) {
    console.log(`🌍 Street View fetch requested for lead ${leadId}`);
    const result = await this.photosService.fetchStreetViewPhoto(leadId);
    return { success: true, ...result };
  }

  @Post(':id/photos/fetch-all')
  async fetchAllPhotos(@Param('id') leadId: string) {
    console.log(`📸 Fetch all photos requested for lead ${leadId}`);
    const result = await this.photosService.fetchAllPhotos(leadId);
    return { success: true, ...result };
  }

  @Post(':id/photos/url')
  async addFromUrl(
    @Param('id') leadId: string,
    @Body() body: { url: string; caption?: string },
  ) {
    if (!body.url) throw new BadRequestException('URL is required');
    return this.photosService.addFromUrl(leadId, body.url, body.caption);
  }

  @Delete(':id/photos/:photoId')
  async deletePhoto(
    @Param('id') leadId: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photosService.deletePhoto(leadId, photoId);
  }

  @Patch(':id/photos/primary')
  async setPrimary(
    @Param('id') leadId: string,
    @Body() body: { photoId: string },
  ) {
    if (!body.photoId) throw new BadRequestException('photoId is required');
    return this.photosService.setPrimary(leadId, body.photoId);
  }
}
