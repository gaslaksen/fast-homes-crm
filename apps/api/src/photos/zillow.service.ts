import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getJson } from 'serpapi';

/**
 * ZillowService — two-step photo fetch:
 * 1. Web search to find the Zillow listing URL and extract ZPID
 * 2. Image search using the ZPID — returns ONLY photos for that specific listing
 *
 * Direct scraping of zillow.com returns 403 (Cloudflare blocked).
 * Searching by address in Google Images returns neighborhood photos (wrong property).
 * Searching by ZPID returns 100% correct listing photos.
 */
@Injectable()
export class ZillowService {
  private readonly logger = new Logger(ZillowService.name);
  private readonly serpApiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.serpApiKey = this.config.get<string>('SERPAPI_KEY');
  }

  async fetchPhotos(address: string, city: string, state: string, zip?: string): Promise<string[]> {
    if (!this.serpApiKey) {
      this.logger.warn('Zillow photos: SERPAPI_KEY not configured');
      return [];
    }

    // Step 1: Find the ZPID via web search
    const zpid = await this.findZpid(address, city, state);
    if (!zpid) {
      this.logger.log(`Zillow: no listing found for ${address}, ${city}, ${state}`);
      return [];
    }

    this.logger.log(`Zillow: found ZPID ${zpid} for ${address}`);

    // Step 2: Fetch photos using ZPID — scopes results to exactly this listing
    return await this.fetchPhotosByZpid(zpid);
  }

  /**
   * Check if a property is currently listed for sale on Zillow.
   * Returns an object with listingStatus, listPrice, and daysOnMarket if found.
   * Uses a targeted Google search so we stay within the SerpAPI budget.
   */
  async checkListingStatus(
    address: string,
    city: string,
    state: string,
  ): Promise<{ isListed: boolean; listingStatus?: string; listPrice?: number; daysOnMarket?: number; zpid?: string } | null> {
    if (!this.serpApiKey) return null;

    const query = `site:zillow.com "${address}" ${city} ${state}`;

    try {
      const results = await getJson({
        engine: 'google',
        q: query,
        api_key: this.serpApiKey,
        num: 5,
      });

      for (const result of (results.organic_results || [])) {
        const link: string = result.link || '';
        const title: string = (result.title || '').toLowerCase();
        const snippet: string = (result.snippet || '').toLowerCase();

        const zpidMatch = link.match(/\/(\d{7,9})_zpid/);
        if (!zpidMatch) continue;

        const zpid = zpidMatch[1];

        // ── Listing status detection ───────────────────────────────────────────
        // Be CONSERVATIVE: only flag as "for sale" when there is an explicit,
        // unambiguous signal. Zillow uses the word "listing" generically on every
        // property page (even off-market ones), so title.includes('listing') is
        // far too broad and causes false-positive "Active MLS" badges.
        //
        // Explicit "for sale" signals:
        const titleForSale = title.includes('for sale');
        const snippetForSale = snippet.includes('for sale');
        // A listed price in the snippet is a strong secondary signal (off-market
        // pages typically show a Zestimate, not a list price label).
        const hasListPriceLabel = snippet.includes('listed') && /\$[0-9]/.test(snippet);
        // Days on market is unambiguous — only present on active listings.
        const hasDom = /\d+\s*days?\s*on\s*(zillow|market)/i.test(snippet);

        const isForSale = titleForSale || snippetForSale || hasListPriceLabel || hasDom;

        // "Recently sold" signals — checked before off-market to avoid overlap
        const isRecentlySold =
          title.includes('recently sold') ||
          snippet.includes('recently sold') ||
          snippet.includes('sold on') ||
          snippet.includes('sold for $');

        // Off-market: explicit label OR Zestimate page with no for-sale signal
        const isOffMarket =
          title.includes('off market') ||
          snippet.includes('off market') ||
          (!isForSale && !isRecentlySold && snippet.includes('zestimate'));

        // Try to extract list price from snippet (e.g. "$325,000")
        // Only accept prices that look like home values (6-7 digits), not zip codes etc.
        const priceMatch = snippet.match(/\$([0-9]{2,3}(?:,[0-9]{3})+)/);
        const listPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : undefined;

        // Days on market — only present on active listings
        const domMatch = snippet.match(/(\d+)\s*(?:days?)\s*on\s*(?:zillow|market)/i);
        const daysOnMarket = domMatch ? parseInt(domMatch[1], 10) : undefined;

        const listingStatus = isForSale
          ? 'active'
          : isRecentlySold
          ? 'recently_sold'
          : isOffMarket
          ? 'off_market'
          : 'not_listed'; // default: no clear signal → treat as not listed

        this.logger.log(
          `Zillow listing check for ${address}: status=${listingStatus} ` +
          `(titleForSale=${titleForSale}, snippetForSale=${snippetForSale}, hasDom=${hasDom}), ` +
          `price=${listPrice}, dom=${daysOnMarket}, zpid=${zpid}`,
        );

        return {
          isListed: isForSale,
          listingStatus,
          listPrice,
          daysOnMarket,
          zpid,
        };
      }

      return { isListed: false, listingStatus: 'not_found' };
    } catch (err: any) {
      this.logger.warn(`Zillow listing check failed for ${address}: ${err.message}`);
      return null;
    }
  }

  private async findZpid(address: string, city: string, state: string): Promise<string | null> {
    const query = `site:zillow.com "${address}" ${city} ${state}`;

    try {
      const results = await getJson({
        engine: 'google',
        q: query,
        api_key: this.serpApiKey,
        num: 5,
      });

      for (const result of (results.organic_results || [])) {
        const link: string = result.link || '';
        // Extract ZPID from URL patterns like /homedetails/.../118585234_zpid/ or _zpid at end
        const zpidMatch = link.match(/\/(\d{7,9})_zpid/);
        if (zpidMatch) return zpidMatch[1];
      }

      return null;
    } catch (err: any) {
      this.logger.warn(`Zillow ZPID lookup failed: ${err.message}`);
      return null;
    }
  }

  private async fetchPhotosByZpid(zpid: string): Promise<string[]> {
    try {
      const results = await getJson({
        engine: 'google_images',
        q: `zillow ${zpid}_zpid`,
        api_key: this.serpApiKey,
        num: 30,
        safe: 'active',
      });

      const images: any[] = results.images_results || [];
      const photos: string[] = [];

      for (const img of images) {
        const url: string = img.original || img.thumbnail || '';
        // All results should be Zillow CDN but double-check
        if (url.includes('zillowstatic.com') && !photos.includes(url)) {
          photos.push(url);
        }
        if (photos.length >= 20) break;
      }

      this.logger.log(`Zillow: found ${photos.length} listing photos for ZPID ${zpid}`);
      return photos;
    } catch (err: any) {
      this.logger.warn(`Zillow image fetch failed for ZPID ${zpid}: ${err.message}`);
      return [];
    }
  }
}
