import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getJson } from 'serpapi';

/**
 * RedfinService — two-step photo fetch:
 * 1. Web search to find the Redfin listing URL and property ID
 * 2. Image search using the property ID — scoped to that exact listing
 *
 * Only consumes a second SerpAPI call if the property is actually listed on Redfin.
 * Many off-market/rural properties won't have a Redfin listing.
 */
@Injectable()
export class RedfinService {
  private readonly logger = new Logger(RedfinService.name);
  private readonly serpApiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.serpApiKey = this.config.get<string>('SERPAPI_KEY');
  }

  async fetchPhotos(address: string, city: string, state: string, zip?: string): Promise<string[]> {
    if (!this.serpApiKey) {
      this.logger.warn('Redfin photos: SERPAPI_KEY not configured');
      return [];
    }

    // Step 1: Find the Redfin listing URL and extract property ID
    const { listingUrl, propertyId } = await this.findListing(address, city, state);
    if (!listingUrl || !propertyId) {
      this.logger.log(`Redfin: no listing found for ${address}, ${city}, ${state}`);
      return [];
    }

    this.logger.log(`Redfin: found listing ${propertyId} for ${address}`);

    // Step 2: Image search scoped to that property ID
    return await this.fetchPhotosByPropertyId(propertyId, listingUrl);
  }

  private async findListing(address: string, city: string, state: string): Promise<{ listingUrl: string | null; propertyId: string | null }> {
    const query = `site:redfin.com "${address}" ${city} ${state}`;

    try {
      const results = await getJson({
        engine: 'google',
        q: query,
        api_key: this.serpApiKey,
        num: 5,
      });

      for (const result of (results.organic_results || [])) {
        const link: string = result.link || '';
        // Match Redfin listing URLs: /STATE/CITY/address/home/12345678
        const match = link.match(/redfin\.com\/.+\/home\/(\d+)/);
        if (match) {
          return { listingUrl: link, propertyId: match[1] };
        }
      }

      return { listingUrl: null, propertyId: null };
    } catch (err: any) {
      this.logger.warn(`Redfin listing lookup failed: ${err.message}`);
      return { listingUrl: null, propertyId: null };
    }
  }

  private async fetchPhotosByPropertyId(propertyId: string, listingUrl: string): Promise<string[]> {
    // Extract the path segment for a more targeted image search
    const pathMatch = listingUrl.match(/redfin\.com(\/[^?]+)/);
    const listingPath = pathMatch ? pathMatch[1] : '';
    const query = `redfin.com${listingPath} photos`;

    try {
      const results = await getJson({
        engine: 'google_images',
        q: query,
        api_key: this.serpApiKey,
        num: 30,
        safe: 'active',
      });

      const images: any[] = results.images_results || [];
      const photos: string[] = [];

      for (const img of images) {
        const url: string = img.original || img.thumbnail || '';
        if (
          (url.includes('cdn-redfin.com') || url.includes('ssl.cdn-redfin.com')) &&
          !photos.includes(url)
        ) {
          photos.push(url);
        }
        if (photos.length >= 20) break;
      }

      this.logger.log(`Redfin: found ${photos.length} listing photos for property ${propertyId}`);
      return photos;
    } catch (err: any) {
      this.logger.warn(`Redfin image fetch failed: ${err.message}`);
      return [];
    }
  }
}
