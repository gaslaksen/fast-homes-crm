import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class StreetViewService {
  private readonly logger = new Logger(StreetViewService.name);
  private readonly apiKey: string | undefined;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.config.get<string>('GOOGLE_STREET_VIEW_API_KEY');
    if (this.apiKey) {
      console.log(`🌍 StreetViewService initialized with API key: ${this.apiKey.substring(0, 10)}...`);
    } else {
      console.log('⚠️ StreetViewService: No GOOGLE_STREET_VIEW_API_KEY found in env');
    }
  }

  async fetchStreetView(leadId: string): Promise<any | null> {
    if (!this.apiKey) {
      console.log('❌ Street View: No API key configured, skipping');
      return null;
    }

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const address = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`;
    console.log(`🌍 Fetching Street View for: ${address}`);

    // Check metadata first (free call)
    const metadataUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(address)}&key=${this.apiKey}`;
    console.log(`📡 Checking metadata...`);

    try {
      const metadataRes = await axios.get(metadataUrl);
      console.log(`📡 Metadata response: ${JSON.stringify(metadataRes.data)}`);

      if (metadataRes.data.status !== 'OK') {
        console.log(`⚠️ No Street View available for ${address}: ${metadataRes.data.status}`);
        return null;
      }
    } catch (err) {
      console.log(`❌ Street View metadata check failed: ${err.message}`);
      return null;
    }

    // Fetch the image
    const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(address)}&key=${this.apiKey}`;
    console.log(`📸 Fetching image...`);

    const imageRes = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
    });

    const buffer = Buffer.from(imageRes.data);
    console.log(`📸 Image downloaded: ${buffer.length} bytes`);

    const uploadsDir = path.join(process.cwd(), 'uploads', 'properties');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const timestamp = Date.now();
    const mainFilename = `${leadId}-${timestamp}-main.jpg`;
    const thumbFilename = `${leadId}-${timestamp}-thumb.jpg`;
    const mainPath = path.join(uploadsDir, mainFilename);
    const thumbPath = path.join(uploadsDir, thumbFilename);

    // Process main image (800px wide)
    await sharp(buffer)
      .resize(800, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(mainPath);
    console.log(`💾 Main image saved: ${mainPath}`);

    // Process thumbnail (200px wide)
    await sharp(buffer)
      .resize(200, null, { withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(thumbPath);
    console.log(`💾 Thumbnail saved: ${thumbPath}`);

    const photo = {
      id: randomUUID(),
      url: `/uploads/properties/${mainFilename}`,
      thumbnailUrl: `/uploads/properties/${thumbFilename}`,
      source: 'streetview',
      uploadedAt: new Date().toISOString(),
    };

    // Update lead photos
    const currentPhotos = (lead.photos as any[]) || [];
    const updatedPhotos = [...currentPhotos, photo];

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        photos: updatedPhotos,
        primaryPhoto: lead.primaryPhoto || photo.url,
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'PHOTO_ADDED',
        description: 'Street View photo fetched',
        metadata: { source: 'streetview', photoId: photo.id },
      },
    });

    console.log(`✅ Street View photo saved for lead ${leadId}: ${photo.url}`);
    return photo;
  }

  /**
   * Get a Street View URL for direct display (no download needed)
   */
  getStreetViewUrl(address: string): string | null {
    if (!this.apiKey) return null;
    return `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(address)}&key=${this.apiKey}`;
  }
}
