import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StreetViewService } from './street-view.service';
import { SerpApiService } from './serpapi.service';
import { RedfinService } from './redfin.service';
import { ZillowService } from './zillow.service';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import axios from 'axios';

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private prisma: PrismaService,
    private streetViewService: StreetViewService,
    private serpApiService: SerpApiService,
    private redfinService: RedfinService,
    private zillowService: ZillowService,
  ) {
    console.log(`📸 PhotosService initialized (base64 storage)`);
  }

  /**
   * Fetch photos from all available sources:
   * 1. Redfin (listing interior photos — best quality)
   * 2. Zillow (listing photos via page scrape)
   * 3. Google Street View (exterior fallback)
   *
   * Non-blocking — failures from individual sources don't affect others.
   */
  async fetchAllPhotos(leadId: string): Promise<{ photoCount: number; sources: string[] }> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const { propertyAddress: addr, propertyCity: city, propertyState: state, propertyZip: zip } = lead;
    console.log(`📸 Fetching photos for lead ${leadId}: ${addr}, ${city}, ${state}`);

    const sources: string[] = [];

    // Zillow/Redfin via SerpAPI disabled — images returned were not reliably
    // of the correct property. Street View is the only automated source for now.

    // ── 3. Google Street View (always run as exterior fallback) ──────────
    try {
      const svResult = await this.streetViewService.fetchStreetView(leadId);
      if (svResult) {
        sources.push('streetview');
        console.log('✅ Street View exterior photo added');
      } else {
        console.log('⚠️ Street View: no image available for this address');
      }
    } catch (err: any) {
      console.log(`⚠️ Street View failed: ${err.message}`);
    }

    // ── Final count ──────────────────────────────────────────────────────
    const updatedLead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    const photoCount = ((updatedLead?.photos as any[]) || []).length;

    console.log(`📸 Photo fetch complete: ${photoCount} total photos (${sources.join(', ') || 'none'})`);

    if (sources.length > 0) {
      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'PHOTOS_FETCHED',
          description: `${photoCount} property photo${photoCount !== 1 ? 's' : ''} fetched (${sources.join(', ')})`,
          metadata: { photoCount, sources },
        },
      });
    }

    return { photoCount, sources };
  }

  /**
   * Fetch only Street View exterior photo for a lead.
   */
  async fetchStreetViewPhoto(leadId: string): Promise<{ photoCount: number; source: string }> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const address = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`;
    console.log(`📸 Fetching Street View photo for lead ${leadId}: ${address}`);

    try {
      const svResult = await this.streetViewService.fetchStreetView(leadId);
      if (svResult) {
        console.log('✅ Street View photo added');

        const updatedLead = await this.prisma.lead.findUnique({ where: { id: leadId } });
        const photoCount = ((updatedLead?.photos as any[]) || []).length;

        await this.prisma.activity.create({
          data: {
            leadId,
            type: 'PHOTOS_FETCHED',
            description: `Street View exterior photo fetched`,
            metadata: { photoCount, source: 'streetview' },
          },
        });

        return { photoCount, source: 'streetview' };
      } else {
        console.log('⚠️ Street View: no image available for this address');
        return { photoCount: 0, source: 'none' };
      }
    } catch (error) {
      console.log(`⚠️ Street View failed: ${error.message}`);
      throw error;
    }
  }

  async processAndSave(
    leadId: string,
    buffer: Buffer,
    source: string,
    caption?: string,
  ) {
    console.log(`📸 Processing photo for lead ${leadId} (${source}), buffer size: ${buffer.length}`);

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    // Process main image (max 800px wide, JPEG 80%) → base64 data URI
    const mainBuffer = await sharp(buffer)
      .resize(800, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Process thumbnail (400px wide) → base64 data URI
    const thumbBuffer = await sharp(buffer)
      .resize(400, null, { withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    const photo: any = {
      id: randomUUID(),
      url: `data:image/jpeg;base64,${mainBuffer.toString('base64')}`,
      thumbnailUrl: `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`,
      source,
      uploadedAt: new Date().toISOString(),
    };
    if (caption) photo.caption = caption;

    const currentPhotos = (lead.photos as any[]) || [];
    const updatedPhotos = [...currentPhotos, photo];

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        photos: updatedPhotos,
        primaryPhoto: lead.primaryPhoto || photo.thumbnailUrl,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'PHOTO_ADDED',
        description: `Photo added (${source})`,
        metadata: { source, photoId: photo.id },
      },
    });

    console.log(`✅ Photo saved for lead ${leadId} (${source}, ${Math.round(mainBuffer.length / 1024)}KB)`);
    return photo;
  }

  async deletePhoto(leadId: string, photoId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const currentPhotos = (lead.photos as any[]) || [];
    const photo = currentPhotos.find((p) => p.id === photoId);
    if (!photo) throw new Error('Photo not found');

    const updatedPhotos = currentPhotos.filter((p) => p.id !== photoId);

    // Reassign primary photo if needed
    let primaryPhoto = lead.primaryPhoto;
    if (primaryPhoto === photo.url) {
      primaryPhoto = updatedPhotos.length > 0 ? updatedPhotos[0].url : null;
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { photos: updatedPhotos, primaryPhoto },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'PHOTO_DELETED',
        description: 'Photo deleted',
        metadata: { photoId },
      },
    });

    console.log(`🗑️ Photo deleted from lead ${leadId}: ${photoId}`);
    return { deleted: true };
  }

  async setPrimary(leadId: string, photoId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const currentPhotos = (lead.photos as any[]) || [];
    const photo = currentPhotos.find((p) => p.id === photoId);
    if (!photo) throw new Error('Photo not found');

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { primaryPhoto: photo.url },
    });

    return { primaryPhoto: photo.url };
  }

  async addFromUrl(leadId: string, url: string, caption?: string, source = 'url') {
    console.log(`🔗 Downloading photo from URL for lead ${leadId}: ${url}`);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 10 * 1024 * 1024, // 10MB
    });
    const buffer = Buffer.from(response.data);
    return this.processAndSave(leadId, buffer, source, caption);
  }

  /**
   * Check Zillow for active listing status and persist the result to
   * the lead's sourceMetadata field. Called non-blocking during lead enrichment.
   */
  async checkAndSaveListingStatus(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { propertyAddress: true, propertyCity: true, propertyState: true, sourceMetadata: true },
    });
    if (!lead?.propertyAddress || !lead.propertyCity) return;

    const result = await this.zillowService.checkListingStatus(
      lead.propertyAddress,
      lead.propertyCity,
      lead.propertyState || '',
    );

    if (!result) return;

    const existingMeta = (lead.sourceMetadata as Record<string, any>) || {};
    const updated: Record<string, any> = {
      ...existingMeta,
      listingStatus: result.listingStatus,
      isActiveListing: result.isListed,
      listingCheckedAt: new Date().toISOString(),
    };
    if (result.listPrice) updated.listPrice = result.listPrice;
    if (result.daysOnMarket != null) updated.daysOnMarket = result.daysOnMarket;
    if (result.zpid) updated.zpid = result.zpid;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { sourceMetadata: updated },
    });

    this.logger.log(`Listing status saved for lead ${leadId}: ${result.listingStatus}${result.listPrice ? ` @ $${result.listPrice.toLocaleString()}` : ''}`);

    if (result.isListed) {
      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'FIELD_UPDATED',
          description: `Property is actively listed on Zillow${result.listPrice ? ` at $${result.listPrice.toLocaleString()}` : ''}${result.daysOnMarket != null ? ` (${result.daysOnMarket} days on market)` : ''}`,
          metadata: { source: 'zillow_listing_check', ...result },
        },
      });
    }
  }
}
